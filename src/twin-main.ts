import './style.css';
import {DrivingWorld} from './city-world.ts';
import {Warehouse,SHENZHEN_WAREHOUSE} from './warehouse/warehouse.ts';
import {GreenRouteFleet} from './drone/greenroute-drone.ts';
import {createTwinShell,type TwinLayer,type TwinViewMode} from './ui/twin-shell.ts';
import type {MissionDestination} from './low-altitude-types.ts';
import {applyTwinMapStyle} from './city-twin-map-style.ts';
import {createTwinMapContext} from './city-twin-map-context.ts';
import {createTwinMapLabels} from './city-twin-map-labels.ts';
import {loadTwinDistrictLabels} from './city-twin-overview-map.ts';
import {OFFLINE_WEATHER,loadCurrentWeather} from './low-altitude-weather.ts';
import {LowAltitudeRoutePlanner} from './low-altitude-route-planner.ts';
import {LowAltitudeRouteLayer} from './low-altitude-route-layer.ts';
import type {MissionRequest,PlannedRoute,RouteKind,WeatherSnapshot} from './low-altitude-types.ts';
import {loadMissionDestinations,mergeCityDestinations} from './low-altitude-destination-search.ts';
import {createTimeSky} from './city-time-sky.ts';
import {FLEET_STATIONS,chooseAircraft,aircraftAvailabilityMessage} from './low-altitude-stations.ts';
import {AIRSPACE_REFERENCE,SIMULATED_AIRSPACE_ZONES} from './low-altitude-airspace.ts';

const canvas=document.querySelector<HTMLCanvasElement>('#game')!;
const ui=document.querySelector<HTMLDivElement>('#ui')!;

let world:DrivingWorld|undefined;
let warehouse:Warehouse|undefined;
let stationWarehouses:Warehouse[]=[];
let fleet:GreenRouteFleet|undefined;
let mapLabels:ReturnType<typeof createTwinMapLabels>|undefined;
let routePlanner:LowAltitudeRoutePlanner|undefined;
let routeLayer:LowAltitudeRouteLayer|undefined;
let plannedRoutes:PlannedRoute[]=[];
let activeRoute:RouteKind='balanced';
let activeMission:MissionRequest|undefined;
let droneFollowIndex:number|null=null;
let planningVersion=0;
let telemetryTick=0;
let resourceStep=0;
let currentWeather:WeatherSnapshot=OFFLINE_WEATHER;
let timeSky:ReturnType<typeof createTimeSky>|undefined;
const layerEnabled:Record<TwinLayer,boolean>={warehouse:true,drone:true,airspace:true,weather:true};
let missionDestinations:MissionDestination[]=[
 {id:'splendid-china-dropoff',name:'锦绣中华民俗村旁配送点',detail:'南山 · 景区配送',x:-2553.55,z:-175.26},
 {id:'shennan-xiangmi-dropoff',name:'深南大道 · 香蜜社区配送点',detail:'福田 · 道路与社区之间',x:-10,z:420},
 {id:'huanggang-xiawei-dropoff',name:'皇岗下围一村配送点',detail:'福田 · 社区配送',x:2014.75,z:-600.86},
 {id:'minxin-dropoff',name:'民新社区配送点',detail:'龙华 · 社区配送',x:5856.48,z:1877.57},
 {id:'sihai-park-dropoff',name:'四海公园配送点',detail:'南山 · 公园驿站',x:-6333.31,z:-2466.40},
];

function hasActiveMissions(){return !!fleet?.missionActive||((fleet?.activeMissionCount??0)>0);}

const cityOverviewLandmark=()=>({
 id:SHENZHEN_WAREHOUSE.id,name:SHENZHEN_WAREHOUSE.name,area:'深圳 · 南山科技园',x:SHENZHEN_WAREHOUSE.x,z:SHENZHEN_WAREHOUSE.z,height:8,excludeRadius:0,
 arrival:[SHENZHEN_WAREHOUSE.x,SHENZHEN_WAREHOUSE.z] as [number,number],yaw:SHENZHEN_WAREHOUSE.heading,photoDistance:720,photoElevation:.22,photoAngle:.48,photoTargetHeight:8,
});

