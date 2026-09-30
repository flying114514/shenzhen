import {Mesh,PBRMaterial,Scene,Texture} from '@babylonjs/core';

type MaterialStyle={color:readonly [number,number,number];roughness:number;environment?:number;specular?:number;textureLevel?:number;unlit?:boolean};

const SURFACE_STYLES:Record<string,MaterialStyle>={
 land:{color:[1,1,1],roughness:.97,environment:.52,textureLevel:.56,unlit:true},
 park:{color:[.61,.76,.62],roughness:.99,environment:.50,textureLevel:.54,unlit:true},
 pavement:{color:[1,1,1],roughness:.94,environment:.48,textureLevel:.52,unlit:true},
 concrete:{color:[1,1,1],roughness:.95,environment:.48,textureLevel:.52,unlit:true},
 asphalt:{color:[.42,.49,.51],roughness:.98,environment:.42,specular:.08,textureLevel:.48,unlit:true},
 roadline:{color:[.99,.96,.80],roughness:.91,environment:.38,specular:.06,textureLevel:.50,unlit:true},
};

const BUILDING_STYLES:Record<string,MaterialStyle>={
 'city-office':{color:[.64,.76,.84],roughness:.76,environment:.68,textureLevel:.68},
 'city-residential':{color:[.92,.84,.70],roughness:.84,environment:.62,textureLevel:.68},
 'city-stone':{color:[.82,.80,.69],roughness:.89,environment:.58,textureLevel:.64},
 'city-concrete':{color:[.82,.86,.82],roughness:.91,environment:.60,textureLevel:.64},
 'city-roof':{color:[.38,.46,.48],roughness:.95,environment:.48,textureLevel:.58},
 'city-shopfront':{color:[.45,.66,.68],roughness:.80,environment:.60,textureLevel:.66},
 'city-steel':{color:[.56,.69,.74],roughness:.73,environment:.60,textureLevel:.64},
 'city-silver':{color:[.72,.78,.80],roughness:.73,environment:.60,textureLevel:.64},
};

const LANDMARK_STYLES:readonly [RegExp,MaterialStyle][]=[
 [/tencent|kk100/, {color:[.42,.66,.78],roughness:.35,environment:.74,specular:.46,textureLevel:.68}],
 [/pingan|fortune/, {color:[.54,.73,.84],roughness:.37,environment:.70,specular:.42,textureLevel:.68}],
 [/diwang|mixc/, {color:[.48,.72,.66],roughness:.38,environment:.68,specular:.40,textureLevel:.68}],
 [/qijie|bamboo/, {color:[.54,.70,.75],roughness:.42,environment:.64,specular:.34,textureLevel:.68}],
 [/glass|window/, {color:[.43,.60,.70],roughness:.46,environment:.62,specular:.32,textureLevel:.66}],
 [/steel|aluminum|silver/, {color:[.64,.75,.78],roughness:.68,environment:.58,specular:.25,textureLevel:.64}],
];

function applyStyle(material:PBRMaterial,style:MaterialStyle){
 material.albedoColor.copyFromFloats(...style.color);
 material.metallic=0;
 material.unlit=style.unlit??false;
 material.roughness=style.roughness;
 material.environmentIntensity=style.environment??.3;
 material.specularIntensity=style.specular??.24;
 material.directIntensity=1.12;
 material.emissiveColor.copyFromFloats(style.color[0]*.035,style.color[1]*.035,style.color[2]*.035);
 material.emissiveIntensity=.72;
 material.clearCoat.isEnabled=false;
 material.sheen.isEnabled=false;
 material.enableSpecularAntiAliasing=false;
 material.maxSimultaneousLights=2;
 if(style.unlit){material.albedoTexture=null;material.ambientTexture=null;material.bumpTexture=null;material.metallicTexture=null;}
 if(material.albedoTexture){
  material.albedoTexture.level=style.textureLevel??(style.unlit?.55:.30);
  if(material.albedoTexture instanceof Texture)material.albedoTexture.anisotropicFilteringLevel=style.unlit?1:4;
 }
}

/** Reuses existing assets to create a low-noise dispatch map without extra passes. */
export function applyTwinMapStyle(scene:Scene){
 scene.clearColor.set(.72,.86,.97,1);
 scene.fogMode=Scene.FOGMODE_NONE;
 scene.fogColor.copyFromFloats(.72,.86,.97);
 const image=scene.imageProcessingConfiguration;
 image.toneMappingEnabled=false;
 image.exposure=1;
 image.contrast=1.02;

 let styled=0;
 for(const material of scene.materials){
  if(!(material instanceof PBRMaterial))continue;
  const name=material.name.toLowerCase().replace(/\.\d+$/,'');
  const surface=SURFACE_STYLES[name];
  if(surface){applyStyle(material,surface);if(name!=='roadline'){material.albedoTexture=null;material.ambientTexture=null;material.bumpTexture=null;material.metallicTexture=null;}if(name==='roadline')material.zOffset=-2;styled++;continue;}
  if(name.startsWith('architecture:')){
   const role=Object.keys(BUILDING_STYLES).find(candidate=>name.includes(candidate));
   const landmark=LANDMARK_STYLES.find(([pattern])=>pattern.test(name))?.[1];
   applyStyle(material,role?BUILDING_STYLES[role]:landmark??{color:[.64,.72,.73],roughness:.82,environment:.46,textureLevel:.46});
   material.emissiveIntensity=landmark?.specular?0.025:0;
   styled++;
   continue;
  }
  if(name==='living-bay'){
   applyStyle(material,{color:[.32,.72,.96],roughness:.90,environment:.34,specular:.10,textureLevel:.58,unlit:true});
   material.reflectionTexture=null;
   styled++;
   continue;
  }
  if(name.includes('mountain')||name.includes('ground-relief')||name.includes('meadow')){
   applyStyle(material,{color:[1,1,1],roughness:.98,environment:.50,textureLevel:.54,unlit:true});
   styled++;
   continue;
  }
  if(/shore|coastal|bridge/.test(name)){
   applyStyle(material,{color:[1,1,1],roughness:.91,environment:.50,textureLevel:.54,unlit:true});
   styled++;
  }
 }
 for(const mesh of scene.meshes){
  if(!(mesh.material instanceof PBRMaterial))continue;
  if(mesh.name==='terrain_water'){
   applyStyle(mesh.material,{color:[.32,.72,.96],roughness:.92,environment:.34,specular:.08,textureLevel:.56,unlit:true});
   mesh.material.albedoTexture=null;mesh.material.ambientTexture=null;mesh.material.bumpTexture=null;mesh.material.metallicTexture=null;styled++;continue;
  }
  if(!mesh.name.startsWith('terrain_'))continue;
  if(mesh instanceof Mesh)mesh.useVertexColors=false;
  applyStyle(mesh.material,{color:[1,1,1],roughness:.96,environment:.50,textureLevel:.56,unlit:true});mesh.material.albedoTexture=null;mesh.material.ambientTexture=null;mesh.material.bumpTexture=null;mesh.material.metallicTexture=null;styled++;
 }
 // The compact shadow map is reserved for building-to-building depth. Large
 // terrain tiles would otherwise sample outside its small frustum and turn
 // distant ground into hard black patches while the camera is moving.
 for(const mesh of scene.meshes)if(/^(?:terrain_|roads_)/.test(mesh.name))mesh.receiveShadows=false;
 return {styledMaterials:styled,palette:'minimal-dispatch-map',extraPasses:0,extraGeometry:0};
}
