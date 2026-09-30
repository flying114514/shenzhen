import {ShaderMaterial,Texture,Scene} from '@babylonjs/core';

type SkySlot={key:string;label:string;file:string;source:string};
const SKY_SLOTS:SkySlot[]=[
 {key:'night',label:'深夜 · 00–04',file:'/sky/night.jpg',source:'Poly Haven · CC0 · local cache'},
 {key:'dawn',label:'黎明 · 04–08',file:'/sky/dawn.jpg',source:'Poly Haven · CC0 · local cache'},
 {key:'morning',label:'上午 · 08–12',file:'/sky/morning.jpg',source:'Poly Haven · CC0 · local cache'},
 {key:'noon',label:'正午 · 12–16',file:'/sky/noon.jpg',source:'Poly Haven · CC0 · local cache'},
 {key:'sunset',label:'傍晚 · 16–20',file:'/sky/sunset.jpg',source:'Poly Haven · CC0 · local cache'},
 {key:'evening',label:'夜间 · 20–24',file:'/sky/evening.jpg',source:'Poly Haven · CC0 · local cache'},
];

function slotForHour(hour:number){return SKY_SLOTS[Math.max(0,Math.min(SKY_SLOTS.length-1,Math.floor(hour/4)))];}
function shenzhenHour(date:Date){return Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'}).format(date));}

export function createTimeSky(scene:Scene,skyMat:ShaderMaterial){
 let activeTexture:Texture|null=null,activeSlot:SkySlot|null=null,ready=false,timer=0;
 const apply=(date=new Date())=>{
  const slot=slotForHour(shenzhenHour(date));if(slot.key===activeSlot?.key)return;
  const texture=new Texture(slot.file,scene,true,false,Texture.BILINEAR_SAMPLINGMODE,()=>{const previous=activeTexture;activeTexture=texture;activeSlot=slot;ready=true;skyMat.setTexture('skyPhoto',texture);skyMat.setFloat('skyPhotoReady',1);if(previous&&previous!==texture)previous.dispose();},()=>{if(activeSlot?.key!==slot.key){skyMat.setFloat('skyPhotoReady',0);ready=false;}});
  texture.wrapU=Texture.WRAP_ADDRESSMODE;texture.wrapV=Texture.CLAMP_ADDRESSMODE;texture.anisotropicFilteringLevel=1;
 };
 apply();timer=window.setInterval(()=>apply(),60*1000);scene.onDisposeObservable.addOnce(()=>{window.clearInterval(timer);activeTexture?.dispose();});
 return {update:apply,get stats(){return {slot:activeSlot?.key??null,label:activeSlot?.label??'渐变回退',source:activeSlot?.source??'shader gradient fallback',ready,textureSize:activeTexture?.getSize()??null,intervalMinutes:4*60};}};
}

export {SKY_SLOTS};