const droneLandmark=(index:number,follow=false)=>{
 const focus=fleet!.focus(index);return {
  id:`greenroute-drone-${index+1}`,name:`GreenRoute G1 · ${String(index+1).padStart(2,'0')}`,area:`GR-UAV-${String(index+1).padStart(2,'0')} · 南山起降坪`,x:focus.x,z:focus.z,height:2.5,excludeRadius:0,
  arrival:[focus.x,focus.z] as [number,number],yaw:SHENZHEN_WAREHOUSE.heading,photoDistance:follow?120:8,photoElevation:follow?.28:.52,photoAngle:follow?.65:2.53,photoTargetHeight:focus.y,
 };
};

async function planMission(request:MissionRequest,silent=false){
 if(!world?.ready||!routePlanner){shell.notify('城市航路数据仍在准备，请稍候');return;}
 if(fleet?.missionActive&&!silent)shell.notify('配送执行中仍可继续规划新任务，系统将在派发时自动调度无人机');
 const origin=missionDestinations.find(item=>item.id===request.originId),destination=missionDestinations.find(item=>item.id===request.destinationId);
 if(!origin||!destination){shell.notify('未找到起点或终点地点');return;}
 const version=++planningVersion;activeMission={...request};shell.setPlanning(true,`正在规划 ${origin.name} → ${destination.name}`);await new Promise<void>(resolve=>window.setTimeout(resolve,40));
 const routes=await routePlanner.plan({x:origin.x,z:origin.z},destination,currentWeather);if(version!==planningVersion)return;plannedRoutes=routes;activeRoute=routes.some(route=>route.id==='balanced')?'balanced':routes[0]?.id??'fastest';routeLayer?.setRoutes(routes,activeRoute);shell.setRoutes(routes,activeRoute);
 if(!routes.length)shell.notify('当前约束下未找到安全航线，请更换起终点或天气条件');else if(!silent)shell.notify(`已生成 ${routes.length} 条候选航线`);
}

function enterDroneView(index:number){
 if(!world?.ready||!fleet){shell.notify('无人机编队仍在载入，请稍候');return;}
 droneFollowIndex=Math.max(0,Math.min(fleet.units.length-1,index));routeLayer?.setDroneFollowMode(true);world.setObserverDragMode('rotate');world.enterPhoto(droneLandmark(droneFollowIndex,true));shell.setMode('drone');shell.setDroneFollow(droneFollowIndex);shell.notify(`正在跟随 GR-UAV-${String(droneFollowIndex+1).padStart(2,'0')} · 可沿航线观察`);canvas.focus();
}

function setView(mode:TwinViewMode){
 if(!world?.ready||!warehouse){shell.notify('地图仍在后台初始化，请稍候');return;}
 if(mode==='drone'){enterDroneView(fleet?.mission?.aircraftIndex??droneFollowIndex??0);return;}
 droneFollowIndex=null;routeLayer?.setDroneFollowMode(false);shell.setDroneFollow(null);
 if(mode==='home'){
  world.setObserverDragMode('rotate');world.enterPhoto(cityOverviewLandmark());shell.setMode('home');shell.notify('已返回南山低空物流中心 · 真实道路与地名已加载');
 }else{
  if(!world.observer.active)world.enterPhoto(cityOverviewLandmark());world.setObserverDragMode(mode);shell.setMode(mode);
  shell.notify(mode==='rotate'?'旋转视角已启用 · 左拖环绕，右拖平移':'平移视角已启用 · 拖动画面移动，滚轮缩放');
 }
 canvas.focus();
}

function cameraCoordinates(){
 const focus=world!.observer.focus;return {longitude:114.025+focus.x/(102850*.6),latitude:22.536+focus.z/(111320*.6)};
}

function materialColor(name:string){
 const material=world?.scene.getMaterialByName(name) as unknown as {albedoColor?:{r:number;g:number;b:number}}|null, color=material?.albedoColor;
 return color?[color.r,color.g,color.b]:null;
}

