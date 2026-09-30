import {Matrix,Vector3} from '@babylonjs/core';
import type {DrivingWorld} from './city-world.ts';
import {isUnnamedRoad} from './city-road-names.ts';

type Place={id:string;name:string;nameEn?:string;category:string;kind?:string;x:number;z:number};
type PointLabel={id:string;name:string;x:number;z:number;priority:number;kind:'district'|'place'|'landmark'};
type RoadLabel={id:string;name:string;x:number;z:number;ax:number;az:number;bx:number;bz:number;priority:number;kind:'road'};
type Label=PointLabel|RoadLabel;
type ScreenLabel={label:Label;x:number;y:number;angle:number;width:number;height:number;alpha:number;score:number;range:number};

const identity=Matrix.Identity();
const ROAD_PRIORITY:Record<string,number>={motorway:96,trunk:92,primary:86,secondary:76,tertiary:66,residential:52,service:42};
const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value));
const mix=(from:number,to:number,amount:number)=>from+(to-from)*amount;
const smoothstep=(from:number,to:number,value:number)=>{const amount=clamp((value-from)/(to-from));return amount*amount*(3-2*amount);};

export function twinLabelVisibility(distance:number,pitch:number,viewportHeight:number){
 const overhead=smoothstep(.12,.58,Math.max(0,pitch));return {roadRadius:mix(900+Math.min(350,distance*.12),2600+Math.min(2400,distance*.6),overhead),placeRadius:mix(1350+Math.min(500,distance*.18),3600+Math.min(3200,distance*.7),overhead),horizonGuard:Math.max(78,Math.min(viewportHeight*.46,viewportHeight*(.46-Math.max(0,pitch)*.65)))};
}

function project(world:DrivingWorld,x:number,z:number,height:number,width:number,canvasWidth:number,canvasHeight:number){
 const viewport=world.camera.viewport.toGlobal(width,world.engine.getRenderHeight()),point=Vector3.Project(new Vector3(x,height,z),identity,world.scene.getTransformMatrix(),viewport);
 if(point.z<=0||point.z>=1)return null;
 return{x:point.x/width*canvasWidth,y:point.y/world.engine.getRenderHeight()*canvasHeight};
}

function roadLabels(world:DrivingWorld){
 const selected=new Map<string,{road:(typeof world.data.roads)[number];length:number}>();
 for(const road of world.data.roads){
  if(isUnnamedRoad(road)||road.points.length<2)continue;
  let length=0;for(let index=1;index<road.points.length;index++)length+=Math.hypot(road.points[index][0]-road.points[index-1][0],road.points[index][1]-road.points[index-1][1]);
  const previous=selected.get(road.name);if(!previous||length>previous.length)selected.set(road.name,{road,length});
 }
 const labels:RoadLabel[]=[];
 for(const [name,{road}] of selected){
  let longest=0,a=road.points[0],b=road.points[1];
  for(let index=1;index<road.points.length;index++){const next=road.points[index],previous=road.points[index-1],length=Math.hypot(next[0]-previous[0],next[1]-previous[1]);if(length>longest){longest=length;a=previous;b=next;}}
  const kind=road.kind.replace(/_link$/,''),priority=(ROAD_PRIORITY[kind]??48)-(road.kind.endsWith('_link')?5:0);
  labels.push({id:`road-${road.id}`,name,x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,ax:a[0],az:a[1],bx:b[0],bz:b[1],priority,kind:'road'});
 }
 return labels;
}

function placePriority(place:Place){
 if(place.category==='district')return place.kind==='city'?115:place.kind==='suburb'?82:place.kind==='quarter'?68:60;
 if(place.category==='transport')return 72;
 if(place.category==='park')return 66;
 return 62;
}

