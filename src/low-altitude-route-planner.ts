import {FlightCityCollision} from './city-flight-collision.ts';
import {inRing} from './driving.ts';
import {airspaceClearance,pointInRestrictedAirspace,segmentCrossesRestrictedAirspace} from './low-altitude-airspace.ts';
import {weatherForRoute} from './low-altitude-weather.ts';
import type {CityData,V2} from './city-types.ts';
import type {MissionDestination,PlannedRoute,RouteKind,RoutePoint,WeatherSnapshot} from './low-altitude-types.ts';

type Building={rings:V2[][];height:number;x0:number;x1:number;z0:number;z1:number};
type Profile={id:RouteKind;name:string;badge:string;altitude:number;speed:number;distance:number;building:number;terrain:number;airspace:number;weather:number;lateral:number;clearance:number};
type SearchNode={index:number;xIndex:number;zIndex:number;x:number;z:number;y:number;g:number;f:number;parent:number;clearance:number};
type RouteSearch={points:RoutePoint[];distance:number;buildingClearance:number;terrainClearance:number;airspaceClearance:number;headwind:number};

const PROFILES:Profile[]=[
 {id:'fastest',name:'最快到达',badge:'A',altitude:48,speed:15,distance:1,building:2.2,terrain:2,airspace:4,weather:1.5,lateral:.35,clearance:12},
 {id:'safest',name:'最低风险',badge:'B',altitude:72,speed:12,distance:1.08,building:18,terrain:13,airspace:34,weather:8,lateral:1,clearance:28},
 {id:'balanced',name:'综合推荐',badge:'C',altitude:60,speed:13.5,distance:1.03,building:9,terrain:7,airspace:17,weather:4,lateral:-1,clearance:20},
];
const GRID=72,CELL=180;
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

class MinHeap{
 private values:SearchNode[]=[];
 push(node:SearchNode){const values=this.values;values.push(node);let index=values.length-1;while(index>0){const parent=(index-1)>>1;if(values[parent].f<=node.f)break;values[index]=values[parent];index=parent;}values[index]=node;}
 pop(){const values=this.values,first=values[0],last=values.pop();if(!first)return null;if(values.length&&last){let index=0;while(true){let child=index*2+1;if(child>=values.length)break;if(child+1<values.length&&values[child+1].f<values[child].f)child++;if(values[child].f>=last.f)break;values[index]=values[child];index=child;}values[index]=last;}return first;}
 get length(){return this.values.length;}
}

function bearingHeadwind(ax:number,az:number,bx:number,bz:number,weather:WeatherSnapshot){
 const bearing=Math.atan2(bx-ax,bz-az),windFrom=weather.windDirection*Math.PI/180;return weather.windSpeed*Math.cos(bearing-windFrom);
}

function pathDistance(points:RoutePoint[]){let distance=0;for(let index=1;index<points.length;index++)distance+=Math.hypot(points[index].x-points[index-1].x,points[index].z-points[index-1].z);return distance;}
function segmentDistance(x:number,z:number,ax:number,az:number,bx:number,bz:number){const dx=bx-ax,dz=bz-az,lengthSquared=dx*dx+dz*dz,amount=lengthSquared?clamp(((x-ax)*dx+(z-az)*dz)/lengthSquared,0,1):0;return Math.hypot(x-(ax+dx*amount),z-(az+dz*amount));}

export class LowAltitudeRoutePlanner{
 private collision:FlightCityCollision;
 private cells=new Map<string,Building[]>();
 private lastConnectorFailure='';
 constructor(private data:CityData,private heightAt:(x:number,z:number)=>number){
  this.collision=new FlightCityCollision(data,heightAt);
  for(const source of data.buildings){
   if(source.height<=1.1||source.style==='landmark-detail')continue;const xs=source.rings[0].map(point=>point[0]),zs=source.rings[0].map(point=>point[1]),building:Building={rings:source.rings,height:source.height,x0:Math.min(...xs),x1:Math.max(...xs),z0:Math.min(...zs),z1:Math.max(...zs)};
   for(let x=Math.floor(building.x0/CELL);x<=Math.floor(building.x1/CELL);x++)for(let z=Math.floor(building.z0/CELL);z<=Math.floor(building.z1/CELL);z++){const key=x+','+z,list=this.cells.get(key)??[];list.push(building);this.cells.set(key,list);}
  }
 }
  isFlightPathSafe(points:readonly RoutePoint[]){
  for(let index=1;index<points.length;index++){
   if(!this.safeSegment(points[index-1],points[index]))return false;
  }
  return true;
 }