const shell=createTwinShell(ui,{
 destinations:missionDestinations,
 stations:FLEET_STATIONS,
 onViewChange:setView,
 onExpandChange:()=>requestAnimationFrame(()=>world?.engine.resize()),
 onFocusDrone:index=>enterDroneView(index),
 onLayerChange:(layer,enabled)=>{
  layerEnabled[layer]=enabled;
  if(layer==='warehouse')for(const item of stationWarehouses)item.root.setEnabled(enabled);
  if(layer==='drone')fleet?.root.setEnabled(enabled);
  if(layer==='airspace')routeLayer?.setAirspaceVisible(enabled);
  if(layer==='weather')routeLayer?.setWeatherVisible(enabled);
  shell.notify((layer==='warehouse'?'仓库设施':layer==='drone'?'无人机编队':layer==='airspace'?'仿真空域':'天气风险')+(enabled?'已显示':'已隐藏'));
 },
 onPlanRequest:request=>void planMission(request),
 onRouteSelect:route=>{activeRoute=route;routeLayer?.select(route);shell.notify(`已选择${route==='fastest'?'最快':route==='safest'?'最低风险':'综合'}路线`);},
 onRouteFocus:route=>{
  if(!world?.ready)return;droneFollowIndex=null;routeLayer?.setDroneFollowMode(false);shell.setDroneFollow(null);const focus=routeLayer?.focus(route);if(!focus)return;world.setObserverDragMode('rotate');world.enterPhoto({id:`route-${route}`,name:'低空配送航线',area:'航线全览',x:focus.x,z:focus.z,height:0,excludeRadius:0,arrival:[focus.x,focus.z],yaw:0,photoDistance:focus.distance,photoElevation:.7,photoAngle:.35,photoTargetHeight:55});shell.setMode('rotate');shell.notify('已聚焦完整航线 · 可拖动检查建筑与空域净空');
 },
 onMissionStart:route=>{
  if(!fleet){shell.notify('无人机编队仍在载入，请稍候');return;}
  const request=activeMission,destination=request?missionDestinations.find(item=>item.id===request.destinationId):undefined,origin=request?missionDestinations.find(item=>item.id===request.originId):undefined;
  const planned=plannedRoutes.find(item=>item.id===route);
  if(!planned||!request||!destination||!origin){shell.notify('请先计算一条有效航线');return;}
  const aircraftCandidates=fleet.stats.units.map((unit,index)=>({aircraftIndex:index,available:unit.available,batteryPercent:unit.batteryPercent,position:{x:unit.position[0],z:unit.position[2]},stationId:unit.stationId}));
  const assignment=chooseAircraft(request,aircraftCandidates,FLEET_STATIONS,origin);
  if(!assignment){shell.notify(aircraftAvailabilityMessage(request,aircraftCandidates));return;}
  const aircraftIndex=assignment.aircraftIndex;
  if(fleet.dispatch(planned,aircraftIndex,destination.name,request.cargo,assignment.stationId,currentWeather)){activeRoute=route;routeLayer?.setMissionSegments(fleet.mission.routeSegments??[]);routeLayer?.clearCandidateRoutes();shell.setRoutes([planned],route);shell.setMissionStatus(fleet.mission);shell.notify(`${fleet.units[aircraftIndex]?.id??'无人机'} 已接单 · 当前可继续派发其他订单 · 前往 ${destination.name}`);}else shell.notify(fleet.dispatchFailure||'当前没有可执行该任务的无人机');
 },
 onMissionCancel:()=>{if(fleet?.cancelMission()){shell.setMissionStatus(fleet.mission);shell.notify('配送已取消 · 无人机正在返航');}},
});
shell.setWeather(currentWeather);
shell.setMissionStatus({phase:'idle',progress:0,aircraftIndex:0,routeId:null,destinationName:'',orderId:'',cargoWeightKg:0,distanceRemaining:0,simulatedSpeed:0,batteryPercent:100,estimatedReturnBattery:100,safetyMessage:'等待任务'});
void loadMissionDestinations(missionDestinations).then(destinations=>{missionDestinations=world?.data?mergeCityDestinations(destinations,world.data):destinations;shell.setDestinations(missionDestinations);});

async function refreshWeather(){
 const previous=currentWeather;currentWeather=await loadCurrentWeather();shell.setWeather(currentWeather);routeLayer?.updateWeather(currentWeather);
 if(currentWeather.source==='offline')shell.notify('实时天气暂不可用，已切换为明确标记的离线估算');
 if(activeMission&&previous.observedAt!==currentWeather.observedAt&&currentWeather.flightIndex<55){shell.notify('天气风险升高 · 正在返航');for(const mission of fleet?.missions??[])if(mission.phase!=='completed'&&mission.phase!=='cancelled')fleet?.cancelMission();}
 else if(activeMission&&previous.observedAt!==currentWeather.observedAt){shell.notify('天气已更新 · 当前航线保持不变');}
}

void refreshWeather();
const weatherTimer=window.setInterval(()=>void refreshWeather(),5*60*1000);
window.addEventListener('pagehide',()=>window.clearInterval(weatherTimer),{once:true});

