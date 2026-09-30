import type {MissionRequest,MissionDestination} from './low-altitude-types.ts';
export type FleetStation={
 id:string;
 name:string;
 code:string;
 district:string;
 x:number;
 z:number;
 heading:number;
 pads:number;
 chargingSlots:number;
 batteryCapacity:number;
 reference:'simulated';
};

export const FLEET_STATIONS:FleetStation[]=[
 {id:'splendid-china-hub',name:'锦绣中华配送站',code:'SZ-L01',district:'南山 · 锦绣中华',x:-2417.55,z:-175.26,heading:.18,pads:3,chargingSlots:3,batteryCapacity:100,reference:'simulated'},
 {id:'shennan-xiangmi-hub',name:'深南大道香蜜配送站',code:'SZ-L02',district:'福田 · 香蜜社区',x:-10,z:420,heading:.08,pads:3,chargingSlots:3,batteryCapacity:100,reference:'simulated'},
 {id:'huanggang-xiawei-hub',name:'皇岗下围配送站',code:'SZ-L03',district:'福田 · 皇岗下围一村',x:2014.75,z:-600.86,heading:.25,pads:3,chargingSlots:3,batteryCapacity:100,reference:'simulated'},
 {id:'minxin-hub',name:'民新社区配送站',code:'SZ-L04',district:'龙华 · 民新社区',x:5856.48,z:1877.57,heading:-.12,pads:3,chargingSlots:3,batteryCapacity:100,reference:'simulated'},
 {id:'sihai-park-hub',name:'四海公园配送站',code:'SZ-L05',district:'南山 · 四海公园',x:-6333.31,z:-2466.40,heading:.35,pads:3,chargingSlots:3,batteryCapacity:100,reference:'simulated'},
];

export type FleetAssignment={
 stationId:string;
 aircraftIndex:number;
 score:number;
 reason:string;
};

export type AircraftCandidate=SchedulerAircraft&{estimatedReturnBattery?:number};

export type SchedulerAircraft={
 aircraftIndex:number;
 available:boolean;
 batteryPercent:number;
 position:{x:number;z:number};
 stationId:string;
};

export function aircraftAvailabilityMessage(request:MissionRequest,aircraft:readonly SchedulerAircraft[]){
 const available=aircraft.filter(item=>item.available&&item.batteryPercent>=request.minimumBatteryPercent&&item.batteryPercent>0);
 if(available.length)return '';
 if(!aircraft.length)return '当前没有已加载的无人机';
 const charging=aircraft.filter(item=>!item.available&&item.batteryPercent>0).length;
 const batteryLimited=aircraft.filter(item=>item.batteryPercent<request.minimumBatteryPercent).length;
 if(batteryLimited===aircraft.length)return `所有无人机电量低于任务最低要求（${request.minimumBatteryPercent}%）`;
 if(charging===aircraft.length)return '所有无人机正在执行任务或充电';
 if(batteryLimited>0)return `暂无满足最低电量 ${request.minimumBatteryPercent}% 的可用无人机`;
 return '所有无人机正在执行其他任务或等待返航';
}

export function chooseAircraft(request:MissionRequest,aircraft:readonly SchedulerAircraft[],stations:readonly FleetStation[],origin?:MissionDestination):FleetAssignment|null{
 const target=origin??stations[0];
 if(!target)return null;
 const nearestStation=stations.reduce<FleetStation|null>((best,item)=>!best||Math.hypot(item.x-target.x,item.z-target.z)<Math.hypot(best.x-target.x,best.z-target.z)?item:best,null);
 const candidates=aircraft.filter(item=>item.available&&item.batteryPercent>=request.minimumBatteryPercent&&item.batteryPercent>0);
 if(!candidates.length)return null;
 const ranked=candidates.map(item=>{
  const distance=Math.hypot(item.position.x-target.x,item.position.z-target.z);
  const stationBonus=item.stationId===nearestStation?.id?-20:0;
  const score=distance*.01+(100-item.batteryPercent)*3+stationBonus;
  return {item,score};}).sort((a,b)=>a.score-b.score);
 const selected=ranked[0];
 return {stationId:selected.item.stationId,aircraftIndex:selected.item.aircraftIndex,score:selected.score,reason:selected.item.stationId===nearestStation?.id?'邻近站点待命，接续成本最低':'综合当前位置与电量最优'};
}
