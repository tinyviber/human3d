import {Color, type Scene} from 'three';
import {webPlatform, type AppPlatform} from '../platform/platform';

/** Keep the WebGL clear color on the page's canvas ground. The app is
 * light-only, so the token is read once at bind time. Returns the
 * unsubscribe used by dispose. */
export function bindSceneBackground(scene:Scene,platform:AppPlatform=webPlatform){
 const raw=platform.cssVar('--canvas')||platform.cssVar('--bg');
 if(raw)scene.background=new Color(raw);
 return ()=>{};
}