window.addEventListener('keydown',event=>{
 if(event.target instanceof HTMLElement&&event.target.closest('input,textarea,select,[contenteditable=true]'))return;
 if((event.code==='Home'||event.code==='KeyR')&&!event.repeat){event.preventDefault();setView('home');}
});

async function boot(){
 try{
  shell.setLoadingProgress('正在加载深圳核心城区',3);shell.setSystemState('初始化',false,'正在加载本地道路、地名与三维建筑');
  world=new DrivingWorld(canvas);world.setTwinMode(true);world.scene.clearColor.set(.68,.77,.80,1);world.onMessage=message=>shell.notify(message);
  await world.init(reportResource);
  missionDestinations=mergeCityDestinations(missionDestinations,world.data);shell.setDestinations(missionDestinations);
  routePlanner=new LowAltitudeRoutePlanner(world.data,world.groundHeight);
  routeLayer=new LowAltitudeRouteLayer(world.scene,world.groundHeight);routeLayer.updateWeather(currentWeather);
  createTwinMapContext(world.scene,world.data.meta.extent,world.groundHeight);world.mapNavigationExtent=world.data.meta.extent;
  shell.setLoadingProgress('正在建设多站点低空物流网络',92);shell.setSystemState('初始化',false,'正在建设多站点低空物流网络');
  stationWarehouses=FLEET_STATIONS.map(station=>new Warehouse(world!.scene,world!.groundHeight,station));warehouse=stationWarehouses[0];
  world.scene.onDisposeObservable.addOnce(()=>{for(const item of stationWarehouses)item.dispose();});
  const shadowMap=world.shadows.getShadowMap();if(shadowMap?.renderList)for(const item of stationWarehouses)shadowMap.renderList.push(...item.shadowCasters);
  shell.setLoadingProgress('正在装载五架 GreenRoute G1 无人机',96);shell.setSystemState('初始化',false,'正在装载五架 GreenRoute G1 无人机');
  const positions=FLEET_STATIONS.flatMap((station,stationIndex)=>{const model=stationWarehouses[stationIndex];const first=model.landingPadWorld(0);first.y+=stationIndex===0?1.2:.04;const second=stationIndex===0?model.landingPadWorld(1):null;if(second)second.y+=.04;return second?[first,second]:[first];}).slice(0,5);
  const stationIds=FLEET_STATIONS.map(station=>station.id).slice(0,5);
  fleet=new GreenRouteFleet(world.scene,positions,SHENZHEN_WAREHOUSE.heading,stationIds,world.groundHeight);fleet.setFlightSafetyCheck((a,b)=>routePlanner?.isFlightPathSafe([a,b])??false);fleet.setFlightConnector((from,to)=>routePlanner?.connector(from,to,currentWeather)??null);fleet.setConnectorFailureSource(()=>routePlanner?.connectorFailure??'planner-unavailable');await fleet.load();world.scene.onDisposeObservable.addOnce(()=>fleet?.dispose());
  if(shadowMap?.renderList)shadowMap.renderList.push(...fleet.shadowCasters);
  world.setTwinMode(true);world.setLightMode('day');applyTwinMapStyle(world.scene);timeSky=createTimeSky(world.scene,world.skyMat);
  const districtLabels=await loadTwinDistrictLabels(world.data);
  mapLabels=createTwinMapLabels(shell.root,world,districtLabels);
  setView('home');
  let lastMissionKey='';
  world.onTick=dt=>{
   fleet?.update(dt);if(droneFollowIndex!==null&&fleet)world?.setObserverFocus(fleet.focus(droneFollowIndex));mapLabels?.update(dt);const mission=fleet?.mission;if(mission){const key=`${mission.phase}:${Math.round(mission.progress*100)}:${mission.aircraftIndex}`;if(key!==lastMissionKey){lastMissionKey=key;routeLayer?.setMissionSegments(mission.routeSegments??[]);shell.setMissionStatus(mission);if(mission.phase==='delivering')shell.notify(`已到达 ${mission.destinationName} · 正在完成投递`);if(mission.phase==='completed')shell.notify(`配送完成 · ${mission.destinationName} · 无人机已返航`);}}
   telemetryTick+=dt;if(telemetryTick<.25)return;telemetryTick=0;const coordinates=cameraCoordinates(),position=world!.observer.pose();
   shell.update({fps:world!.engine.getFps(),longitude:coordinates.longitude,latitude:coordinates.latitude,altitude:position.y-world!.groundHeight(position.x,position.z),meshes:world!.scene.meshes.filter(mesh=>mesh.isEnabled()).length,overview:{extent:[world!.data.meta.extent[0],world!.data.meta.extent[1],world!.data.meta.extent[2],world!.data.meta.extent[3]],land:world!.data.land,coast:world!.data.coast,weather:{windDirection:currentWeather.windDirection,windSpeed:currentWeather.windSpeed},units:fleet?.stats.units.map(unit=>({x:unit.position[0],z:unit.position[2],active:unit.active,charging:unit.charging,id:unit.id}))??[],routes:(fleet?.missions??[]).flatMap(item=>item.routeSegments?.filter(segment=>segment.points.length>1).map(segment=>({id:`${item.aircraftIndex}-${item.orderId}-${segment.id}`,points:segment.points.map(point=>({x:point.x,z:point.z}))}))??[])}});
  };
  const coordinates=cameraCoordinates(),position=world.observer.pose();shell.update({fps:world.engine.getFps(),longitude:coordinates.longitude,latitude:coordinates.latitude,altitude:position.y-world.groundHeight(position.x,position.z),meshes:world.scene.meshes.filter(mesh=>mesh.isEnabled()).length});
  Object.defineProperty(window,'__SHENZHEN_TWIN__',{configurable:true,value:{
   get ready(){return !!world?.ready&&!!world.observer.active&&!!fleet?.stats.loaded;},get mode(){return shell.mode;},get expanded(){return shell.expanded;},get warehouse(){return warehouse?.stats;},get fleet(){return fleet?.stats;},get drone(){return fleet?.stats;},get observer(){return world?{...world.observer.status,dragMode:world.observerDragMode}:null;},
   get gameSystems(){return {twinMode:world?.twinMode??false,carVisible:world?.car.isEnabled()??false,traffic:false,pedestrians:false,ebikes:false,trafficMeshes:world?.traffic?.meshes.flat().length??0,pedestrianLayer:!!world?.pedestrians};},
   get mapLayers(){return {provider:'local',base:'core-roads-place-labels-buildings',native3DBuildings:false,overlay:{detailMeshes:world?.blocks.filter(block=>!block.road).length??0}};},
   get stations(){return stationWarehouses.map(item=>item.stats);},get airspaceReference(){return AIRSPACE_REFERENCE;},get simulatedAirspaceZones(){return SIMULATED_AIRSPACE_ZONES;},get diagnostics(){return world?.diagnostics();},get palette(){return {land:materialColor('land'),pavement:materialColor('pavement'),concrete:materialColor('concrete'),water:materialColor('living-bay'),backing:materialColor('twin-map-backing-matte')};},get weather(){return currentWeather;},get routes(){return plannedRoutes;},get routeSafetyForTest(){return (points:ReadonlyArray<{x:number;y:number;z:number}>)=>routePlanner?.isFlightPathSafe(points)??false;},get routeLayer(){return routeLayer?.stats;},get mission(){return fleet?.mission;},get missions(){return fleet?.missions??[];},get missionHistory(){return fleet?.records??[];},get destinations(){return missionDestinations.length;},get sky(){return timeSky?.stats;},get labels(){return mapLabels?{count:mapLabels.count,shown:mapLabels.shown,shownRange:mapLabels.shownRange,visibility:mapLabels.visibility}:null;},get activeRoute(){return activeRoute;},get droneFollow(){return droneFollowIndex;},setView,focusDrone(index=0){enterDroneView(index);},advanceMissionForTest(seconds=1){if(!fleet)return null;fleet.update(Math.max(0,seconds));shell.setMissionStatus(fleet.mission);return fleet.mission;},labelVisibilityForTest(pitch:number,distance:number,height=900){return mapLabels?.visibilityAt(distance,pitch,height);},
  }});
  shell.setLoadingProgress('资源初始化完成',100);shell.setSystemState('在线',true,'深圳核心城区、真实道路地名与五架无人机已就绪');shell.notify('本地核心城区地图已就绪 · 真实道路与地名已加载');canvas.focus();
 }catch(error){console.error(error);const message=error instanceof Error?error.message:String(error);shell.setLoadingError('初始化失败：'+message);shell.setSystemState('异常',false,message);shell.notify('场景初始化失败，请查看控制台');}
}

void boot();