  connector(from:{x:number;z:number;y?:number},to:{x:number;z:number;y?:number},weather:WeatherSnapshot):RoutePoint[]|null{
  this.lastConnectorFailure='';
  const start={x:from.x,z:from.z},destination={x:to.x,z:to.z};
  const startAltitude=from.y===undefined?0:Math.max(0,from.y-this.heightAt(from.x,from.z));
  const destinationAltitude=to.y===undefined?0:Math.max(0,to.y-this.heightAt(to.x,to.z));
  // Only reject an endpoint when it is actually inside the restricted volume
  // at its own flight altitude. A ground-level pad is not an airspace breach,
  // and a high-altitude endpoint may be above a zone's ceiling.
  if(pointInRestrictedAirspace(start.x,start.z,startAltitude)||pointInRestrictedAirspace(destination.x,destination.z,destinationAltitude)){this.lastConnectorFailure='endpoint-restricted-airspace';return null;}
  const profile=PROFILES.find(item=>item.id==='balanced')!;
  const result=this.search(start,destination,weather,profile);
  if(!result){this.lastConnectorFailure='a-star-no-path';return null;}
  const points=result.points.map(point=>({...point}));
  const cruiseY=(x:number,z:number)=>this.heightAt(x,z)+Math.max(72,profile.altitude);
  // Preserve ground endpoints, but lift every connector waypoint into the
  // same low-altitude cruise band. Otherwise station-to-origin and return
  // connectors inherit grid endpoints that visually sit on the terrain.
  for(let index=0;index<points.length;index++){
   const point=points[index],isGroundEndpoint=(index===0&&from.y!==undefined)||(index===points.length-1&&to.y!==undefined);
   if(!isGroundEndpoint)points[index]={...point,x:index===0&&from.y!==undefined?from.x:index===points.length-1&&to.y!==undefined?to.x:point.x,z:index===0&&from.y!==undefined?from.z:index===points.length-1&&to.y!==undefined?to.z:point.z,y:cruiseY(index===0&&from.y!==undefined?from.x:index===points.length-1&&to.y!==undefined?to.x:point.x,index===0&&from.y!==undefined?from.z:index===points.length-1&&to.y!==undefined?to.z:point.z)};
  }
  if(from.y!==undefined)points[0]={...points[0],x:from.x,y:from.y,z:from.z};
  if(to.y!==undefined)points[points.length-1]={...points[points.length-1],x:to.x,y:to.y,z:to.z};
  if(this.isFlightPathSafe(points))return points;
  this.lastConnectorFailure='connector-path-fails-final-safety-check';
  return null;
 }
 get connectorFailure(){return this.lastConnectorFailure;}

