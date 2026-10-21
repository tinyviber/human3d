import {Color, type Scene} from 'three';

/** Keep the WebGL clear color on the Magpie page ground, including a live
 * `prefers-color-scheme` change. Returns the unsubscribe used by dispose. */
export function bindSceneBackground(scene:Scene){
 const media=window.matchMedia('(prefers-color-scheme: dark)');
 const apply=()=>{
  const raw=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if(raw)scene.background=new Color(raw);
 };
 apply();
 media.addEventListener('change', apply);
 return ()=>media.removeEventListener('change', apply);
}
