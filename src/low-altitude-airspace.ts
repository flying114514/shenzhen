export type AirspaceReferenceMetadata={
 sourceName:string;
 sourceUrl:string;
 publishedAt:string;
 updatedAt:string;
 version:string;
 validUntil:string;
 realtime:boolean;
 licenceBasis:boolean;
 boundaryNote:string;
};

export const AIRSPACE_REFERENCE:AirspaceReferenceMetadata={
 sourceName:'中国民用航空局 · 民用无人驾驶航空器综合管理平台公开信息',
 sourceUrl:'https://uom.caac.gov.cn/',
 publishedAt:'公开资料入口，具体区域以主管部门公告为准',
 updatedAt:'2026-09-29',
 version:'reference-only-2026-09',
 validUntil:'以最新公告为准',
 realtime:false,
 licenceBasis:false,
 boundaryNote:'本项目区域用于仿真避让和教学演示，不等同于实时空域、临时空域或飞行许可。执行前必须核验官方平台及当地管理部门信息。',
};
export type SimulatedAirspaceZone={
 id:string;
 name:string;
 x:number;
 z:number;
 radius:number;
 ceiling:number;
 level:'restricted'|'caution';
};

export const SIMULATED_AIRSPACE_ZONES:SimulatedAirspaceZone[]=[
 {id:'bay-training',name:'深圳湾临时训练空域',x:-2590,z:-615,radius:72,ceiling:150,level:'restricted'},
 {id:'oct-scenic',name:'华侨城景区保护空域',x:-2860,z:-190,radius:165,ceiling:180,level:'restricted'},
 {id:'coast-event',name:'滨海活动保障空域',x:-1870,z:-720,radius:210,ceiling:140,level:'caution'},
 {id:'civic-core',name:'福田中心保障空域',x:1760,z:420,radius:250,ceiling:200,level:'restricted'},
];

export function pointInRestrictedAirspace(x:number,z:number,altitude:number){
 return SIMULATED_AIRSPACE_ZONES.some(zone=>zone.level==='restricted'&&altitude<=zone.ceiling&&Math.hypot(x-zone.x,z-zone.z)<zone.radius);
}

export function airspaceClearance(x:number,z:number,altitude:number){
 let clearance=Infinity,insideRestricted=false,insideCaution=false;
 for(const zone of SIMULATED_AIRSPACE_ZONES){
  if(altitude>zone.ceiling)continue;const edge=Math.hypot(x-zone.x,z-zone.z)-zone.radius;clearance=Math.min(clearance,edge);if(edge<0){if(zone.level==='restricted')insideRestricted=true;else insideCaution=true;}
 }
 return {clearance,insideRestricted,insideCaution};
}

export function segmentCrossesRestrictedAirspace(ax:number,az:number,bx:number,bz:number,altitude:number){
 const dx=bx-ax,dz=bz-az,lengthSquared=dx*dx+dz*dz;
 for(const zone of SIMULATED_AIRSPACE_ZONES){
  if(zone.level!=='restricted'||altitude>zone.ceiling)continue;const projection=lengthSquared?Math.max(0,Math.min(1,((zone.x-ax)*dx+(zone.z-az)*dz)/lengthSquared)):0,x=ax+dx*projection,z=az+dz*projection;if(Math.hypot(x-zone.x,z-zone.z)<zone.radius+10)return true;
 }
 return false;
}
