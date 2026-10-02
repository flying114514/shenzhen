import {Color3,Mesh,MeshBuilder,StandardMaterial,TransformNode,Vector3,type Scene} from '@babylonjs/core';
import {SIMULATED_AIRSPACE_ZONES} from './low-altitude-airspace.ts';
import type {PlannedRoute,RouteKind,RoutePoint,RouteSegment,WeatherSnapshot} from './low-altitude-types.ts';

const ROUTE_COLORS:Record<RouteKind,Color3>={fastest:Color3.FromHexString('#278DA1'),safest:Color3.FromHexString('#168870'),balanced:Color3.FromHexString('#C87817')};

function material(scene:Scene,name:string,color:Color3,alpha=1){const result=new StandardMaterial(name,scene);result.diffuseColor=color;result.emissiveColor=color.scale(.9);result.specularColor=Color3.Black();result.disableLighting=true;result.alpha=alpha;return result;}

export class LowAltitudeRouteLayer{
 readonly root:TransformNode;
 private routeRoot:TransformNode;
 private airspaceRoot:TransformNode;
 private weatherRoot:TransformNode;
 private routeMeshes=new Map<RouteKind,Mesh>();
 private routeMaterials=new Map<RouteKind,StandardMaterial>();
 private routes=new Map<RouteKind,PlannedRoute>();
 private halo:Mesh|null=null;
 private haloMaterial:StandardMaterial;
 private weatherMeshes:Mesh[]=[];
 private weatherMaterial:StandardMaterial;
 private weatherAccent:StandardMaterial;
 private airspaceRestrictedMaterial:StandardMaterial;
 private airspaceCautionMaterial:StandardMaterial;
 private droneFollowMode=false;
 private active:RouteKind='balanced';
 constructor(private scene:Scene,private heightAt:(x:number,z:number)=>number){
  this.root=new TransformNode('low-altitude-routing',scene);this.routeRoot=new TransformNode('low-altitude-routes',scene);this.airspaceRoot=new TransformNode('simulated-airspace',scene);this.weatherRoot=new TransformNode('weather-vector',scene);this.routeRoot.parent=this.root;this.airspaceRoot.parent=this.root;this.weatherRoot.parent=this.root;this.haloMaterial=material(scene,'route-halo',Color3.White(),.28);this.haloMaterial.disableDepthWrite=true;this.weatherMaterial=material(scene,'weather-field',Color3.FromHexString('#2B9ED0'),.16);this.weatherAccent=material(scene,'weather-field-accent',Color3.FromHexString('#087FAF'),.92);this.airspaceRestrictedMaterial=material(scene,'airspace-restricted-fill',Color3.FromHexString('#E4494D'),.2);this.airspaceCautionMaterial=material(scene,'airspace-caution-fill',Color3.FromHexString('#F0A52B'),.16);for(const airspaceMaterial of [this.airspaceRestrictedMaterial,this.airspaceCautionMaterial]){airspaceMaterial.disableDepthWrite=true;airspaceMaterial.backFaceCulling=false;}this.buildAirspace();
  scene.onDisposeObservable.addOnce(()=>this.dispose());
 }
 private buildAirspace(){
  for(const zone of SIMULATED_AIRSPACE_ZONES){const restricted=zone.level==='restricted',color=restricted?Color3.FromHexString('#C9373E'):Color3.FromHexString('#D88B1A'),bottom=this.heightAt(zone.x,zone.z)+2,segments=48,circle=(height:number)=>Array.from({length:segments+1},(_,index)=>{const angle=index/segments*Math.PI*2;return new Vector3(zone.x+Math.cos(angle)*zone.radius,height,zone.z+Math.sin(angle)*zone.radius);});
   const fill=MeshBuilder.CreateDisc(`airspace-${zone.id}-fill`,{radius:zone.radius*.985,tessellation:32},this.scene);fill.rotation.x=Math.PI/2;fill.position.set(zone.x,bottom+.45,zone.z);fill.material=restricted?this.airspaceRestrictedMaterial:this.airspaceCautionMaterial;fill.alwaysSelectAsActiveMesh=true;fill.isPickable=false;fill.parent=this.airspaceRoot;fill.renderingGroupId=1;
   const bottomRing=MeshBuilder.CreateLines(`airspace-${zone.id}-bottom`,{points:circle(bottom+1)},this.scene),topRing=MeshBuilder.CreateLines(`airspace-${zone.id}-top`,{points:circle(bottom+zone.ceiling)},this.scene),guides=MeshBuilder.CreateLineSystem(`airspace-${zone.id}-guides`,{lines:Array.from({length:8},(_,index)=>{const angle=index/8*Math.PI*2,x=zone.x+Math.cos(angle)*zone.radius,z=zone.z+Math.sin(angle)*zone.radius;return [new Vector3(x,bottom,z),new Vector3(x,bottom+zone.ceiling,z)];})},this.scene);
   const boundaryMaterial=restricted?this.airspaceRestrictedMaterial:this.airspaceCautionMaterial;for(const height of [bottom+1,bottom+zone.ceiling]){const boundary=MeshBuilder.CreateTube(`airspace-${zone.id}-${height===bottom+1?'ground':'ceiling'}-boundary`,{path:circle(height),radius:restricted?3.6:3.1,tessellation:6,cap:Mesh.NO_CAP},this.scene);boundary.material=boundaryMaterial;boundary.alwaysSelectAsActiveMesh=true;boundary.isPickable=false;boundary.parent=this.airspaceRoot;boundary.renderingGroupId=2;}
   for(const mesh of [bottomRing,topRing,guides]){mesh.color=color;mesh.alpha=restricted?.84:.7;mesh.alwaysSelectAsActiveMesh=true;mesh.isPickable=false;mesh.parent=this.airspaceRoot;mesh.renderingGroupId=2;}
  }
 }
setRoutes(routes:PlannedRoute[],preferred:RouteKind='balanced'){
  for(const mesh of this.routeMeshes.values())mesh.dispose();this.routeMeshes.clear();this.routes.clear();this.halo?.dispose();this.halo=null;
  for(const route of routes){this.routes.set(route.id,route);let routeMaterial=this.routeMaterials.get(route.id);if(!routeMaterial){routeMaterial=material(this.scene,`route-${route.id}-material`,ROUTE_COLORS[route.id]);routeMaterial.disableDepthWrite=true;this.routeMaterials.set(route.id,routeMaterial);}const mesh=MeshBuilder.CreateTube(`route-${route.id}`,{path:this.routePath(route.points),radius:2.1,tessellation:6,cap:Mesh.CAP_ALL},this.scene);mesh.material=routeMaterial;mesh.alwaysSelectAsActiveMesh=true;mesh.isPickable=false;mesh.parent=this.routeRoot;this.routeMeshes.set(route.id,mesh);}
  this.select(routes.some(route=>route.id===preferred)?preferred:routes[0]?.id??'balanced');
 }
 select(route:RouteKind){this.active=route;for(const [id,oldMesh] of this.routeMeshes){const planned=this.routes.get(id);if(!planned)continue;oldMesh.dispose();const mesh=MeshBuilder.CreateTube(`route-${id}`,{path:this.routePath(planned.points),radius:.65,tessellation:6,cap:Mesh.CAP_ALL},this.scene);mesh.material=this.routeMaterials.get(id)!;mesh.alwaysSelectAsActiveMesh=true;mesh.isPickable=false;mesh.parent=this.routeRoot;this.routeMeshes.set(id,mesh);const routeMaterial=this.routeMaterials.get(id)!;routeMaterial.alpha=id===route?1:.2;mesh.renderingGroupId=id===route?2:1;}this.halo?.dispose();this.halo=null;const selected=this.routes.get(route);if(selected){this.haloMaterial.emissiveColor=ROUTE_COLORS[route].scale(.5);this.halo=MeshBuilder.CreateTube('active-route-halo',{path:this.routePath(selected.points),radius:.95,tessellation:6,cap:Mesh.CAP_ALL},this.scene);this.halo.material=this.haloMaterial;this.halo.alwaysSelectAsActiveMesh=true;this.halo.isPickable=false;this.halo.parent=this.routeRoot;this.halo.renderingGroupId=2;}}
 setDroneFollowMode(enabled:boolean){if(this.droneFollowMode===enabled)return;this.droneFollowMode=enabled;if(this.routes.size)this.setRoutes([...this.routes.values()],this.active);}
private missionSegmentMeshes=new Map<string,Mesh>();
 private missionSegmentMaterials=new Map<string,StandardMaterial>();
 private renderMissionSegments(segments:RouteSegment[]){for(const mesh of this.missionSegmentMeshes.values())mesh.dispose();this.missionSegmentMeshes.clear();segments.forEach((segment,index)=>{if(segment.id==='delivery')return;const key=`${segment.id}-${index}`;const color=segment.id==='launch'?Color3.FromHexString('#7B8794'):Color3.FromHexString('#C87817');const missionMaterial=material(this.scene,`mission-segment-${key}`,color);this.missionSegmentMaterials.set(key,missionMaterial);const mesh=MeshBuilder.CreateTube(`mission-segment-${key}`,{path:this.routePathWithDescent(segment.points),radius:.16,tessellation:6,cap:Mesh.CAP_ALL},this.scene);mesh.material=missionMaterial;mesh.isPickable=false;mesh.alwaysSelectAsActiveMesh=true;mesh.parent=this.routeRoot;mesh.renderingGroupId=3;this.missionSegmentMeshes.set(key,mesh);});}
  setMissionSegments(segments:RouteSegment[]){this.renderMissionSegments(segments);}
 clearCandidateRoutes(){for(const mesh of this.routeMeshes.values())mesh.dispose();this.routeMeshes.clear();this.routes.clear();this.halo?.dispose();this.halo=null;}
 private routePath(points:RoutePoint[]){return points.map(point=>new Vector3(point.x,point.y,point.z));}
 private routePathWithDescent(points:RoutePoint[]){
  const expanded:RoutePoint[]=[];
  points.forEach((point,index)=>{
   if(index>0&&Math.abs(point.y-points[index-1].y)>2){
    const previous=points[index-1];
    for(let sample=1;sample<4;sample++){
     const t=sample/4,eased=t*t*(3-2*t);
     expanded.push({x:previous.x+(point.x-previous.x)*eased,y:previous.y+(point.y-previous.y)*eased,z:previous.z+(point.z-previous.z)*eased});
    }
   }
   expanded.push(point);
  });
  return this.routePath(expanded);
 }

