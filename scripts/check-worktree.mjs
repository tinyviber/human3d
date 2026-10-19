import path from 'node:path';
import {assertPortAvailable,validateWorktreePath,validateWorkspaceLinks} from './lib/worktree-check.mjs';

const usage='Usage: npm run worktree:check -- --source-root <source checkout> [--worktree-root <worktree>]\nRun npm ci separately inside each worktree. Suggested distinct ports: HUMAN3D_WEB_PORT=5174 HUMAN3D_PREVIEW_PORT=4174 HUMAN3D_PORT=8789.';
const args=process.argv.slice(2);
const value=(name,fallback)=>{
 const i=args.indexOf(name);
 if(i<0)return fallback;
 if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`${name} requires a path`);
 return args[i+1];
};

try{
 const sourceRoot=path.resolve(value('--source-root',process.env.HUMAN3D_SOURCE_ROOT??''));
 const worktreeRoot=path.resolve(value('--worktree-root',process.cwd()));
 if(!process.env.HUMAN3D_SOURCE_ROOT&&!args.includes('--source-root'))throw new Error('provide --source-root');
 const pathResult=validateWorktreePath(sourceRoot,worktreeRoot);
 const links=validateWorkspaceLinks(worktreeRoot,['motion-core','web','server']);
 const host=process.env.HUMAN3D_HOST??'127.0.0.1';
 const ports=[
  ['web',Number(process.env.HUMAN3D_WEB_PORT??5173)],
  ['preview',Number(process.env.HUMAN3D_PREVIEW_PORT??4173)],
  ['service',Number(process.env.HUMAN3D_PORT??8788)],
 ];
 const issues=[...pathResult.issues,...links.issues];
  const portOwners=new Map();
  for(const [name,port]of ports){
   const previous=portOwners.get(port);
   if(previous)issues.push(`port conflict: ${previous} and ${name} both select ${host}:${port}; choose distinct HUMAN3D_WEB_PORT, HUMAN3D_PREVIEW_PORT, and HUMAN3D_PORT values`);
   else portOwners.set(port,name);
  }
 for(const [name,port]of ports){
  try{await assertPortAvailable(host,port);console.log(`${name} ${host}:${port} is available`);}
  catch(error){issues.push(`${name}: ${error instanceof Error?error.message:String(error)}`);}
 }
 if(!pathResult.ok||!links.ok||issues.length){
  for(const issue of issues)console.error(`ERROR: ${issue}`);
  console.error(usage);
  process.exitCode=1;
 }else console.log(`Worktree isolation checks passed for ${worktreeRoot}.\n${usage}`);
}catch(error){
 console.error(error instanceof Error?error.message:String(error));
 console.error(usage);
 process.exitCode=1;
}
