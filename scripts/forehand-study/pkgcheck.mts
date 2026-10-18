import fs from 'node:fs';import path from 'node:path';
import {createService,handleRequest} from '../../src/server/service';
import {validatePosePackage} from '../../src/server/validate';
const ctx=await createService(path.resolve('public'));
const req=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const r=handleRequest(ctx,'POST','/v1/motions',req,{});
if(r.status!==200){console.log('FAIL',r.status,JSON.stringify(r.body).slice(0,500));process.exit(1);}
const b=r.body as any;
for(const c of b.quality.checks)console.log((c.ok?'OK ':'BAD'),c.code.padEnd(28),(c.detail??'').slice(0,80),c.value??'',c.unit??'');
console.log('events:',b.events.map((e:any)=>`${e.time.toFixed(2)} ${e.type} ${e.side??''} ${e.label??''}`).join(' | '));
const errs=validatePosePackage(b,ctx.manifest);
console.log('validatePosePackage errors:',errs.length,errs.slice(0,5));
fs.writeFileSync(process.argv[3],JSON.stringify(b,null,2));
