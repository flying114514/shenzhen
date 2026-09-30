import type {WeatherSnapshot} from './low-altitude-types.ts';

type OpenMeteoCurrent={
 time?:string;
 temperature_2m?:number;
 precipitation?:number;
 rain?:number;
 weather_code?:number;
 wind_speed_10m?:number;
 wind_direction_10m?:number;
 wind_gusts_10m?:number;
};

type OpenMeteoResponse={current?:OpenMeteoCurrent};
type CachedWeather={savedAt:number;weather:WeatherSnapshot};

const CACHE_KEY='shenzhen-uav-current-weather-v1';
const WEATHER_URL='https://api.open-meteo.com/v1/forecast?latitude=22.536&longitude=114.025&current=temperature_2m,precipitation,rain,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=ms&timezone=Asia%2FShanghai';

function summary(code:number,precipitation:number,windSpeed:number){
 if(precipitation>=7)return '强降水，建议暂停飞行';
 if(windSpeed>=12)return '强风，航线风险较高';
 if(code===95||code===96||code===99)return '雷暴，暂不适飞';
 if(code>=80)return '阵雨，需预留绕飞';
 if(code>=61)return '降雨，注意续航';
 if(code>=51)return '轻微降水';
 if(code>=45)return '低能见度';
 if(code>=2)return '多云，适合飞行';
 return '晴朗，适合飞行';
}

function flightIndex(code:number,precipitation:number,windSpeed:number,windGust:number){
 const rainPenalty=Math.min(48,precipitation*8);
 const windPenalty=Math.max(0,windSpeed-3)*3.2+Math.max(0,windGust-8)*1.8;
 const visibilityPenalty=code>=45&&code<=48?18:0;
 const stormPenalty=code>=95?55:code>=80?18:0;
 return Math.max(0,Math.min(100,100-rainPenalty-windPenalty-visibilityPenalty-stormPenalty));
}

function offlineWeather():WeatherSnapshot{
 const hour=new Date().getHours(),temperature=hour>=12&&hour<18?28:25;
 return {source:'offline',summary:'离线估算 · 基于深圳常态气象',temperature,precipitation:0,windSpeed:3.6,windDirection:135,windGust:5.8,weatherCode:2,flightIndex:84,observedAt:new Date().toISOString(),coverage:'corridor',samples:[]};
}

export const OFFLINE_WEATHER=offlineWeather();

function readCache(){
 try{const parsed=JSON.parse(localStorage.getItem(CACHE_KEY)??'null') as CachedWeather|null;if(parsed&&Date.now()-parsed.savedAt<6*60*60*1000)return {...parsed.weather,source:'cached' as const};}catch{}
 return null;
}

function writeCache(weather:WeatherSnapshot){
 try{localStorage.setItem(CACHE_KEY,JSON.stringify({savedAt:Date.now(),weather} satisfies CachedWeather));}catch{}
}

export function weatherForRoute(weather:WeatherSnapshot,points:readonly {x:number;z:number}[]):WeatherSnapshot{
 if(!points.length)return weather;
 const samples=points.map((point,index)=>{const factor=1+Math.sin(index*1.7+point.x*.0007+point.z*.0003)*.08;const windSpeed=Math.max(0,weather.windSpeed*factor);const windGust=Math.max(windSpeed,weather.windGust*factor);return {x:point.x,z:point.z,windSpeed,windDirection:(weather.windDirection+Math.sin(index)*8+360)%360,windGust,precipitation:weather.precipitation*factor,flightIndex:Math.max(0,Math.min(100,weather.flightIndex-(factor-1)*80))};});
 const worst=samples.reduce((a,b)=>b.flightIndex<a.flightIndex?b:a,samples[0]);
 return {...weather,coverage:'corridor',samples,windSpeed:worst.windSpeed,windDirection:worst.windDirection,windGust:worst.windGust,precipitation:worst.precipitation,flightIndex:worst.flightIndex};
}

export async function loadCurrentWeather():Promise<WeatherSnapshot>{
 try{
  const response=await fetch(WEATHER_URL,{signal:AbortSignal.timeout(5500),headers:{accept:'application/json'}});if(!response.ok)throw Error('weather-http-'+response.status);
  const current=(await response.json() as OpenMeteoResponse).current;if(!current)throw Error('weather-current-missing');
  const temperature=Number(current.temperature_2m),precipitation=Math.max(0,Number(current.precipitation??current.rain??0)),weatherCode=Number(current.weather_code??0),windSpeed=Math.max(0,Number(current.wind_speed_10m)),windDirection=Number(current.wind_direction_10m??0),windGust=Math.max(windSpeed,Number(current.wind_gusts_10m??windSpeed));
  if(![temperature,precipitation,weatherCode,windSpeed,windDirection,windGust].every(Number.isFinite))throw Error('weather-current-invalid');
  const weather:WeatherSnapshot={source:'live',summary:summary(weatherCode,precipitation,windSpeed),temperature,precipitation,windSpeed,windDirection,windGust,weatherCode,flightIndex:flightIndex(weatherCode,precipitation,windSpeed,windGust),observedAt:current.time??new Date().toISOString(),coverage:'point',samples:[]};writeCache(weather);return weather;
 }catch{return readCache()??offlineWeather();}
}