export function createTwinMapLabels(root:HTMLElement,world:DrivingWorld,districts:readonly {id:string;name:string;x:number;z:number}[]=[]){
 const layer=root.querySelector<HTMLElement>('.twin-map-label-layer')!,canvas=document.createElement('canvas');canvas.className='twin-navigation-label-canvas';layer.replaceChildren(canvas);
 const districtNames=new Set(districts.map(item=>item.name));
 const districtLabels:PointLabel[]=districts.map(item=>({id:`district-${item.id}`,name:item.name,x:item.x,z:item.z,priority:200,kind:'district'}));
 const landmarks:PointLabel[]=world.data.landmarks.map(place=>({id:`landmark-${place.id}`,name:place.name.replace(' · ',' '),x:place.x,z:place.z,priority:104,kind:'landmark'}));
 const roads=roadLabels(world);let places:PointLabel[]=[];
 void fetch(new URL('../data/map-places.json',import.meta.url)).then(response=>response.ok?response.json():null).then((catalog:{places?:Place[]}|null)=>{
  places=(catalog?.places??[]).filter(place=>place.name&&Number.isFinite(place.x+place.z)&&!districtNames.has(place.name)).map(place=>({id:place.id,name:place.name,x:place.x,z:place.z,priority:placePriority(place),kind:place.category==='district'&&place.kind==='city'?'district':'place'}));
 }).catch(()=>{});
 let elapsed=0,shown=0,shownRange=0,roadVisibilityRadius=0,placeVisibilityRadius=0,horizonGuard=0;
 function update(dt=1){
  elapsed+=dt;if(elapsed<.12)return;elapsed=0;
  const distance=world.observer.distance,bounds=layer.getBoundingClientRect();if(!bounds.width||!bounds.height)return;
  const ratio=Math.min(1.5,devicePixelRatio||1),pixelWidth=Math.round(bounds.width*ratio),pixelHeight=Math.round(bounds.height*ratio);if(canvas.width!==pixelWidth||canvas.height!==pixelHeight){canvas.width=pixelWidth;canvas.height=pixelHeight;canvas.style.width=bounds.width+'px';canvas.style.height=bounds.height+'px';}
  const context=canvas.getContext('2d')!;context.setTransform(ratio,0,0,ratio,0,0);context.clearRect(0,0,bounds.width,bounds.height);shown=0;shownRange=0;const followView=world.photoTarget?.id.startsWith('greenroute-drone-')??false;if(distance<250&&!followView)return;
  const camera=world.observer.pose(),focus=world.observer.focus,pitch=Math.max(0,world.observer.pitch),overhead=smoothstep(.12,.58,pitch);
  const safeLeft=root.classList.contains('map-expanded')||innerWidth<761||followView?24:352,safeRight=root.classList.contains('map-expanded')||innerWidth<761||followView?24:382;
  const visibility=twinLabelVisibility(distance,pitch,bounds.height),roadRadius=followView?Math.min(visibility.roadRadius,900):visibility.roadRadius,placeRadius=followView?Math.min(visibility.placeRadius,1200):visibility.placeRadius;horizonGuard=visibility.horizonGuard;roadVisibilityRadius=roadRadius;placeVisibilityRadius=placeRadius;
  const roadMinimum=followView?40:distance>18000?Infinity:distance>10500?90:distance>6500?82:distance>3500?70:distance>1600?58:40;
  const placeMinimum=followView?48:distance>22000?Infinity:distance>12000?100:distance>6500?75:distance>3000?62:50;
  const budget=followView?100:distance>22000?18:distance>12000?36:distance>6500?64:distance>3000?95:150;
  const showDistricts=!followView&&distance>1500&&pitch>.3;
  const labels:Label[]=[...(showDistricts?districtLabels:[]),...landmarks.filter(label=>distance<(followView?5000:18000)),...places.filter(label=>label.priority>=placeMinimum),...roads.filter(label=>label.priority>=roadMinimum)];
  const candidates:ScreenLabel[]=[];
  for(const label of labels){
   const radius=label.kind==='road'?roadRadius:label.kind==='place'?placeRadius:label.kind==='landmark'?(followView?1200:mix(1750+Math.min(650,distance*.2),4400+Math.min(3600,distance*.75),overhead)):mix(3200,9000,overhead),focusDistance=Math.hypot(label.x-focus.x,label.z-focus.z),cameraDistance=Math.hypot(label.x-camera.x,label.z-camera.z);
   const range=Math.max(focusDistance,cameraDistance*.82),normalized=range/radius;if(normalized>=1)continue;
   const labelHeight=label.kind==='district'?4:label.kind==='landmark'?3:label.kind==='road'?1.5:2.5;
   const point=project(world,label.x,label.z,labelHeight,world.engine.getRenderWidth(),bounds.width,bounds.height);if(!point||point.x<safeLeft||point.x>bounds.width-safeRight||point.y<horizonGuard||point.y>bounds.height-105)continue;
   let angle=0;if(label.kind==='road'){const a=project(world,label.ax,label.az,1.5,world.engine.getRenderWidth(),bounds.width,bounds.height),b=project(world,label.bx,label.bz,1.5,world.engine.getRenderWidth(),bounds.width,bounds.height);if(!a||!b)continue;angle=Math.atan2(b.y-a.y,b.x-a.x);if(angle>Math.PI/2)angle-=Math.PI;if(angle<-Math.PI/2)angle+=Math.PI;}
   const size=label.kind==='district'?17:label.kind==='landmark'?12:11,width=Math.max(32,label.name.length*size*.98)+(label.kind==='place'?13:0),height=label.kind==='district'?25:17;
   const rangeFade=1-smoothstep(.7,1,normalized),horizonFade=smoothstep(horizonGuard,horizonGuard+Math.min(90,bounds.height*.15),point.y),alpha=rangeFade*horizonFade;if(alpha<.12)continue;
   candidates.push({label,x:point.x,y:point.y,angle,width,height,alpha,score:label.priority-normalized*28,range});
  }
  const accepted:{x:number;y:number;width:number;height:number}[]=[];
  for(const candidate of candidates.sort((a,b)=>b.score-a.score||a.label.name.localeCompare(b.label.name,'zh-CN'))){
   if(shown>=budget)break;const spread=Math.abs(Math.sin(candidate.angle))*candidate.width*.28,box={x:candidate.x-candidate.width/2-spread,y:candidate.y-candidate.height/2,width:candidate.width+spread*2,height:candidate.height};
   if(accepted.some(other=>box.x<other.x+other.width+8&&box.x+box.width+8>other.x&&box.y<other.y+other.height+5&&box.y+box.height+5>other.y))continue;
   drawLabel(context,candidate);accepted.push(box);shown++;shownRange=Math.max(shownRange,candidate.range);
  }
 }
 function dispose(){canvas.remove();}
 world.scene.onDisposeObservable.addOnce(dispose);
 return {update,dispose,visibilityAt:twinLabelVisibility,get count(){return districtLabels.length+landmarks.length+places.length+roads.length;},get shown(){return shown;},get shownRange(){return shownRange;},get visibility(){return {roadRadius:roadVisibilityRadius,placeRadius:placeVisibilityRadius,horizonGuard};}};
}

