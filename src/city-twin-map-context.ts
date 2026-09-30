import {Color3,MeshBuilder,PBRMaterial,Scene,Vector3} from '@babylonjs/core';

/** A quiet matte backing and surveyed-data perimeter for the detailed city core. */
export function createTwinMapContext(scene:Scene,extent:number[],heightAt:(x:number,z:number)=>number){
 const [west,south,east,north]=extent,margin=900;
 const backing=MeshBuilder.CreateGround('twin-map-backing',{width:east-west+margin*2,height:north-south+margin*2,subdivisions:1},scene);
 backing.position.set((west+east)/2,-.62,(south+north)/2);
 backing.isPickable=false;
 backing.receiveShadows=false;
 const material=new PBRMaterial('twin-map-backing-matte',scene);
 material.albedoColor=new Color3(1,1,1);
 material.unlit=true;
 material.metallic=0;
 material.roughness=1;
 material.environmentIntensity=.12;
 material.specularIntensity=0;
 material.maxSimultaneousLights=1;
 backing.material=material;
 backing.freezeWorldMatrix();

 const points:Vector3[]=[];
 const add=(x:number,z:number)=>points.push(new Vector3(x,heightAt(x,z)+.6,z));
 const step=240;
 for(let x=west;x<east;x+=step)add(x,south);add(east,south);
 for(let z=south;z<north;z+=step)add(east,z);add(east,north);
 for(let x=east;x>west;x-=step)add(x,north);add(west,north);
 for(let z=north;z>south;z-=step)add(west,z);add(west,south);
 const boundary=MeshBuilder.CreateLines('twin-detailed-city-boundary',{points,updatable:false},scene);
 boundary.color=new Color3(.18,.52,.55);
 boundary.alpha=.26;
 boundary.isPickable=false;
 boundary.freezeWorldMatrix();

 scene.onDisposeObservable.addOnce(()=>{boundary.dispose(false,false);backing.dispose(false,false);material.dispose(false,false);});
 return {backing,boundary,extent:[...extent],margin};
}
