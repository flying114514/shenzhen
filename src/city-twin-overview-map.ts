import {Color3,DynamicTexture,MeshBuilder,StandardMaterial,Texture,type AbstractMesh,type Scene} from '@babylonjs/core';
import type {CityData,V2} from './city-types.ts';

const ROAD_WIDTH:Record<string,number>={motorway:4,trunk:3.4,primary:2.8,secondary:2.1,tertiary:1.5,residential:1.0,service:.7};
const LONGITUDE_METRES=102850,LATITUDE_METRES=111320;
type GeoRing=number[][];
type DistrictFeature={properties:{name:string;adcode:number;center?:number[];centroid?:number[]};geometry:{type:'Polygon'|'MultiPolygon';coordinates:number[][][]|number[][][][]}};
type DistrictCollection={features:DistrictFeature[]};
export type TwinDistrictLabel={id:string;name:string;x:number;z:number};

export async function loadTwinDistrictLabels(data:CityData):Promise<TwinDistrictLabel[]>{
 const origin=(data.meta as CityData['meta']&{originWGS84?:number[]}).originWGS84??[114.025,22.536],scale=data.meta.horizontalScale;
 const worldPoint=(point:number[]):V2=>[(point[0]-origin[0])*LONGITUDE_METRES*scale,(point[1]-origin[1])*LATITUDE_METRES*scale];
 try{
  const response=await fetch(new URL('../data/shenzhen-districts.geojson',import.meta.url));
  if(!response.ok)return [];
  const collection=await response.json() as DistrictCollection;
  return (collection.features??[]).map(feature=>{const point=feature.properties.centroid??feature.properties.center??origin;const [x,z]=worldPoint(point);return{id:String(feature.properties.adcode),name:feature.properties.name,x,z};}).filter(label=>Number.isFinite(label.x+label.z));
 }catch(error){console.warn('深圳行政区标签载入失败',error);return [];}
}

/** A baked vector LOD for the full Shenzhen administrative area. It replaces
 * thousands of distant meshes with one draw call and yields back to 3D below 5 km. */
