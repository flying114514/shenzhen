export type RouteKind='fastest'|'safest'|'balanced';

export type RoutePoint={x:number;y:number;z:number};

export type MissionDestination={
 id:string;
 name:string;
 detail:string;
 x:number;
 z:number;
};

export type WeatherSnapshot={
 source:'loading'|'live'|'cached'|'offline';
 summary:string;
 temperature:number;
 precipitation:number;
 windSpeed:number;
 windDirection:number;
 windGust:number;
 weatherCode:number;
 flightIndex:number;
 observedAt:string;
 coverage:'point'|'corridor';
 samples?:WeatherSample[];
};

export type WeatherSample={
 x:number;
 z:number;
 windSpeed:number;
 windDirection:number;
 windGust:number;
 precipitation:number;
 flightIndex:number;
};

export type PlannedRoute={
 id:RouteKind;
 name:string;
 badge:string;
 points:RoutePoint[];
 distanceMeters:number;
 durationMinutes:number;
 cruiseAltitude:number;
 cruiseSpeed:number;
 riskScore:number;
 buildingClearance:number;
 terrainClearance:number;
 weatherImpact:number;
 headwind:number;
 reasons:string[];
};

export type RouteSegment={
 id:'launch'|'delivery'|'return';
 points:RoutePoint[];
 label:string;
 distanceMeters:number;
};

export type CargoManifest={
 orderId:string;
 description:string;
 weightKg:number;
 volumeLiters:number;
 priority:'standard'|'express'|'medical';
};

export type MissionRecord={
 orderId:string;
 destinationName:string;
 aircraftIndex:number;
 originStationId?:string;
 routeId:RouteKind;
 cargoDescription:string;
 cargoWeightKg:number;
 phase:'completed'|'cancelled'|'failed';
 startedAt:string;
 finishedAt:string;
 distanceMeters:number;
 batteryPercent:number;
 safetyMessage:string;
};

export type MissionRequest={
 originId:string;
 destinationId:string;
 minimumBatteryPercent:number;
 cargo:CargoManifest;
};

export type MissionPhase='idle'|'preflight'|'launching'|'loading'|'enroute'|'rerouting'|'delivering'|'returning'|'completed'|'cancelled'|'aborted'|'failed';

export type DroneMissionStatus={
 phase:MissionPhase;
 progress:number;
 aircraftIndex:number;
 routeId:RouteKind|null;
 destinationName:string;
 routeSegments?:RouteSegment[];
 orderId:string;
 cargoWeightKg:number;
 distanceRemaining:number;
 simulatedSpeed:number;
 batteryPercent:number;
 estimatedReturnBattery:number;
 safetyMessage:string;
};
