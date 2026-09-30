import {
 Color3,ImportMeshAsync,Material,MeshBuilder,PBRMaterial,TransformNode,Vector3,
 type AbstractMesh,type Scene,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import type {CargoManifest,DroneMissionStatus,MissionRecord,PlannedRoute,RoutePoint,RouteSegment,WeatherSnapshot} from '../low-altitude-types.ts';
import {FLEET_STATIONS} from '../low-altitude-stations.ts';
import type {FleetStation} from '../low-altitude-stations.ts';
import {warehousePadWorld} from '../warehouse/warehouse.ts';

const ASSET_URL='/drone/greenroute-drone.glb';
const DISPLAY_SCALE=2.35;
const MAX_CARGO_KG=4.5;
const BASE_BATTERY_PERCENT=100;
const BATTERY_RESERVE_PERCENT=20;
const BATTERY_DRAIN_PER_KM=1;
const CHARGE_RATE_PERCENT_PER_SECOND=1;
const CHARGE_RELEASE_PERCENT=100;
const ROTOR_LAYOUT=[
 {code:'FL',position:new Vector3(-.52,.51,-.52),direction:1},
 {code:'FR',position:new Vector3(.52,.51,-.52),direction:-1},
 {code:'RL',position:new Vector3(-.52,.51,.52),direction:-1},
 {code:'RR',position:new Vector3(.52,.51,.52),direction:1},
] as const;

type FlightSafetyCheck=(a:RoutePoint,b:RoutePoint)=>boolean;
type FlightConnector=(from:RoutePoint,to:RoutePoint)=>RoutePoint[]|null;
type ConnectorFailureSource=()=>string;
type FleetUnit={
 id:string;root:TransformNode;rotors:{pivot:TransformNode;direction:number}[];
 baseY:number;active:boolean;meshes:AbstractMesh[];stationId:string;charging:boolean;batteryPercent:number;chargeElapsed:number;
};

type StationPoint={x:number;y:number;z:number};

type ActiveMission={
 unit:FleetUnit;
 aircraftIndex:number;
 home:RoutePoint;
 launch:RoutePoint[];
 delivery:RoutePoint[];
 routeSegments:RouteSegment[];
 route:PlannedRoute;
 cargo:CargoManifest;
 outbound:RoutePoint[];
 inbound:RoutePoint[];
 weather?:WeatherSnapshot;
 returnStation:FleetStation;
 outboundLengths:number[];
 launchLengths:number[];
 inboundLengths:number[];
 launchDistance:number;
 outboundDistance:number;
 inboundDistance:number;
 travelled:number;
 batteryDistance:number;
 deliveryElapsed:number;
 loadingElapsed:number;
 unloadingElapsed:number;
 speed:number;
 destinationName:string;
 phase:DroneMissionStatus['phase'];
 batteryPercent:number;
 estimatedReturnBattery:number;
 safetyMessage:string;
 cancelRequested:boolean;
 segment:'launch'|'delivery'|'return';
};

const IDLE_MISSION:DroneMissionStatus={phase:'idle',progress:0,aircraftIndex:0,routeId:null,destinationName:'',orderId:'',cargoWeightKg:0,distanceRemaining:0,simulatedSpeed:0,batteryPercent:BASE_BATTERY_PERCENT,estimatedReturnBattery:BASE_BATTERY_PERCENT,safetyMessage:'等待任务'};

function cumulative(points:RoutePoint[]){const lengths=[0];for(let index=1;index<points.length;index++)lengths.push(lengths[index-1]+Math.hypot(points[index].x-points[index-1].x,points[index].y-points[index-1].y,points[index].z-points[index-1].z));return lengths;}

function samplePath(points:RoutePoint[],lengths:number[],distance:number,target:Vector3){
 const total=lengths[lengths.length-1]??0,clamped=Math.max(0,Math.min(total,distance));let index=1;while(index<lengths.length&&lengths[index]<clamped)index++;if(index>=points.length){const end=points[points.length-1];target.set(end.x,end.y,end.z);return;}
 const start=points[index-1],end=points[index],span=Math.max(.001,lengths[index]-lengths[index-1]),amount=(clamped-lengths[index-1])/span;target.set(start.x+(end.x-start.x)*amount,start.y+(end.y-start.y)*amount,start.z+(end.z-start.z)*amount);
}

export class GreenRouteFleet{
 readonly root:TransformNode;
 readonly meshes:AbstractMesh[]=[];
 readonly shadowCasters:AbstractMesh[]=[];
 readonly units:FleetUnit[]=[];
 private readonly bladeMaterial:PBRMaterial;
 private readonly blurMaterial:PBRMaterial;
 private elapsed=0;
 private rotorRadians=0;
 private loaded=false;
 private hiddenSourceBlades=0;
 private activeMission:ActiveMission|null=null;
 private readonly activeMissions=new Map<number,ActiveMission>();
 private flightSafetyCheck:FlightSafetyCheck|undefined;
 private flightConnector:FlightConnector|undefined;
 private connectorFailureSource:ConnectorFailureSource|undefined;
 private lastDispatchFailure='';
 private readonly missionRecords:MissionRecord[]=[];
 private missionStartedAtByAircraft=new Map<number,string>();
 private missionSnapshot:DroneMissionStatus={...IDLE_MISSION};
 private missionPosition=new Vector3();
 private missionPrevious=new Vector3();

 constructor(private scene:Scene,private positions:Vector3[],private heading=0,private stationIds:string[]=Array.from({length:positions.length},()=>FLEET_STATIONS[0].id),private groundHeight:(x:number,z:number)=>number=()=>0){
  this.root=new TransformNode('greenroute-fleet-root',scene);
  this.bladeMaterial=new PBRMaterial('greenroute-corrected-propeller',scene);
  this.bladeMaterial.albedoColor=new Color3(.025,.032,.038);this.bladeMaterial.metallic=.72;this.bladeMaterial.roughness=.28;
  this.blurMaterial=new PBRMaterial('greenroute-rotor-motion-blur',scene);
  this.blurMaterial.albedoColor=new Color3(.23,.42,.43);this.blurMaterial.emissiveColor=new Color3(.025,.09,.085);this.blurMaterial.metallic=.18;this.blurMaterial.roughness=.32;this.blurMaterial.alpha=.14;this.blurMaterial.transparencyMode=Material.MATERIAL_ALPHABLEND;this.blurMaterial.backFaceCulling=false;
 }

 async load(){
  if(this.positions.length!==5)throw new Error('GreenRoute fleet requires exactly five landing-pad positions');
  const asset=await ImportMeshAsync(ASSET_URL,this.scene);
  const importedNodes=new Set([...asset.meshes,...asset.transformNodes]);
  const sourceRoots=[...importedNodes].filter(node=>!node.parent||!importedNodes.has(node.parent as TransformNode));
  for(let index=0;index<this.positions.length;index++){
   const active=index===0,unitRoot=new TransformNode('greenroute-unit-'+(index+1),this.scene);
   unitRoot.parent=this.root;unitRoot.position.copyFrom(this.positions[index]);unitRoot.rotation.y=this.heading;unitRoot.scaling.setAll(DISPLAY_SCALE);
   for(const source of sourceRoots){
    if(index===0)source.parent=unitRoot;
    else source.clone(source.name+'-uav-'+(index+1),unitRoot,false);
   }
   const unit:FleetUnit={id:'GR-UAV-'+String(index+1).padStart(2,'0'),root:unitRoot,rotors:[],baseY:unitRoot.position.y,active:true,meshes:[],stationId:this.stationIds[index]??FLEET_STATIONS[0].id,charging:false,batteryPercent:BASE_BATTERY_PERCENT,chargeElapsed:0};
   for(const mesh of unitRoot.getChildMeshes(false)){
    if(/Prop_(?:FL|FR|RL|RR)_[AB]/.test(mesh.name)){mesh.setEnabled(false);this.hiddenSourceBlades++;continue;}
    if(!mesh.getTotalVertices())continue;
    mesh.setEnabled(true);mesh.isPickable=false;mesh.receiveShadows=true;unit.meshes.push(mesh);this.meshes.push(mesh);this.shadowCasters.push(mesh);
    if(mesh.material instanceof PBRMaterial){mesh.material.environmentIntensity=1.18;mesh.material.forceIrradianceInFragment=true;mesh.material.maxSimultaneousLights=8;}
   }
   this.buildCorrectedRotors(unit,index);
   this.units.push(unit);
  }
  this.loaded=true;
  return this;
 }

 private buildCorrectedRotors(unit:FleetUnit,unitIndex:number){
  for(let index=0;index<ROTOR_LAYOUT.length;index++){
   const rotor=ROTOR_LAYOUT[index],pivot=new TransformNode(unit.id+'-rotor-'+rotor.code,this.scene);
   pivot.parent=unit.root;pivot.position.copyFrom(rotor.position);pivot.rotation.y=(unitIndex*.19+index*.71)%Math.PI;
   const blade=MeshBuilder.CreateBox(unit.id+'-propeller-'+rotor.code,{width:.56,height:.012,depth:.048},this.scene);
   blade.parent=pivot;blade.material=this.bladeMaterial;blade.isPickable=false;blade.receiveShadows=true;
   unit.meshes.push(blade);this.meshes.push(blade);this.shadowCasters.push(blade);
   if(unit.active){
    const blur=MeshBuilder.CreateCylinder(unit.id+'-rotor-blur-'+rotor.code,{diameter:.61,height:.006,tessellation:48},this.scene);
    blur.parent=pivot;blur.position.y=-.006;blur.material=this.blurMaterial;blur.isPickable=false;blur.receiveShadows=false;
    unit.meshes.push(blur);this.meshes.push(blur);
   }
   unit.rotors.push({pivot,direction:rotor.direction});
  }
 }

 setFlightSafetyCheck(check:FlightSafetyCheck|undefined){this.flightSafetyCheck=check;}
 setFlightConnector(connector:FlightConnector|undefined){this.flightConnector=connector;}
 setConnectorFailureSource(source:ConnectorFailureSource|undefined){this.connectorFailureSource=source;}

 update(dt:number){
  if(!this.loaded||!this.root.isEnabled())return;
  this.elapsed+=dt;this.rotorRadians+=dt*30;
  this.updateMissions(dt);
  for(const unit of this.units){
   if(!unit.active)continue;
   const busy=this.activeMissions.has(this.units.indexOf(unit));
   const dockedStation=FLEET_STATIONS.flatMap(station=>Array.from({length:station.pads},(_,index)=>{const pad=this.stationPad(station,index);return {station,pad,horizontal:Math.hypot(unit.root.position.x-pad.x,unit.root.position.z-pad.z),vertical:Math.abs(unit.root.position.y-pad.y),index};})).sort((a,b)=>(a.horizontal+a.vertical)-(b.horizontal+b.vertical))[0];
   const atStation=!!dockedStation&&dockedStation.horizontal<8&&dockedStation.vertical<5;
   if(!busy&&atStation&&dockedStation)unit.stationId=dockedStation.station.id;
   if(!busy&&atStation){const pad=dockedStation!.pad;unit.root.position.set(pad.x,pad.y,pad.z);unit.baseY=pad.y;unit.charging=unit.batteryPercent<BASE_BATTERY_PERCENT;}
   if(!busy&&!atStation&&!unit.charging)unit.root.position.set(unit.root.position.x,unit.baseY+Math.sin(this.elapsed*1.7)*.045,unit.root.position.z);
   if(unit.charging){unit.chargeElapsed+=dt;unit.batteryPercent=Math.min(BASE_BATTERY_PERCENT,unit.batteryPercent+CHARGE_RATE_PERCENT_PER_SECOND*dt);if(unit.batteryPercent>=CHARGE_RELEASE_PERCENT){unit.batteryPercent=BASE_BATTERY_PERCENT;unit.charging=false;unit.chargeElapsed=0;}}
   for(const rotor of unit.rotors)rotor.pivot.rotation.y+=dt*30*rotor.direction;
  }
 }

 private dockPad(station:FleetStation,index:number){return this.stationPad(station,Math.max(0,Math.min(station.pads-1,index)));}

 private stationFor(stationId:string){
  const station=(FLEET_STATIONS as readonly FleetStation[]).find(item=>item.id===stationId);
  return station??FLEET_STATIONS[0];
 }

 private stationPad(station:FleetStation,index=0):RoutePoint{
  const pad=warehousePadWorld(station,this.groundHeight,index);
  return {x:pad.x,y:pad.y,z:pad.z};
 }
 private returnPath(from:RoutePoint,station:FleetStation){
  const pad=this.stationPad(station),path=this.flightConnector?.(from,pad)??null;
  if(!path||path.length<2)return null;
  if(this.flightSafetyCheck&&!path.every((point,index)=>index===0||this.flightSafetyCheck!(path[index-1],point)))return null;
  return path;
 }

	  private selectReturnStation(unit:FleetUnit,from:RoutePoint,weather?:WeatherSnapshot){
	  const candidates=FLEET_STATIONS.map(station=>{const path=this.returnPath(from,station),distance=path?cumulative(path).at(-1)??Infinity:Infinity,bearing=Math.atan2(station.x-from.x,station.z-from.z),windPenalty=weather?Math.max(0,weather.windSpeed*Math.cos(bearing-weather.windDirection*Math.PI/180))*3:0;return {station,path,score:distance+windPenalty};}).filter(candidate=>candidate.path);
	  return candidates.sort((a,b)=>a.score-b.score)[0]?.station??null;
	 }

 private landingPoint(point:RoutePoint,_cruiseAltitude:number):RoutePoint{return {...point,y:this.groundHeight(point.x,point.z)+1.2};}
 private appendDiagonalLanding(path:RoutePoint[],ground:RoutePoint){
  const last=path[path.length-1];if(!last)return path;
  const previous=path[path.length-2]??last,dx=last.x-previous.x,dz=last.z-previous.z,length=Math.hypot(dx,dz),run=Math.max(28,Math.min(90,Math.max(6,last.y-ground.y)*.55)),ux=length>.01?dx/length:1,uz=length>.01?dz/length:0;
  // Put the transition point in front of the pad along the route heading.
  // This prevents a pad sharing the cruise point's x/z from becoming a
  // visually vertical elevator move.
  const approach={x:ground.x+ux*run,y:ground.y+(last.y-ground.y)*.42,z:ground.z+uz*run};
  return [...path,approach,ground];
 }
 private appendLanding(path:RoutePoint[],_cruiseAltitude:number){return path;}
 private safePath(path:RoutePoint[],label='航线'){if(path.length<2)return false;for(let index=1;index<path.length;index++){const landing=index===path.length-1;const safe=landing?this.flightSafetyCheck?.(path[index-1],path[index])??true:this.flightSafetyCheck?.(path[index-1],path[index])??true;if(!safe){this.lastDispatchFailure=`${label}第 ${index} 段未通过建筑与空域安全检查`;return false;}}return true;}
 private beginReturn(mission:ActiveMission,message:string){
  const current={x:mission.unit.root.position.x,y:mission.unit.root.position.y,z:mission.unit.root.position.z};
  const returnChoice=this.selectReturnStation(mission.unit,current,mission.weather);if(!returnChoice){mission.phase='failed';mission.safetyMessage='当前没有可用安全返航站 · 任务已中止';this.finishMission(mission,'failed');this.activeMissions.delete(mission.aircraftIndex);this.activeMission=null;return;}
  mission.returnStation=returnChoice;const returnPad=this.stationPad(returnChoice);
  const cruiseStart={x:current.x,y:current.y+Math.max(6,mission.route.cruiseAltitude-1.2),z:current.z};
  const cruisePath=this.returnPath(cruiseStart,mission.returnStation);
  const returnPath=cruisePath?this.appendDiagonalLanding([current,cruiseStart,...cruisePath.slice(1)],returnPad):null;
  if(!returnPath||!this.safePath(returnPath)){mission.phase='failed';mission.safetyMessage='没有找到避开建筑与禁飞区的返航路径 · 任务已中止';this.finishMission(mission,'failed');this.activeMissions.delete(mission.aircraftIndex);this.activeMission=null;return;}
  mission.inbound=returnPath;mission.inboundLengths=cumulative(mission.inbound);mission.inboundDistance=mission.inboundLengths.at(-1)??0;
  mission.routeSegments[2]={id:'return',points:mission.inbound,label:`配送终点 → ${mission.returnStation.name}`,distanceMeters:mission.inboundDistance};mission.travelled=0;mission.segment='return';mission.phase='returning';mission.safetyMessage=message;
 }

 dispatch(route:PlannedRoute,aircraftIndex:number,destinationName:string,cargo:CargoManifest,stationId=FLEET_STATIONS[0].id,weather?:WeatherSnapshot){
  this.lastDispatchFailure='';
  const existing=this.activeMissions.get(aircraftIndex);
  if(!this.loaded){this.lastDispatchFailure='无人机编队尚未完成加载';return false;}
  if(route.points.length<2){this.lastDispatchFailure='航线点不足，无法执行';return false;}
  if(cargo.weightKg>MAX_CARGO_KG||cargo.volumeLiters>40){this.lastDispatchFailure='货物超过无人机载荷限制';return false;}
  const unit=this.units[Math.max(0,Math.min(this.units.length-1,aircraftIndex))];
  if(!unit){this.lastDispatchFailure='未找到对应无人机';return false;}
  if(unit.charging){this.lastDispatchFailure=`${unit.id} 正在充电`;return false;}
  if(existing){
   if(existing.phase!=='returning'){this.lastDispatchFailure=`${unit.id} 正在执行 ${existing.destinationName}，不可改道`;return false;}
   if(existing.estimatedReturnBattery<=BATTERY_RESERVE_PERCENT+8){this.lastDispatchFailure=`${unit.id} 返航余量不足（预计 ${Math.round(existing.estimatedReturnBattery)}%）`;return false;}
   const current={x:unit.root.position.x,y:unit.root.position.y,z:unit.root.position.z},first=route.points[0],returnChoice=this.selectReturnStation(unit,route.points.at(-1)!,weather),energyFactor=BATTERY_DRAIN_PER_KM,diversionPath=this.flightConnector?.(current,{x:first.x,y:first.y,z:first.z})??null;
   if(!diversionPath){this.lastDispatchFailure='无法为返航改道生成安全绕行航线';return false;}
   if(!returnChoice){this.lastDispatchFailure='无法为改道任务选择安全返航站';return false;}
   const returnStation=returnChoice,returnPath=this.returnPath(route.points.at(-1)!,returnStation);
   if(!returnPath){this.lastDispatchFailure='无法为改道任务生成安全返航航线';return false;}
   const diversionDistance=(cumulative(diversionPath).at(-1)??0)+route.distanceMeters+(cumulative(returnPath).at(-1)??0),projected=unit.batteryPercent-diversionDistance/1000*energyFactor;
   if(projected<=BATTERY_RESERVE_PERCENT){this.lastDispatchFailure=`${unit.id} 无法完成改道并保留安全余量（预计 ${Math.round(projected)}%）`;return false;}
   this.finishMission(existing,'cancelled');this.activeMissions.delete(aircraftIndex);
  }
  unit.stationId=stationId;unit.charging=false;
  const current={x:unit.root.position.x,y:unit.root.position.y,z:unit.root.position.z},plannedPoints=route.points.map(point=>({...point}));
  const pickup=plannedPoints[0],destination=plannedPoints[plannedPoints.length-1];
  const pickupGround=this.landingPoint(pickup,route.cruiseAltitude),destinationGround=this.landingPoint(destination,route.cruiseAltitude);
  const climb=this.flightConnector?.(current,pickup)??null;
  if(!climb||climb.length<2){const reason=this.connectorFailureSource?.()??'unknown';this.lastDispatchFailure=`无法为任务起点生成安全起飞绕行航线（${reason}）`;return false;}
  const launch=this.appendDiagonalLanding(climb,pickupGround);
  const delivery=[pickupGround,...plannedPoints.slice(1,-1),destination,destinationGround];
  const home={...current},launchLengths=cumulative(launch),launchDistance=launchLengths.at(-1)??0,deliveryLengths=cumulative(delivery),deliveryDistance=deliveryLengths.at(-1)??0,speed=Math.max(10,route.cruiseSpeed-cargo.weightKg*0.8),energyFactor=BATTERY_DRAIN_PER_KM;
  const returnChoice=this.selectReturnStation(unit,destination,weather);
  if(!returnChoice){this.lastDispatchFailure='无法为任务选择安全返航站';return false;}
  const returnStation=returnChoice,cruisePath=this.returnPath(destination,returnStation);
  const inbound=cruisePath?this.appendDiagonalLanding(cruisePath,this.stationPad(returnStation)):null;
  if(!inbound){this.lastDispatchFailure='无法为任务生成安全返航航线';return false;}
  const outbound=[...launch,...delivery.slice(1)],launchSafe=this.safePath(launch,'起飞段'),deliverySafe=this.safePath(delivery,'配送段'),returnSafe=this.safePath(inbound,'返航段');
  if(!launchSafe||!deliverySafe||!returnSafe){if(!this.lastDispatchFailure)this.lastDispatchFailure='起飞、配送或返航段未通过建筑与空域逐段安全检查';return false;}
  const inboundLengths=cumulative(inbound),inboundDistance=inboundLengths.at(-1)??0,outboundLengths=cumulative(outbound),outboundDistance=outboundLengths.at(-1)??0;
  const estimatedMissionBattery=unit.batteryPercent-(launchDistance+deliveryDistance+inboundDistance)/1000*energyFactor;
  if(estimatedMissionBattery<=BATTERY_RESERVE_PERCENT){this.lastDispatchFailure=`${unit.id} 电量不足，预计任务后仅剩 ${Math.round(estimatedMissionBattery)}%`;return false;}
  const routeSegments:RouteSegment[]=[{id:'launch',points:launch,label:'无人机当前位置 → 配送起点',distanceMeters:launchDistance},{id:'delivery',points:delivery,label:'配送起点 → 配送终点',distanceMeters:deliveryDistance},{id:'return',points:inbound,label:`配送终点 → ${returnStation.name}`,distanceMeters:inboundDistance}];
  const mission:ActiveMission={unit,aircraftIndex,home,launch,delivery,routeSegments,route,cargo,outbound,inbound,returnStation,weather,launchDistance,launchLengths,inboundLengths,outboundLengths,outboundDistance,inboundDistance,travelled:0,batteryDistance:0,deliveryElapsed:0,loadingElapsed:0,unloadingElapsed:0,speed,destinationName,phase:'preflight',segment:'launch',batteryPercent:unit.batteryPercent,estimatedReturnBattery:unit.batteryPercent,safetyMessage:'起飞前检查通过 · 三段航线已确认',cancelRequested:false};this.activeMissions.set(aircraftIndex,mission);this.activeMission=mission;this.missionStartedAtByAircraft.set(aircraftIndex,new Date().toISOString());
  const start=launch[0];unit.root.position.set(start.x,start.y,start.z);unit.baseY=start.y;
  this.syncMissionSnapshot();return true;
 }

 replan(route:PlannedRoute,safetyCheck?:FlightSafetyCheck){
  const mission=this.activeMission;if(!mission||mission.phase==='delivering'||mission.phase==='returning'||route.points.length<2)return false;
  const current=mission.unit.root.position,nearestIndex=route.points.reduce((best,point,index)=>Math.hypot(point.x-current.x,point.z-current.z)<Math.hypot(route.points[best].x-current.x,route.points[best].z-current.z)?index:best,0);
  const start={x:current.x,y:current.y,z:current.z},outbound=[start,...route.points.slice(nearestIndex+1).map(point=>({...point}))];if(outbound.length<2||safetyCheck&&!outbound.every((point,index)=>index===0||safetyCheck(outbound[index-1],point)))return false;
  const returnChoice=this.selectReturnStation(mission.unit,start,mission.weather);if(!returnChoice)return false;
  const returnStation=returnChoice;
  const returnPath=this.returnPath(route.points.at(-1)!,returnStation);if(!returnPath)return false;
  mission.returnStation=returnStation;mission.inbound=this.appendDiagonalLanding(returnPath,this.stationPad(returnStation));mission.outboundLengths=cumulative(outbound);mission.inboundLengths=cumulative(mission.inbound);mission.outboundDistance=mission.outboundLengths.at(-1)??0;mission.inboundDistance=mission.inboundLengths.at(-1)??0;mission.routeSegments[1]={id:'delivery',points:outbound,label:'配送起点 → 配送终点',distanceMeters:mission.outboundDistance};mission.routeSegments[2]={id:'return',points:mission.inbound,label:`配送终点 → ${returnStation.name}`,distanceMeters:mission.inboundDistance};mission.travelled=0;mission.segment='delivery';mission.speed=Math.max(10,route.cruiseSpeed-mission.cargo.weightKg*.8);mission.phase='rerouting';mission.safetyMessage='天气或空域变化 · 已重新规划航线';mission.route=route;this.syncMissionSnapshot();return true;
 }

 cancelMission(){
  const mission=this.activeMission;if(!mission)return false;if(mission.phase==='returning')return false;mission.cancelRequested=true;this.beginReturn(mission,'已取消配送 · 正在安全返航');this.syncMissionSnapshot();return true;
 }

 private updateMissions(dt:number){
  if(this.activeMissions.size===0){this.activeMission=null;return;}
  for(const [aircraftIndex,mission] of [...this.activeMissions]){
   this.activeMission=mission;
   this.updateMission(dt);
   if(this.activeMissions.get(aircraftIndex)===mission&&this.activeMission===null)this.activeMissions.delete(aircraftIndex);
  }
  this.activeMission=this.activeMissions.values().next().value??null;
  if(this.activeMission)this.syncMissionSnapshot();
 }

 private updateMission(dt:number){
  const mission=this.activeMission;if(!mission)return;
  if(mission.phase==='loading'){
   mission.loadingElapsed+=dt;
   const pickup=mission.delivery[0],cruise=mission.delivery[1]??pickup,t=Math.min(1,mission.loadingElapsed/2.2),eased=t*t*(3-2*t);
   // Depart diagonally from the landing point toward the first cruise point.
   mission.unit.root.position.set(pickup.x+(cruise.x-pickup.x)*eased,pickup.y+(cruise.y-pickup.y)*eased,pickup.z+(cruise.z-pickup.z)*eased);
   if(mission.loadingElapsed>=2.2){mission.loadingElapsed=0;mission.phase='enroute';mission.segment='delivery';mission.travelled=0;mission.safetyMessage='起点已降落取货 · 正在斜向起飞前往配送终点';}
   this.syncMissionSnapshot();return;
  }
  if(mission.phase==='delivering'){
   mission.unloadingElapsed+=dt;const destination=mission.delivery[mission.delivery.length-1],cruise=mission.delivery[Math.max(0,mission.delivery.length-2)]??destination,t=Math.min(1,mission.unloadingElapsed/2.2),eased=t*t*(3-2*t);mission.unit.root.position.set(cruise.x+(destination.x-cruise.x)*eased,cruise.y+(destination.y-cruise.y)*eased,cruise.z+(destination.z-cruise.z)*eased);
   if(mission.unloadingElapsed>=2.2){mission.unloadingElapsed=0;this.beginReturn(mission,'终点已降落投递 · 正在前往安全物流站');}
   this.syncMissionSnapshot();return;
  }
  if(mission.phase==='rerouting'){mission.phase='enroute';}
  if(mission.phase==='preflight'){mission.phase='launching';mission.safetyMessage='起飞检查完成 · 正在前往配送起点';}
  const returning=mission.segment==='return',launching=mission.segment==='launch',points=returning?mission.inbound:launching?mission.launch:mission.delivery,lengths=returning?mission.inboundLengths:launching?cumulative(mission.launch):cumulative(mission.delivery),total=lengths[lengths.length-1]??0;
  const previousTravelled=mission.travelled;
  mission.travelled=Math.min(total,mission.travelled+mission.speed*dt);
  const distanceDelta=Math.max(0,mission.travelled-previousTravelled);
  mission.batteryDistance+=distanceDelta;
  const energyFactor=BATTERY_DRAIN_PER_KM;
  mission.batteryPercent=Math.max(0,mission.batteryPercent-(distanceDelta/1000)*energyFactor);mission.unit.batteryPercent=mission.batteryPercent;
  const remainingCurrent=Math.max(0,total-mission.travelled),returnDistance=returning?remainingCurrent:mission.inboundDistance;
  mission.estimatedReturnBattery=Math.max(0,mission.batteryPercent-(returnDistance/1000)*energyFactor);
  if(!returning&&mission.estimatedReturnBattery<=BATTERY_RESERVE_PERCENT&&mission.batteryPercent<=BATTERY_RESERVE_PERCENT){this.beginReturn(mission,'电量达到返航阈值 · 自动返航');this.syncMissionSnapshot();return;}
  this.missionPrevious.copyFrom(mission.unit.root.position);samplePath(points,lengths,mission.travelled,this.missionPosition);
  if(!returning&&this.flightSafetyCheck&&!this.flightSafetyCheck({x:mission.unit.root.position.x,y:mission.unit.root.position.y,z:mission.unit.root.position.z},{x:this.missionPosition.x,y:this.missionPosition.y,z:this.missionPosition.z})){this.beginReturn(mission,'执行期安全校验未通过 · 正在返航');this.syncMissionSnapshot();return;}
  mission.unit.root.position.copyFrom(this.missionPosition);
  const dx=this.missionPosition.x-this.missionPrevious.x,dz=this.missionPosition.z-this.missionPrevious.z;if(Math.hypot(dx,dz)>.01)mission.unit.root.rotation.y=Math.atan2(dx,dz);
  if(mission.travelled>=total-.01){
  if(launching){const pickup=mission.delivery[0];mission.phase='loading';mission.loadingElapsed=0;mission.travelled=total;mission.safetyMessage='已到达配送起点 · 正在沿曲线下降取货';mission.delivery[0]=pickup;}
   else if(returning){const pad=this.stationPad(mission.returnStation);mission.unit.root.position.set(pad.x,pad.y,pad.z);mission.unit.baseY=pad.y;mission.unit.stationId=mission.returnStation.id;mission.unit.charging=mission.unit.batteryPercent<BASE_BATTERY_PERCENT;mission.unit.chargeElapsed=0;mission.unit.batteryPercent=mission.batteryPercent;const finalPhase=mission.cancelRequested?'cancelled':'completed';this.finishMission(mission,finalPhase);this.missionSnapshot={phase:finalPhase,progress:1,aircraftIndex:mission.aircraftIndex,routeId:mission.route.id,destinationName:mission.destinationName,routeSegments:mission.routeSegments.map((segment:RouteSegment)=>({...segment,points:segment.points.map((point:RoutePoint)=>({...point}))})),orderId:mission.cargo.orderId,cargoWeightKg:mission.cargo.weightKg,distanceRemaining:0,simulatedSpeed:mission.speed,batteryPercent:mission.batteryPercent,estimatedReturnBattery:mission.batteryPercent,safetyMessage:finalPhase==='cancelled'?'任务已取消 · 已安全返航':'已返航并完成任务'};this.activeMissions.delete(mission.aircraftIndex);this.activeMission=null;return;}
   else{mission.phase='delivering';mission.unloadingElapsed=0;mission.travelled=total;mission.safetyMessage='已到达配送终点上空 · 正在沿曲线下降投递';}
  }
  this.syncMissionSnapshot();
 }

 private finishMission(mission:ActiveMission,phase:'completed'|'cancelled'|'failed'){
  this.missionRecords.push({orderId:mission.cargo.orderId,destinationName:mission.destinationName,aircraftIndex:mission.aircraftIndex,originStationId:mission.unit.stationId,routeId:mission.route.id,cargoDescription:mission.cargo.description,cargoWeightKg:mission.cargo.weightKg,phase,startedAt:this.missionStartedAtByAircraft.get(mission.aircraftIndex)??new Date().toISOString(),finishedAt:new Date().toISOString(),distanceMeters:mission.outboundDistance+mission.inboundDistance,batteryPercent:mission.batteryPercent,safetyMessage:phase==='cancelled'?'任务已取消 · 已安全返航':'已返航并完成任务'});
 }

 private syncMissionSnapshot(){
  const mission=this.activeMission;if(!mission)return;const returning=mission.phase==='returning',total=returning?mission.inboundDistance:mission.outboundDistance,progress=mission.phase==='delivering'?1:Math.max(0,Math.min(1,mission.travelled/Math.max(1,total)));this.missionSnapshot={phase:mission.phase,progress,aircraftIndex:mission.aircraftIndex,routeId:mission.route.id,destinationName:mission.destinationName,routeSegments:mission.routeSegments.map((segment:RouteSegment)=>({...segment,points:segment.points.map((point:RoutePoint)=>({...point}))})),orderId:mission.cargo.orderId,cargoWeightKg:mission.cargo.weightKg,distanceRemaining:Math.max(0,total-mission.travelled),simulatedSpeed:mission.speed,batteryPercent:mission.batteryPercent,estimatedReturnBattery:mission.estimatedReturnBattery,safetyMessage:mission.safetyMessage};
 }

 get dispatchFailure(){return this.lastDispatchFailure;}
 get missions(){return [...this.activeMissions.values()].map(mission=>({aircraftIndex:mission.aircraftIndex,stationId:mission.unit.stationId,phase:mission.phase,routeId:mission.route.id,points:mission.route.points.map(point=>({x:point.x,z:point.z})),routeSegments:mission.routeSegments.map(segment=>({id:segment.id,points:segment.points.map(point=>({x:point.x,z:point.z}))})),progress:mission.phase==='delivering'?1:Math.min(1,mission.travelled/Math.max(1,mission.outboundDistance)),destinationName:mission.destinationName,orderId:mission.cargo.orderId,batteryPercent:mission.batteryPercent,estimatedReturnBattery:mission.estimatedReturnBattery}));}

 focus(index=0){const unit=this.units[Math.max(0,Math.min(this.units.length-1,index))];return {x:unit.root.position.x,y:unit.root.position.y+.55*DISPLAY_SCALE,z:unit.root.position.z};}
 get records(){return this.missionRecords.map(record=>({...record}));}
 get mission(){return {...this.missionSnapshot};}
 get missionActive(){return !!this.activeMission;}
 get activeMissionCount(){return this.activeMissions.size;}
 get stats(){return {asset:ASSET_URL,loaded:this.loaded,count:this.units.length,meshes:this.meshes.length,rotors:this.units.reduce((sum,unit)=>sum+unit.rotors.length,0),activeRotors:this.units.find(unit=>unit.active)?.rotors.length??0,rotorRadians:this.rotorRadians,hiddenSourceBlades:this.hiddenSourceBlades,scale:DISPLAY_SCALE,enabled:this.root.isEnabled(),mission:this.mission,units:this.units.map((unit,index)=>({id:unit.id,stationId:unit.stationId,charging:unit.charging,active:this.activeMissions.has(index),available:(this.activeMissions.get(index)?.phase==='returning'&&this.activeMissions.get(index)!.estimatedReturnBattery>BATTERY_RESERVE_PERCENT+8)||(!this.activeMissions.has(index)&&!unit.charging&&unit.batteryPercent>=BATTERY_RESERVE_PERCENT), batteryPercent:unit.batteryPercent,position:unit.root.position.asArray(),rotors:unit.rotors.length}))};}
 dispose(){this.root.dispose(false,true);this.bladeMaterial.dispose(true,true);this.blurMaterial.dispose(true,true);}
}