function drawLabel(context:CanvasRenderingContext2D,candidate:ScreenLabel){
 const {label,x,y,angle}=candidate;context.save();context.translate(x,y);if(label.kind==='road')context.rotate(angle);
 const font=label.kind==='district'?'600 16px "Microsoft YaHei",sans-serif':label.kind==='landmark'?'600 12px "Microsoft YaHei",sans-serif':label.kind==='road'?'500 10px "Microsoft YaHei",sans-serif':'500 10px "Microsoft YaHei",sans-serif';context.font=font;context.textAlign='center';context.textBaseline='middle';context.lineJoin='round';context.globalAlpha=(label.kind==='district'?.92:label.kind==='landmark'?.96:label.kind==='road'?.94:.90)*candidate.alpha;
 if(label.kind==='place'){context.beginPath();context.arc(-candidate.width/2+5,0,2.5,0,Math.PI*2);context.fillStyle='#239585';context.fill();context.translate(6,0);}
 context.lineWidth=label.kind==='district'?3.2:1.9;context.strokeStyle='rgba(255,253,246,.78)';context.strokeText(label.name,0,0);context.fillStyle=label.kind==='district'?'#275b62':label.kind==='road'?'#3e595b':label.kind==='landmark'?'#0f6c60':'#315f58';context.fillText(label.name,0,0);context.restore();
}
