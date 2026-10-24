import {Color, type Scene} from 'three';
import {webPlatform} from '../platform/platform';

/** Keep the WebGL clear color on the page's canvas ground. The app is
 * light-only, so the token is read once at bind time. Returns the
 * unsubscribe used by dispose. */
export function bindSceneBackground(scene:Scene){
 const raw=webPlatform.cssVar('--canvas')||webPlatform.cssVar('--bg');
 if(raw)scene.background=new Color(raw);
 return ()=>{};
}
