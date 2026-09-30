import {
 AbstractMesh,Color3,DynamicTexture,Mesh,MeshBuilder,PBRMaterial,Scene,StandardMaterial,TransformNode,Vector3,
} from '@babylonjs/core';
import type {FleetStation} from '../low-altitude-stations.ts';
import {FLEET_STATIONS} from '../low-altitude-stations.ts';

export const SHENZHEN_WAREHOUSE={
 id:'nanshan-low-altitude-hub-01',
 name:'南山区低空物流中心',
 code:'SZ-L01',
 district:'深圳 · 南山',
 x:-2417.55,
 z:-175.26,
 heading:.18,
 capacity:12,
 pads:5,
} as const;

export const WAREHOUSE_PAD_LAYOUT=[
 new Vector3(-24,.76,-10),new Vector3(-12,.76,-10),new Vector3(0,.76,-10),
 new Vector3(-18,.76,1.5),new Vector3(-6,.76,1.5),
] as const;

export function warehousePadWorld(station:FleetStation,groundHeight:(x:number,z:number)=>number,index=0){
 const local=WAREHOUSE_PAD_LAYOUT[Math.max(0,Math.min(WAREHOUSE_PAD_LAYOUT.length-1,index))];
 // Babylon's Y rotation: x'=x*cos+z*sin, z'=-x*sin+z*cos.
 // Match landingPadWorld's TransformCoordinates exactly.
 const c=Math.cos(station.heading),s=Math.sin(station.heading);
 return {x:station.x+local.x*c+local.z*s,y:groundHeight(station.x,station.z)+.08+local.y,z:station.z-local.x*s+local.z*c};
}

export function warehouseReserved(x:number,z:number,radius=0){
 for(const station of FLEET_STATIONS){const dx=x-station.x,dz=z-station.z,c=Math.cos(station.heading),s=Math.sin(station.heading),localX=dx*c-dz*s,localZ=dx*s+dz*c;if(Math.abs(localX)<=34+radius&&Math.abs(localZ)<=21+radius)return true;}
 return false;
}

type WarehouseMaterials={surface:PBRMaterial;structure:PBRMaterial;glass:PBRMaterial;accent:PBRMaterial;warning:PBRMaterial;cargo:PBRMaterial;sign:StandardMaterial};

function pbr(scene:Scene,name:string,color:Color3,metallic:number,roughness:number,emissive?:Color3){
 const material=new PBRMaterial(name,scene);material.albedoColor=color;material.metallic=metallic;material.roughness=roughness;
 if(emissive)material.emissiveColor=emissive;
 return material;
}

function makeMaterials(scene:Scene,station:FleetStation):WarehouseMaterials{
 const signTexture=new DynamicTexture('warehouse-sign-texture-'+station.code,{width:1024,height:256},scene,false);
 const context=signTexture.getContext();context.fillStyle='#07171b';context.fillRect(0,0,1024,256);context.fillStyle='#77f5d1';context.font='700 72px "Microsoft YaHei", sans-serif';context.fillText(station.name,54,112);context.fillStyle='#9cb5b2';context.font='32px Arial, sans-serif';context.fillText(`SHENZHEN LOW-ALTITUDE LOGISTICS  ·  ${station.code}`,58,181);signTexture.update();
 const sign=new StandardMaterial('warehouse-sign-'+station.code,scene);sign.diffuseTexture=signTexture;sign.emissiveTexture=signTexture;sign.disableLighting=true;
 return {
  surface:pbr(scene,'warehouse-surface',new Color3(.055,.09,.105),.48,.54),
  structure:pbr(scene,'warehouse-structure',new Color3(.035,.12,.14),.7,.3),
  glass:pbr(scene,'warehouse-glass',new Color3(.045,.21,.23),.25,.18,new Color3(.01,.055,.06)),
  accent:pbr(scene,'warehouse-accent',new Color3(.05,.42,.35),.35,.3,new Color3(0,.78,.56)),
  warning:pbr(scene,'warehouse-warning',new Color3(.95,.43,.08),.15,.45,new Color3(.7,.16,.015)),
  cargo:pbr(scene,'warehouse-cargo',new Color3(.16,.22,.23),.42,.58),
  sign,
 };
}

function box(scene:Scene,root:TransformNode,meshes:AbstractMesh[],name:string,size:{width:number;height:number;depth:number},position:[number,number,number],material:PBRMaterial){
 const mesh=MeshBuilder.CreateBox(name,size,scene);mesh.parent=root;mesh.position.copyFromFloats(...position);mesh.material=material;mesh.receiveShadows=true;meshes.push(mesh);return mesh;
}