export async function createTwinOverviewMap(scene:Scene,data:CityData){
 const origin=(data.meta as CityData['meta']&{originWGS84?:number[]}).originWGS84??[114.025,22.536],scale=data.meta.horizontalScale;
 const worldPoint=(point:number[]):V2=>[(point[0]-origin[0])*LONGITUDE_METRES*scale,(point[1]-origin[1])*LATITUDE_METRES*scale];
 let features:DistrictFeature[]=[];
 try{const response=await fetch(new URL('../data/shenzhen-districts.geojson',import.meta.url));if(response.ok)features=((await response.json()) as DistrictCollection).features??[];}catch(error){console.warn('深圳行政区边界载入失败，将使用核心城区范围',error);}
 const districtPolygons=features.map(feature=>({feature,polygons:(feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates) as GeoRing[][]}));
 let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity;
 for(const {polygons} of districtPolygons)for(const polygon of polygons)for(const ring of polygon)for(const point of ring){const [x,z]=worldPoint(point);west=Math.min(west,x);south=Math.min(south,z);east=Math.max(east,x);north=Math.max(north,z);}
 if(!Number.isFinite(west))[west,south,east,north]=data.meta.extent;
 const cityExtent=[west,south,east,north] as const,padding=2200,mapExtent=[west-padding,south-padding,east+padding,north+padding] as const;
 const mapWidth=mapExtent[2]-mapExtent[0],mapHeight=mapExtent[3]-mapExtent[1],aspect=mapWidth/mapHeight,width=2048,height=Math.max(1024,Math.round(width/aspect));
 const texture=new DynamicTexture('twin-city-overview-texture',{width,height},scene,false,Texture.BILINEAR_SAMPLINGMODE);
 texture.wrapU=texture.wrapV=Texture.CLAMP_ADDRESSMODE;texture.anisotropicFilteringLevel=1;
 const context=texture.getContext() as unknown as CanvasRenderingContext2D,px=(x:number)=>(x-mapExtent[0])/mapWidth*width,py=(z:number)=>height-(z-mapExtent[1])/mapHeight*height;
 const append=(target:CanvasRenderingContext2D|Path2D,rings:V2[][])=>{for(const ring of rings){ring.forEach((point,index)=>index?target.lineTo(px(point[0]),py(point[1])):target.moveTo(px(point[0]),py(point[1])));if(ring.length)target.closePath();}};
 const worldRings=(polygon:GeoRing[]):V2[][]=>polygon.map(ring=>ring.map(worldPoint));

 context.fillStyle='#b9dfe6';context.fillRect(0,0,width,height);
 const districtPath=new Path2D(),districtColors=['#e8ece2','#edf0e6','#e6ebe1','#ebefe5','#e5eae0','#e9eee4','#e7ece2','#edf1e7','#e4e9df'];
 districtPolygons.forEach(({polygons},index)=>{const featurePath=new Path2D();for(const polygon of polygons)append(featurePath,worldRings(polygon));context.fillStyle=districtColors[index%districtColors.length];context.fill(featurePath,'evenodd');districtPath.addPath(featurePath);});
 context.strokeStyle='#789a9d';context.lineWidth=3;context.stroke(districtPath);

 context.fillStyle='#f7f5ed';for(const polygon of data.land){context.beginPath();append(context,polygon);context.fill('evenodd');}
 context.fillStyle='#c8e0c8';for(const green of data.green){context.beginPath();append(context,green.rings);context.fill('evenodd');}
 context.fillStyle='#a9d8e1';for(const water of data.water){context.beginPath();append(context,water.rings);context.fill('evenodd');}
 const buildings=new Path2D();for(const building of data.buildings)append(buildings,building.rings);context.save();context.translate(3,-3);context.fillStyle='rgba(68,92,93,.16)';context.fill(buildings,'evenodd');context.restore();context.fillStyle='#c4cecd';context.fill(buildings,'evenodd');context.strokeStyle='#a9b9b6';context.lineWidth=.45;context.stroke(buildings);
 const roadGroups=new Map<string,Path2D>();
 for(const road of data.roads){const kind=road.kind.replace(/_link$/,''),group=roadGroups.get(kind)??new Path2D();road.points.forEach((point,index)=>index?group.lineTo(px(point[0]),py(point[1])):group.moveTo(px(point[0]),py(point[1])));roadGroups.set(kind,group);}
 context.lineCap='round';context.lineJoin='round';
 const roadColor:Record<string,string>={motorway:'#e39b48',trunk:'#edaa55',primary:'#efbb70',secondary:'#e9d6a4',tertiary:'#f3ead3',residential:'#fbf8ef',service:'#f7f3e8'};
 for(const [kind,roads] of roadGroups){const line=ROAD_WIDTH[kind]??.65;context.strokeStyle='#fffdf7';context.lineWidth=line+2;context.stroke(roads);context.strokeStyle=roadColor[kind]??'#d7d9ce';context.lineWidth=line;context.stroke(roads);}
 context.strokeStyle='#628d92';context.lineWidth=3.5;context.stroke(districtPath);
 const fade=Math.round(Math.min(width,height)*.07),edge='#ebf2f4',clear='rgba(235,242,244,0)';
 const left=context.createLinearGradient(0,0,fade,0);left.addColorStop(0,edge);left.addColorStop(1,clear);context.fillStyle=left;context.fillRect(0,0,fade,height);
 const right=context.createLinearGradient(width-fade,0,width,0);right.addColorStop(0,clear);right.addColorStop(1,edge);context.fillStyle=right;context.fillRect(width-fade,0,fade,height);
 const top=context.createLinearGradient(0,0,0,fade);top.addColorStop(0,edge);top.addColorStop(1,clear);context.fillStyle=top;context.fillRect(0,0,width,fade);
 const bottom=context.createLinearGradient(0,height-fade,0,height);bottom.addColorStop(0,clear);bottom.addColorStop(1,edge);context.fillStyle=bottom;context.fillRect(0,height-fade,width,fade);
 texture.hasAlpha=false;texture.update(false);

 const [coreWest,coreSouth,coreEast,coreNorth]=data.meta.extent,coreMapWidth=coreEast-coreWest,coreMapHeight=coreNorth-coreSouth,coreWidth=2048,coreHeight=Math.max(640,Math.round(coreWidth/(coreMapWidth/coreMapHeight)));
 const coreTexture=new DynamicTexture('twin-city-core-detail-texture',{width:coreWidth,height:coreHeight},scene,false,Texture.BILINEAR_SAMPLINGMODE);coreTexture.wrapU=coreTexture.wrapV=Texture.CLAMP_ADDRESSMODE;coreTexture.anisotropicFilteringLevel=1;
 const coreContext=coreTexture.getContext() as unknown as CanvasRenderingContext2D,corePx=(x:number)=>(x-coreWest)/coreMapWidth*coreWidth,corePy=(z:number)=>coreHeight-(z-coreSouth)/coreMapHeight*coreHeight;
 const coreAppend=(target:CanvasRenderingContext2D|Path2D,rings:V2[][])=>{for(const ring of rings){ring.forEach((point,index)=>index?target.lineTo(corePx(point[0]),corePy(point[1])):target.moveTo(corePx(point[0]),corePy(point[1])));if(ring.length)target.closePath();}};
 coreContext.fillStyle='#f2f0e8';coreContext.fillRect(0,0,coreWidth,coreHeight);
 coreContext.fillStyle='#faf8f1';for(const polygon of data.land){coreContext.beginPath();coreAppend(coreContext,polygon);coreContext.fill('evenodd');}
 coreContext.fillStyle='#c8e0c8';for(const green of data.green){coreContext.beginPath();coreAppend(coreContext,green.rings);coreContext.fill('evenodd');}
 coreContext.fillStyle='#a9d8e1';for(const water of data.water){coreContext.beginPath();coreAppend(coreContext,water.rings);coreContext.fill('evenodd');}
 const coreBuildings=new Path2D();for(const building of data.buildings)coreAppend(coreBuildings,building.rings);coreContext.save();coreContext.translate(2,-2);coreContext.fillStyle='rgba(68,92,93,.14)';coreContext.fill(coreBuildings,'evenodd');coreContext.restore();coreContext.fillStyle='#c4cecd';coreContext.fill(coreBuildings,'evenodd');coreContext.strokeStyle='#a9b9b6';coreContext.lineWidth=.5;coreContext.stroke(coreBuildings);
 const coreRoads=new Map<string,Path2D>();for(const road of data.roads){const kind=road.kind.replace(/_link$/,''),group=coreRoads.get(kind)??new Path2D();road.points.forEach((point,index)=>index?group.lineTo(corePx(point[0]),corePy(point[1])):group.moveTo(corePx(point[0]),corePy(point[1])));coreRoads.set(kind,group);}
 coreContext.lineCap='round';coreContext.lineJoin='round';for(const [kind,roads] of coreRoads){const line=ROAD_WIDTH[kind]??.65;coreContext.strokeStyle='#fffdf7';coreContext.lineWidth=line+2;coreContext.stroke(roads);coreContext.strokeStyle=roadColor[kind]??'#d7d9ce';coreContext.lineWidth=line;coreContext.stroke(roads);}
 const coreFade=Math.round(Math.min(coreWidth,coreHeight)*.08),coreEdge='#f4f1e8',coreClear='rgba(244,241,232,0)';
 const coreLeft=coreContext.createLinearGradient(0,0,coreFade,0);coreLeft.addColorStop(0,coreEdge);coreLeft.addColorStop(1,coreClear);coreContext.fillStyle=coreLeft;coreContext.fillRect(0,0,coreFade,coreHeight);
 const coreRight=coreContext.createLinearGradient(coreWidth-coreFade,0,coreWidth,0);coreRight.addColorStop(0,coreClear);coreRight.addColorStop(1,coreEdge);coreContext.fillStyle=coreRight;coreContext.fillRect(coreWidth-coreFade,0,coreFade,coreHeight);
 const coreTop=coreContext.createLinearGradient(0,0,0,coreFade);coreTop.addColorStop(0,coreEdge);coreTop.addColorStop(1,coreClear);coreContext.fillStyle=coreTop;coreContext.fillRect(0,0,coreWidth,coreFade);
 const coreBottom=coreContext.createLinearGradient(0,coreHeight-coreFade,0,coreHeight);coreBottom.addColorStop(0,coreClear);coreBottom.addColorStop(1,coreEdge);coreContext.fillStyle=coreBottom;coreContext.fillRect(0,coreHeight-coreFade,coreWidth,coreFade);coreTexture.hasAlpha=false;coreTexture.update(false);

 const plane=MeshBuilder.CreateGround('twin-city-overview-map',{width:mapWidth,height:mapHeight,subdivisions:1},scene);plane.position.set((mapExtent[0]+mapExtent[2])/2,-2,(mapExtent[1]+mapExtent[3])/2);plane.isPickable=false;plane.receiveShadows=false;plane.applyFog=false;
 const material=new StandardMaterial('twin-city-overview-map-material',scene);material.disableLighting=true;material.diffuseColor=Color3.Black();material.specularColor=Color3.Black();material.emissiveColor=Color3.White();material.diffuseTexture=texture;material.emissiveTexture=texture;material.backFaceCulling=false;plane.material=material;plane.freezeWorldMatrix();
 const corePlane=MeshBuilder.CreateGround('twin-city-core-detail-map',{width:coreMapWidth,height:coreMapHeight,subdivisions:1},scene);corePlane.position.set((coreWest+coreEast)/2,-1.5,(coreSouth+coreNorth)/2);corePlane.isPickable=false;corePlane.receiveShadows=false;corePlane.applyFog=false;
 const coreMaterial=new StandardMaterial('twin-city-core-detail-material',scene);coreMaterial.disableLighting=true;coreMaterial.diffuseColor=Color3.Black();coreMaterial.specularColor=Color3.Black();coreMaterial.emissiveColor=Color3.White();coreMaterial.diffuseTexture=coreTexture;coreMaterial.emissiveTexture=coreTexture;coreMaterial.backFaceCulling=false;corePlane.material=coreMaterial;corePlane.freezeWorldMatrix();corePlane.setEnabled(false);
 const backdrop=MeshBuilder.CreateGround('twin-city-overview-backdrop',{width:120000,height:90000,subdivisions:1},scene);backdrop.position.set((west+east)/2,-500,(south+north)/2);backdrop.isPickable=false;backdrop.receiveShadows=false;backdrop.applyFog=false;
 const backdropMaterial=new StandardMaterial('twin-city-overview-backdrop-material',scene);backdropMaterial.disableLighting=true;backdropMaterial.diffuseColor=new Color3(.92,.955,.965);backdropMaterial.emissiveColor=new Color3(.92,.955,.965);backdropMaterial.specularColor=Color3.Black();backdrop.material=backdropMaterial;backdrop.freezeWorldMatrix();
 const detailed:AbstractMesh[]=scene.meshes.filter(mesh=>mesh!==plane&&mesh!==corePlane&&mesh!==backdrop&&mesh.name!=='atmosphere'&&!/^(?:block_|roads_)/.test(mesh.name)),detailedState=new Map(detailed.map(mesh=>[mesh,mesh.isEnabled()]));
 const districts:TwinDistrictLabel[]=districtPolygons.map(({feature})=>{const point=feature.properties.centroid??feature.properties.center??origin,[x,z]=worldPoint(point);return{id:String(feature.properties.adcode),name:feature.properties.name,x,z};});
 let active=false;
 function update(distance:number){corePlane.setEnabled(distance<=18000);const next=distance>5000;if(next===active)return;active=next;for(const mesh of detailed)mesh.setEnabled(active?false:detailedState.get(mesh)??true);}
 scene.onDisposeObservable.addOnce(()=>{plane.dispose(false,false);corePlane.dispose(false,false);backdrop.dispose(false,false);material.dispose(false,false);coreMaterial.dispose(false,false);backdropMaterial.dispose(false,false);texture.dispose();coreTexture.dispose();});
 return {plane,corePlane,backdrop,update,get active(){return active;},textureSize:[width,height] as const,coreTextureSize:[coreWidth,coreHeight] as const,replacedMeshes:detailed.length,extent:[...cityExtent] as [number,number,number,number],districts};
}
