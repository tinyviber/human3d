import {createRoot} from 'react-dom/client';
import {WorkshopApp} from './WorkshopApp';
import type {RigInfo} from '@human3d/motion-core';
import '../style.css';
import './workshop.css';
const host=document.getElementById('root')!;
fetch('/models/rig.json')
 .then(r=>{if(!r.ok)throw new Error('人体骨架加载失败');return r.json() as Promise<RigInfo>;})
 .then(info=>createRoot(host).render(<WorkshopApp info={info}/>))
 .catch(e=>{host.innerHTML=`<main class="ws-loading"><strong>无法加载人体骨架</strong><p>${e instanceof Error?e.message:String(e)}</p></main>`;});
