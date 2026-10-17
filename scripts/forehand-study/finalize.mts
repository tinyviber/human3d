// Take the LIVE UI-authored doc, run it through normalizeDoc (the same entry
// the workshop export + service action both use), wrap it in the request
// envelope, and verify the executable contract accepts it.
import fs from 'node:fs';import path from 'node:path';
import {createService,handleRequest} from '../../src/server/service';
import {createContract} from '../../src/server/contract';
import {normalizeDoc} from '../../src/workshop/document';
const ctx=await createService(path.resolve('public'));
const live=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const doc=normalizeDoc(live);
const req={action:{id:'workshop-doc',parameters:{document:doc}}};
fs.writeFileSync(process.argv[3],JSON.stringify(req,null,2));
const contract=createContract();
console.log('contract.request →',contract.request(req));
if(!contract.request(req))console.log(JSON.stringify(contract.request.errors).slice(0,800));
const r=handleRequest(ctx,'POST','/v1/motions',req,{});
console.log('handleRequest →',r.status);
if(r.status!==200)console.log(JSON.stringify(r.body).slice(0,800));
else{const b=r.body as any;console.log('pkg id',b.id,'frames',b.timeline?.count,'checks',b.quality?.checks?.length,'events',b.events?.length);}
