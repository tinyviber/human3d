import {Color, type Scene} from 'three';

/** Keep the WebGL clear color on the page's canvas ground. The app is
 * light-only, so the token is read once at bind time. Returns the
 * unsubscribe used by dispose. */
export function bindSceneBackground(scene:Scene){
 const styles=getComputedStyle(document.documentElement);
 const raw=styles.getPropertyValue('--canvas').trim()||styles.getPropertyValue('--bg').trim();
 if(raw)scene.background=new Color(raw);
 return ()=>{};
}