export class Warehouse{
 readonly root:TransformNode;readonly meshes:AbstractMesh[]=[];readonly shadowCasters:AbstractMesh[]=[];readonly y:number;private materials:WarehouseMaterials;
 constructor(private scene:Scene,groundHeight:(x:number,z:number)=>number,readonly station:FleetStation=FLEET_STATIONS[0]){
  this.y=groundHeight(this.station.x,this.station.z)+.08;
  this.root=new TransformNode('warehouse-root-'+this.station.code,scene);this.root.position.set(this.station.x,this.y,this.station.z);this.root.rotation.y=this.station.heading;
  this.materials=makeMaterials(scene,this.station);this.build();
 }
 private track(mesh:AbstractMesh,casts=true){this.meshes.push(mesh);if(casts)this.shadowCasters.push(mesh);mesh.parent=this.root;return mesh;}
 private build(){
  const {scene,root,meshes}=this,m=this.materials;
  box(scene,root,meshes,'warehouse-foundation',{width:68,height:.35,depth:42},[0,.18,0],m.surface);
  box(scene,root,meshes,'warehouse-terminal',{width:25,height:6.4,depth:11},[18,3.55,6.5],m.structure);
  box(scene,root,meshes,'warehouse-glass-front',{width:20,height:3.6,depth:.18},[17.2,3.5,.92],m.glass);
  box(scene,root,meshes,'warehouse-roof',{width:27,height:.34,depth:12.6},[18,6.92,6.5],m.surface);
  for(const x of [8,14,20,26])box(scene,root,meshes,'warehouse-roof-rib',{width:.16,height:.7,depth:12.9},[x,7.15,6.5],m.accent);
  const canopy=box(scene,root,meshes,'warehouse-charging-canopy',{width:16,height:.28,depth:7.5},[18,4.1,-9.5],m.structure);canopy.rotation.z=-.035;
  for(const x of [11,25])for(const z of [-12.2,-6.8])box(scene,root,meshes,'warehouse-canopy-post',{width:.24,height:4,depth:.24},[x,2.05,z],m.structure);
  for(const x of [14.4,17.4,20.4])box(scene,root,meshes,'warehouse-solar-strip',{width:2.5,height:.08,depth:6.4},[x,4.32,-9.5],m.glass);

  for(const [index,position] of WAREHOUSE_PAD_LAYOUT.entries()){
   const {x,z}=position;
   const pad=MeshBuilder.CreateCylinder('warehouse-pad-'+(index+1),{diameter:8.4,height:.28,tessellation:64},scene);this.track(pad,false);pad.position.set(x,.48,z);pad.material=m.surface;
   const ring=MeshBuilder.CreateTorus('warehouse-pad-ring-'+(index+1),{diameter:7.1,thickness:.18,tessellation:64},scene);this.track(ring,false);ring.position.set(x,.67,z);ring.material=m.accent;
   box(scene,root,meshes,'warehouse-pad-h-bar-'+(index+1),{width:3.8,height:.08,depth:.42},[x,.68,z],m.accent);
   box(scene,root,meshes,'warehouse-pad-h-left-'+(index+1),{width:.42,height:.08,depth:3.1},[x-1.38,.68,z],m.accent);
   box(scene,root,meshes,'warehouse-pad-h-right-'+(index+1),{width:.42,height:.08,depth:3.1},[x+1.38,.68,z],m.accent);
  }
  for(let i=0;i<5;i++)box(scene,root,meshes,'warehouse-cargo-'+i,{width:2.3,height:1.65,depth:1.75},[28.5-i*2.65,1.05,15.2],i===0?m.warning:m.cargo);
  for(const x of [-31,31])for(const z of [-19,19]){
   box(scene,root,meshes,'warehouse-beacon-post',{width:.18,height:2.8,depth:.18},[x,1.55,z],m.structure);
   const beacon=MeshBuilder.CreateSphere('warehouse-beacon',{diameter:.42,segments:12},scene);this.track(beacon,false);beacon.position.set(x,3,z);beacon.material=m.warning;
  }
  for(let i=0;i<16;i++)box(scene,root,meshes,'warehouse-edge-marker',{width:2.7,height:.06,depth:.34},[-28+i*3.7,.4,-20.35],i%2?m.warning:m.accent);
  const sign=MeshBuilder.CreatePlane('warehouse-identity-sign',{width:20,height:5},scene);this.track(sign,false);sign.position.set(17.8,4.1,.68);sign.material=m.sign;
  const mast=box(scene,root,meshes,'warehouse-control-mast',{width:.35,height:9.5,depth:.35},[30,4.95,14.5],m.structure);
  const antenna=MeshBuilder.CreateCylinder('warehouse-control-antenna',{diameterTop:0,diameterBottom:1.5,height:2.2,tessellation:20},scene);this.track(antenna);antenna.position.set(30,10.75,14.5);antenna.material=m.accent;mast.receiveShadows=true;
  for(const mesh of meshes)if(mesh instanceof Mesh&&mesh.name!=='warehouse-foundation'&&!this.shadowCasters.includes(mesh))this.shadowCasters.push(mesh);
 }
 get focus(){return {x:this.station.x,y:this.y+3.5,z:this.station.z};}
 landingPadWorld(index=0){
  return Vector3.TransformCoordinates(WAREHOUSE_PAD_LAYOUT[Math.max(0,Math.min(WAREHOUSE_PAD_LAYOUT.length-1,index))],this.root.computeWorldMatrix(true));
 }
 get stats(){return {id:this.station.id,name:this.station.name,code:this.station.code,district:this.station.district,position:[this.station.x,this.y,this.station.z],capacity:this.station.chargingSlots,pads:this.station.pads,meshes:this.meshes.length,enabled:this.root.isEnabled()};}
 dispose(){this.root.dispose(false,false);for(const material of Object.values(this.materials))material.dispose(true,true);}
}
