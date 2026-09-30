import type {MissionDestination} from './low-altitude-types.ts';
import type {CityData,V2} from './city-types.ts';
import {isUnnamedRoad} from './city-road-names.ts';
import {inRing} from './driving.ts';
import {warehouseReserved} from './warehouse/warehouse.ts';

type PlaceRecord={
 id:string;
 name:string;
 nameEn?:string;
 category?:string;
 kind?:string;
 x:number;
 z:number;
};

const CATEGORY_LABELS:Record<string,string>={district:'街道 / 社区',park:'公园 / 广场',transport:'交通枢纽',place:'商业 / 公共设施'};
const PRIORITY:Record<string,number>={place:0,transport:1,park:2,district:3};

export async function loadMissionDestinations(fallback:MissionDestination[]=[]){
 try{
  const response=await fetch(new URL('../data/map-places.json',import.meta.url));
  if(!response.ok)throw Error('place-catalog-http-'+response.status);
  const document=await response.json() as {schemaVersion?:number;places?:PlaceRecord[]};
  if(document.schemaVersion!==1||!Array.isArray(document.places))throw Error('place-catalog-invalid');
  const destinations=document.places.filter(place=>place.name&&Number.isFinite(place.x+place.z)).map(place=>({
   id:place.id,
   name:place.name,
   detail:`${CATEGORY_LABELS[place.category??'']??'城市地点'}${place.nameEn?` · ${place.nameEn}`:''}`,
   x:place.x,
   z:place.z,
   category:place.category??'place',
  })).sort((left,right)=>(PRIORITY[left.category]??9)-(PRIORITY[right.category]??9)||left.name.localeCompare(right.name,'zh-CN'));
  const unique=new Map<string,MissionDestination>();
  for(const destination of destinations)if(!unique.has(destination.id))unique.set(destination.id,destination);
  return [...unique.values()];
 }catch{return fallback;}
}

function pointInRings(x:number,z:number,rings:V2[][]){return rings.length>0&&inRing(x,z,rings[0])&&!rings.slice(1).some(ring=>inRing(x,z,ring));}
function pointInPolygonSet(x:number,z:number,polygons:V2[][][]){return polygons.some(rings=>pointInRings(x,z,rings));}
function pointInPolygons(x:number,z:number,polygons:{rings:V2[][]}[]){return polygons.some(feature=>pointInRings(x,z,feature.rings));}
function nearestRoadPoint(x:number,z:number,roads:CityData['roads'],maxDistance=420){let best:{x:number;z:number;distance:number}|undefined;for(const road of roads){for(let index=1;index<road.points.length;index++){const a=road.points[index-1],b=road.points[index],dx=b[0]-a[0],dz=b[1]-a[1],lengthSquared=dx*dx+dz*dz,t=Math.max(0,Math.min(1,lengthSquared?((x-a[0])*dx+(z-a[1])*dz)/lengthSquared:0)),px=a[0]+dx*t,pz=a[1]+dz*t,distance=Math.hypot(x-px,z-pz);if(distance<(best?.distance??Infinity))best={x:px,z:pz,distance};}}return best&&best.distance<=maxDistance?best:null;}
function isUsableGround(x:number,z:number,city:CityData){if(!pointInPolygonSet(x,z,city.land))return false;if(pointInPolygons(x,z,city.water))return false;if(city.buildings.some(building=>building.height>1.1&&pointInRings(x,z,building.rings)))return false;if(warehouseReserved(x,z,10))return false;return true;}

function normalizePoint(x:number,z:number,city:CityData){if(isUsableGround(x,z,city))return {x,z};const road=nearestRoadPoint(x,z,city.roads);if(road&&isUsableGround(road.x,road.z,city))return {x:road.x,z:road.z};return null;}

/** Keep user-selectable points on the modeled land network, never in water, buildings, or station envelopes. */
export function normalizeMissionDestinations(destinations:MissionDestination[],city:CityData){const result:MissionDestination[]=[];const occupied:string[]=[];for(const destination of destinations){const point=normalizePoint(destination.x,destination.z,city);if(!point)continue;if(occupied.some(id=>id===destination.id))continue;result.push({...destination,x:point.x,z:point.z});occupied.push(destination.id);}return result;}
function ringCenter(rings:number[][][]){let x=0,z=0,count=0;for(const ring of rings)for(const point of ring){x+=point[0];z+=point[1];count++;}return count?{x:x/count,z:z/count}:null;}

/** Adds names that are rendered by the local city layer but are not in the POI catalog. */
export function mergeCityDestinations(destinations:MissionDestination[],city:CityData){
 const merged=new Map(destinations.map(destination=>[destination.id,destination]));
 const namedRoads=new Map<string,{road:CityData['roads'][number];length:number}>();
 for(const road of city.roads){
  if(isUnnamedRoad(road)||!road.name.trim()||road.points.length<2)continue;
  let length=0;for(let index=1;index<road.points.length;index++)length+=Math.hypot(road.points[index][0]-road.points[index-1][0],road.points[index][1]-road.points[index-1][1]);
  const previous=namedRoads.get(road.name);if(!previous||length>previous.length)namedRoads.set(road.name,{road,length});
 }
 for(const [name,{road}] of namedRoads){
  const midpoint=road.points[Math.floor(road.points.length/2)];if(!midpoint)continue;
  const id=`road-${encodeURIComponent(name)}`;
  if(!merged.has(id))merged.set(id,{id,name,detail:`道路 · ${roadDisplayKind(road.kind)}`,x:midpoint[0],z:midpoint[1]});
 }
 for(const landmark of city.landmarks){if(!landmark.name||!Number.isFinite(landmark.x+landmark.z))continue;const id=`landmark-${landmark.id}`;if(!merged.has(id))merged.set(id,{id,name:landmark.name,detail:`地标 · ${landmark.area}`,x:landmark.x,z:landmark.z});}
 for(const feature of city.green){if(!feature.name)continue;const center=ringCenter(feature.rings);if(!center)continue;const id=`feature-${feature.name}`;if(!merged.has(id))merged.set(id,{id,name:feature.name,detail:'公园 · 地图标注',x:center.x,z:center.z});}
 for(const feature of city.water){if(!feature.name)continue;const id=`water-label-${feature.name}`;if(!merged.has(id))merged.set(id,{id,name:feature.name,detail:'水域 · 地图标注',x:feature.rings[0]?.[0]?.[0]??0,z:feature.rings[0]?.[0]?.[1]??0});}
 return normalizeMissionDestinations([...merged.values()].filter(destination=>!destination.id.startsWith('water-label-')),city);
}

function roadDisplayKind(kind:string){return ({motorway:'高速/快速路',trunk:'城市快速路',primary:'主干道',secondary:'次干道',tertiary:'支路',residential:'居民道路',service:'内部道路'} as Record<string,string>)[kind]??'道路';}