 async plan(start:{x:number;z:number},destination:MissionDestination,weather:WeatherSnapshot){
  const routes:PlannedRoute[]=[];
  for(const profile of PROFILES){const result=this.search(start,destination,weather,profile);if(result)routes.push(this.describe(result,profile,weatherForRoute(weather,result.points)));await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));}
  return routes;
 }
 private nearbyBuildings(x:number,z:number,radius=190){
  const buildings=new Set<Building>(),cellRadius=Math.ceil(radius/CELL);for(let ix=Math.floor(x/CELL)-cellRadius;ix<=Math.floor(x/CELL)+cellRadius;ix++)for(let iz=Math.floor(z/CELL)-cellRadius;iz<=Math.floor(z/CELL)+cellRadius;iz++)for(const building of this.cells.get(ix+','+iz)??[])buildings.add(building);return buildings;
 }
 private buildingClearance(x:number,y:number,z:number){
  let clearance=220;
  for(const building of this.nearbyBuildings(x,z)){
   const dx=Math.max(building.x0-x,0,x-building.x1),dz=Math.max(building.z0-z,0,z-building.z1),horizontal=Math.hypot(dx,dz);if(horizontal>220)continue;
   const insideBox=horizontal===0,inside=insideBox&&inRing(x,z,building.rings[0])&&!building.rings.slice(1).some(ring=>inRing(x,z,ring));const vertical=Math.max(0,y-building.height);clearance=Math.min(clearance,inside?vertical:Math.hypot(horizontal,Math.max(0,building.height-y)));
  }
  return clearance;
 }
 private safeSegment(a:RoutePoint,b:RoutePoint){
  const aGround=this.heightAt(a.x,a.z),bGround=this.heightAt(b.x,b.z),altitude=Math.max(0,Math.min(a.y-aGround,b.y-bGround));
  const horizontal=Math.hypot(b.x-a.x,b.z-a.z),endpointLanding=altitude<6&&horizontal<18;
  if(!endpointLanding&&segmentCrossesRestrictedAirspace(a.x,a.z,b.x,b.z,altitude)){this.lastConnectorFailure='segment-restricted-airspace';return false;}
  if(endpointLanding){
   // The final descent is an authorized landing operation at the selected
   // pad/drop point. Do not treat the receiving building's footprint as an
   // in-flight collision; the preceding cruise segment is still checked.
   return true;
  }
  const hit=this.collision.sweep(a,b);
  if(hit){this.lastConnectorFailure=hit.kind==='building'?`building-collision:${hit.id??'unknown'}`:'terrain-collision';return false;}
  return true;
 }
 private visible(a:RoutePoint,b:RoutePoint,altitude:number){return this.safeSegment(a,b);}
 private guided(start:{x:number;z:number},destination:{x:number;z:number},weather:WeatherSnapshot,profile:Profile,altitude:number){
  const dx=destination.x-start.x,dz=destination.z-start.z,distance=Math.hypot(dx,dz);if(distance<180)return null;const normalX=-dz/distance,normalZ=dx/distance,startPoint={x:start.x,y:this.heightAt(start.x,start.z)+altitude,z:start.z},endPoint={x:destination.x,y:this.heightAt(destination.x,destination.z)+altitude,z:destination.z},base=clamp(distance*.28,80,Math.min(260,distance*.16));
  const directPoints=[startPoint,endPoint];
  const directResult=this.safeSegment(startPoint,endPoint)?this.finish(directPoints,altitude,weather,true):null;
  if(directResult)return directResult;
  const candidateOffsets=[base,-base,base*1.5,-base*1.5];
  for(const offset of candidateOffsets){const first={x:start.x+dx*.38+normalX*offset,z:start.z+dz*.38+normalZ*offset},second={x:start.x+dx*.68+normalX*offset,z:start.z+dz*.68+normalZ*offset},points=[startPoint,{x:first.x,y:this.heightAt(first.x,first.z)+altitude,z:first.z},{x:second.x,y:this.heightAt(second.x,second.z)+altitude,z:second.z},endPoint];if(points.slice(1,-1).some(point=>this.buildingClearance(point.x,point.y,point.z)<profile.clearance))continue;if(points.slice(1).some((point,index)=>!this.safeSegment(points[index],point)))continue;const result=this.finish(points,altitude,weather,true);if(result&&this.isFlightPathSafe(result.points))return result;}
  return null;
 }
 private search(start:{x:number;z:number},destination:{x:number;z:number},weather:WeatherSnapshot,profile:Profile):RouteSearch|null{
  if(pointInRestrictedAirspace(start.x,start.z,0)||pointInRestrictedAirspace(destination.x,destination.z,0)){this.lastConnectorFailure='search-endpoint-restricted-at-ground';return null;}
  const direct=Math.hypot(destination.x-start.x,destination.z-start.z),margin=clamp(direct*.32+260,360,Math.min(1400,850+direct*.12)),extent=this.data.meta.extent;
  const minX=Math.max(extent[0],Math.min(start.x,destination.x)-margin),maxX=Math.min(extent[2],Math.max(start.x,destination.x)+margin),minZ=Math.max(extent[1],Math.min(start.z,destination.z)-margin),maxZ=Math.min(extent[3],Math.max(start.z,destination.z)+margin),columns=Math.max(2,Math.ceil((maxX-minX)/GRID)+1),rows=Math.max(2,Math.ceil((maxZ-minZ)/GRID)+1);
  const sx=clamp(Math.round((start.x-minX)/GRID),0,columns-1),sz=clamp(Math.round((start.z-minZ)/GRID),0,rows-1),ex=clamp(Math.round((destination.x-minX)/GRID),0,columns-1),ez=clamp(Math.round((destination.z-minZ)/GRID),0,rows-1);
  const altitudeOffsets=[0,36,72];if(pointInRestrictedAirspace(start.x,start.z,profile.altitude)||pointInRestrictedAirspace(destination.x,destination.z,profile.altitude)){this.lastConnectorFailure='cruise-altitude-endpoint-restricted';return null;}if(profile.lateral)for(const extraAltitude of altitudeOffsets){const guided=this.guided(start,destination,weather,profile,profile.altitude+extraAltitude);if(guided)return guided;}for(const extraAltitude of altitudeOffsets){const altitude=profile.altitude+extraAltitude,result=this.aStar(start,destination,weather,profile,altitude,{minX,minZ,columns,rows,sx,sz,ex,ez});if(result)return result;}
  return null;
 }
 private aStar(start:{x:number;z:number},destination:{x:number;z:number},weather:WeatherSnapshot,profile:Profile,altitude:number,grid:{minX:number;minZ:number;columns:number;rows:number;sx:number;sz:number;ex:number;ez:number}):RouteSearch|null{
  const {minX,minZ,columns,rows,sx,sz,ex,ez}=grid,key=(x:number,z:number)=>z*columns+x,heap=new MinHeap(),best=new Float64Array(columns*rows),parents=new Int32Array(columns*rows);best.fill(Infinity);parents.fill(-1);
  const directX=destination.x-start.x,directZ=destination.z-start.z,directLength=Math.max(1,Math.hypot(directX,directZ)),normalX=-directZ/directLength,normalZ=directX/directLength,bias=Math.min(280,directLength*.3)*profile.lateral,guideX=(start.x+destination.x)/2+normalX*bias,guideZ=(start.z+destination.z)/2+normalZ*bias;
  const point=(xIndex:number,zIndex:number)=>{const x=minX+xIndex*GRID,z=minZ+zIndex*GRID;return {x,z,y:this.heightAt(x,z)+altitude};};
  const startIndex=key(sx,sz),startPoint={x:start.x,y:this.heightAt(start.x,start.z)+altitude,z:start.z},startNode:SearchNode={index:startIndex,xIndex:sx,zIndex:sz,...startPoint,g:0,f:directLength,parent:-1,clearance:this.buildingClearance(startPoint.x,startPoint.y,startPoint.z)};best[startIndex]=0;heap.push(startNode);const closed=new Uint8Array(columns*rows),nodes=new Map<number,SearchNode>([[startIndex,startNode]]),directions=[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]],finalPoint:RoutePoint={x:destination.x,y:this.heightAt(destination.x,destination.z)+altitude,z:destination.z};
  while(heap.length){const current=heap.pop()!;if(closed[current.index])continue;closed[current.index]=1;const distanceToDestination=Math.hypot(current.x-destination.x,current.z-destination.z);if(distanceToDestination<=GRID*1.5&&this.safeSegment(current,finalPoint)){const raw:RoutePoint[]=[];let cursor=current.index;while(cursor>=0){const node=nodes.get(cursor);if(!node)break;raw.push({x:node.x,y:node.y,z:node.z});cursor=parents[cursor];}raw.reverse();raw.push(finalPoint);const result=this.finish(raw,altitude,weather);if(result)return result;}
   for(const [dx,dz] of directions){const xIndex=current.xIndex+dx,zIndex=current.zIndex+dz;if(xIndex<0||xIndex>=columns||zIndex<0||zIndex>=rows)continue;const index=key(xIndex,zIndex);if(closed[index])continue;const next=point(xIndex,zIndex);if(!this.safeSegment(current,next))continue;
    const step=Math.hypot(next.x-current.x,next.z-current.z),clearance=this.buildingClearance(next.x,next.y,next.z),terminalDistance=Math.min(Math.hypot(next.x-start.x,next.z-start.z),Math.hypot(next.x-destination.x,next.z-destination.z));if(terminalDistance>96&&clearance<profile.clearance)continue;const buildingRisk=terminalDistance<=96?0:Math.max(0,(170-clearance)/170),terrainRise=Math.abs((next.y-current.y)/step),airspace=airspaceClearance(next.x,next.z,altitude),airRisk=airspace.insideCaution?1.5:Math.max(0,(210-airspace.clearance)/210),headwind=Math.max(0,bearingHeadwind(current.x,current.z,next.x,next.z,weather)),weatherRisk=(weather.precipitation*.18+headwind*.04)*profile.weather;
    const guideDistance=profile.lateral===0?segmentDistance(next.x,next.z,start.x,start.z,destination.x,destination.z):segmentDistance(next.x,next.z,start.x,start.z,destination.x,destination.z),guideCost=guideDistance*.04,cost=step*(profile.distance+buildingRisk*profile.building+terrainRise*profile.terrain+airRisk*profile.airspace+weatherRisk)+guideCost,g=current.g+cost;if(g>=best[index])continue;
    const heuristic=Math.hypot(destination.x-next.x,destination.z-next.z)*profile.distance,node:SearchNode={index,xIndex,zIndex,...next,g,f:g+heuristic,parent:current.index,clearance};best[index]=g;parents[index]=current.index;nodes.set(index,node);heap.push(node);
   }
  }
  return null;
 }
 private smooth(points:RoutePoint[],altitude:number){
  if(points.length<3)return points;
  const curved:RoutePoint[]=[points[0]];
  for(let index=1;index<points.length-1;index++){
   const previous=points[index-1],corner=points[index],next=points[index+1];
   const start={x:(previous.x+corner.x)*.5,z:(previous.z+corner.z)*.5};
   const end={x:(corner.x+next.x)*.5,z:(corner.z+next.z)*.5};
   if(Math.hypot(start.x-(curved[curved.length-1]?.x??start.x),start.z-(curved[curved.length-1]?.z??start.z))>.01)curved.push({x:start.x,y:this.heightAt(start.x,start.z)+altitude,z:start.z});
   for(let sample=1;sample<=4;sample++){
    const t=sample/4,u=1-t,x=u*u*start.x+2*u*t*corner.x+t*t*end.x,z=u*u*start.z+2*u*t*corner.z+t*t*end.z;
    curved.push({x,y:this.heightAt(x,z)+altitude,z});
   }
  }
  curved.push(points[points.length-1]);
  return curved;
 }
 private finish(raw:RoutePoint[],altitude:number,weather:WeatherSnapshot,preserveWaypoints=false):RouteSearch|null{
  const simplified:RoutePoint[]=preserveWaypoints?raw:[raw[0]];
  if(!preserveWaypoints){let cursor=0;while(cursor<raw.length-1){let next=raw.length-1;while(next>cursor+1&&!this.visible(raw[cursor],raw[next],altitude))next--;simplified.push(raw[next]);cursor=next;}}
  const groundStart={...raw[0],y:this.heightAt(raw[0].x,raw[0].z)+1.2};
  const groundEnd={...raw[raw.length-1],y:this.heightAt(raw[raw.length-1].x,raw[raw.length-1].z)+1.2};
  const first=raw[0],last=raw[raw.length-1],dx=last.x-first.x,dz=last.z-first.z,distance=Math.hypot(dx,dz),normalX=distance?-dz/distance:0,normalZ=distance?dx/distance:0,bend=clamp(distance*.18,90,280);
  const curvedCandidates=distance>180?[1,-1].map(sign=>{const offset=bend*sign,a={x:first.x+dx*.34+normalX*offset,z:first.z+dz*.34+normalZ*offset},b={x:first.x+dx*.68+normalX*offset,z:first.z+dz*.68+normalZ*offset};return [first,{x:a.x,y:this.heightAt(a.x,a.z)+altitude,z:a.z},{x:b.x,y:this.heightAt(b.x,b.z)+altitude,z:b.z},last];}):[];
  const withLanding=(cruise:RoutePoint[])=>{
   if(cruise.length<2)return null;
   const cruiseAltitude=Math.max(altitude,60),cruiseRaw=cruise.map(point=>({...point,y:this.heightAt(point.x,point.z)+cruiseAltitude})),start=cruiseRaw[0],end=cruiseRaw[cruiseRaw.length-1];
   const departureTarget=cruiseRaw.find(point=>Math.hypot(point.x-start.x,point.z-start.z)>1);
   const approachTarget=[...cruiseRaw].reverse().find(point=>Math.hypot(point.x-end.x,point.z-end.z)>1);
   if(departureTarget&&approachTarget){
    const offset=(endpoint:RoutePoint,target:RoutePoint)=>{
     const distance=Math.hypot(target.x-endpoint.x,target.z-endpoint.z);
     const t=Math.min(1,60/distance);
     return {x:endpoint.x+(target.x-endpoint.x)*t,y:endpoint.y+(target.y-endpoint.y)*t,z:endpoint.z+(target.z-endpoint.z)*t};
    };
    // Limit diagonal takeoff/landing to a local 60 m approach. Do not delete
    // cruise endpoints and turn kilometres of cruise into a ground-level ramp.
    const diagonal=[groundStart,offset(start,departureTarget),...cruiseRaw.slice(1,-1),offset(end,approachTarget),groundEnd];
    if(this.isFlightPathSafe(diagonal))return diagonal;
   }
   // Preserve the searched path if the local diagonal is obstructed.
   const preserved=[groundStart,...cruiseRaw,groundEnd];
   return this.isFlightPathSafe(preserved)?preserved:null;
  };
  let points:RoutePoint[]|null=null;
  for(const candidate of [...curvedCandidates,this.smooth(simplified,altitude),simplified,raw]){
   points=withLanding(candidate);
   if(points)break;
  }
  if(!points)return null;
  const candidatePoints=points;
  const finalized=candidatePoints.map((point,index)=>index===0||index===candidatePoints.length-1?point:{...point,y:this.heightAt(point.x,point.z)+Math.max(72,altitude)});
  if(!this.isFlightPathSafe(finalized))return null;
  points=finalized;
  let buildingClearance=220,terrainClearance=Infinity,airClearance=Infinity,headwind=0,segments=0;
  for(let index=1;index<points.length-1;index++){const point=points[index],terminalDistance=Math.min(Math.hypot(point.x-points[0].x,point.z-points[0].z),Math.hypot(point.x-points[points.length-1].x,point.z-points[points.length-1].z));if(terminalDistance>96)buildingClearance=Math.min(buildingClearance,this.buildingClearance(point.x,point.y,point.z));terrainClearance=Math.min(terrainClearance,point.y-this.heightAt(point.x,point.z));const airspace=airspaceClearance(point.x,point.z,altitude);airClearance=Math.min(airClearance,airspace.clearance);if(index<points.length-2){headwind+=Math.max(0,bearingHeadwind(point.x,point.z,points[index+1].x,points[index+1].z,weather));segments++;}}
  return {points,distance:pathDistance(points),buildingClearance,terrainClearance,airspaceClearance:airClearance,headwind:segments?headwind/segments:0};
 }
 private describe(result:RouteSearch,profile:Profile,weather:WeatherSnapshot):PlannedRoute{
  const weatherImpact=clamp(weather.precipitation*9+Math.max(0,weather.windSpeed-5)*3+result.headwind*2,0,55),clearancePenalty=Math.max(0,35-result.buildingClearance)*.75,airPenalty=Math.max(0,120-result.airspaceClearance)*.08,riskScore=clamp(98-weatherImpact-clearancePenalty-airPenalty,8,99),durationMinutes=result.distance/(profile.speed-Math.min(5,result.headwind*.35))/60+1.1;
  const reasons=profile.id==='fastest'?['距离最短',result.headwind<2?'风向影响较小':`逆风约 ${result.headwind.toFixed(1)} m/s`]:profile.id==='safest'?[`建筑净空约 ${Math.round(result.buildingClearance)} m`,'远离仿真限制空域']:[weather.flightIndex>=75?'天气条件良好':'已计入天气风险',`巡航高度 ${Math.round(result.terrainClearance)} m`];
  return {id:profile.id,name:profile.name,badge:profile.badge,points:result.points,distanceMeters:result.distance,durationMinutes,cruiseAltitude:result.terrainClearance,cruiseSpeed:profile.speed,riskScore,buildingClearance:result.buildingClearance,terrainClearance:result.terrainClearance,weatherImpact,headwind:result.headwind,reasons};
 }
}