 updateWeather(_weather:WeatherSnapshot){for(const mesh of this.weatherMeshes)mesh.dispose();this.weatherMeshes=[];}
 setAirspaceVisible(visible:boolean){this.airspaceRoot.setEnabled(visible);}
 setWeatherVisible(visible:boolean){this.weatherRoot.setEnabled(visible);}
 focus(route=this.active){const selected=this.routes.get(route);if(!selected)return null;const xs=selected.points.map(point=>point.x),zs=selected.points.map(point=>point.z),x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs),span=Math.max(300,x1-x0,z1-z0);return {x:(x0+x1)/2,z:(z0+z1)/2,distance:Math.min(3600,Math.max(520,span*1.45))};}
 get stats(){return {routes:this.routeMeshes.size,active:this.active,droneFollowMode:this.droneFollowMode,airspaceZones:SIMULATED_AIRSPACE_ZONES.length,weatherVector:this.weatherMeshes.length>0,weatherMeshes:this.weatherMeshes.length};}
 dispose(){for(const mesh of this.routeMeshes.values())mesh.dispose();for(const mesh of this.missionSegmentMeshes.values())mesh.dispose();for(const mesh of this.weatherMeshes)mesh.dispose();for(const material of this.routeMaterials.values())material.dispose();for(const missionMaterial of this.missionSegmentMaterials.values())missionMaterial.dispose();this.halo?.dispose();this.haloMaterial.dispose();this.weatherMaterial.dispose();this.weatherAccent.dispose();this.airspaceRestrictedMaterial.dispose();this.airspaceCautionMaterial.dispose();this.root.dispose();}
}
