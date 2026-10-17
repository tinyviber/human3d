import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createService,handleRequest,LIMITS_SVC} from './service';
// Loopback-only reference service for the v1 motion protocol. No user-supplied
// paths/scripts; request body capped; pose-json output only.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const assetDir=process.env.HUMAN3D_ASSETS??path.join(root,'public');
const port=Number(process.env.HUMAN3D_PORT??8788);
const ctx=await createService(assetDir);
const server=http.createServer((req,res)=>{
 const send=(status:number,body:unknown)=>{
  const data=JSON.stringify(body);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(data)});
  res.end(data);
 };
 const url=new URL(req.url??'/','http://localhost');
 const chunks:Buffer[]=[];let size=0;
 req.on('data',c=>{size+=c.length;if(size>LIMITS_SVC.maxBodyBytes){res.destroy();return;}chunks.push(c);});
 req.on('end',()=>{
  let body:unknown;
  if(chunks.length){
   try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
   catch{send(400,{error:{code:'invalid_json',message:'request body is not valid JSON'}});return;}
  }
  try{
   const headers:Record<string,string>={};
   const idem=req.headers['idempotency-key'];if(typeof idem==='string')headers['idempotency-key']=idem;
   const out=handleRequest(ctx,req.method??'GET',url.pathname,body,headers);
   send(out.status,out.body);
  }catch(e){send(500,{error:{code:'internal',message:e instanceof Error?e.message:String(e)}});}
 });
});
server.listen(port,'127.0.0.1',()=>{
 console.log(`human3d-motion v1 listening on http://127.0.0.1:${port}`);
 console.log(`GET /v1/capabilities · POST /v1/motions · assets: ${assetDir}`);
});
