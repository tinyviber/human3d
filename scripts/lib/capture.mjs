import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {AffectedCheckError,decodeUtf8Strict} from './affected-checks.mjs';

const sha256Bytes=value=>crypto.createHash('sha256').update(value).digest();
export const sha256Hex=value=>crypto.createHash('sha256').update(value).digest('hex');
const ascii=value=>Buffer.from(String(value),'ascii');
const utf8=value=>Buffer.from(String(value),'utf8');
const u32be=value=>{const b=Buffer.alloc(4);b.writeUInt32BE(value>>>0);return b;};
const u64be=value=>{const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(value));return b;};

export const HASH_PREFIX=Buffer.concat([utf8('HUMAN3D-PR11B-HASH-v1'),Buffer.from([0])]);

export function framedHash(domain,rows){
 const domainBytes=utf8(domain);
 const chunks=[HASH_PREFIX,u32be(domainBytes.length),domainBytes,u64be(rows.length)];
 for(const row of rows){
  chunks.push(u32be(row.length));
  for(const field of row){
   const bytes=Buffer.isBuffer(field)?field:utf8(field);
   chunks.push(u64be(bytes.length),bytes);
  }
 }
 return crypto.createHash('sha256').update(Buffer.concat(chunks)).digest('hex');
}

export const orderedJsonSha256=value=>sha256Hex(Buffer.from(JSON.stringify(value),'utf8'));

export const trimOneLf=value=>{
 const text=Buffer.isBuffer(value)?value.toString('utf8'):String(value);
 return text.endsWith('\n')?text.slice(0,-1):text;
};

const lstatOrNull=value=>{try{return fs.lstatSync(value);}catch{return null;}};
const fileState=value=>{
 const stat=lstatOrNull(value);
 if(stat===null)return {state:'absent',bytes:null};
 if(!stat.isFile())return {state:'unavailable',bytes:null};
 try{
  const bytes=fs.readFileSync(value);
  return {state:bytes.length===0?'empty':'nonempty',bytes};
 }catch{return {state:'unavailable',bytes:null};}
};

export const normalizedBoolConfig=(result)=>{
 if(result.status===1&&result.stdout.length===0)return 'unset';
 if(result.status!==0)return null;
 const text=trimOneLf(result.stdout);
 if(text==='true'||text==='false')return text;
 return null;
};

const safeRealpath=value=>{try{return fs.realpathSync(value);}catch{return value;}};

const gitPathAbsolute=(context,args)=>{
 const result=context.run(['rev-parse','--git-path',...args]);
 const resolved=trimOneLf(result.stdout);
 const absolute=path.isAbsolute(resolved)?resolved:path.resolve(context.root,resolved);
 return safeRealpath(absolute);
};

const requireEqualPath=(actual,expected,label)=>{
 if(actual!==expected)throw new AffectedCheckError(`${label} resolves outside its canonical anchor`,'snapshot-unavailable');
};

const hashInfoFile=(context,relativeArgs,expectedDir,expectedLeaf,domain,label)=>{
 const resolved=gitPathAbsolute(context,relativeArgs);
 requireEqualPath(resolved,path.join(expectedDir,expectedLeaf),label);
 const dir=lstatOrNull(expectedDir);
 if(dir===null){
  const digest=framedHash(domain,[[ascii(expectedLeaf),ascii('absent'),Buffer.alloc(0)]]);
  return {state:'absent',digest,sha256:digest};
 }
 if(!dir.isDirectory()||dir.isSymbolicLink())return {state:null,digest:null,sha256:null};
 const {state,bytes}=fileState(resolved);
 if(state==='unavailable'||state===null)return {state:null,digest:null,sha256:null};
 const raw=bytes??Buffer.alloc(0);
 const digest=framedHash(domain,[[ascii(expectedLeaf),ascii(state),raw]]);
 return {
  state,
  digest,
  sha256:raw.length>0?sha256Hex(raw):digest,
 };
};

const parseReplaceRefs=(stdout)=>{
 const text=stdout.toString('utf8');
 if(text==='')return {records:[],digest:framedHash('replace-refs-v1',[])};
 const records=[];
 for(const line of text.split('\n')){
  if(line==='')continue;
  const nul=line.indexOf('\0');
  if(nul<0)return {records:null,digest:null};
  const ref=Buffer.from(line.slice(0,nul),'utf8');
  const oid=line.slice(nul+1);
  if(!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(oid))return {records:null,digest:null};
  records.push([ref,ascii(oid)]);
 }
 records.sort((a,b)=>Buffer.compare(a[0],b[0]));
 return {records,digest:framedHash('replace-refs-v1',records),count:records.length};
};

export function probeRepositoryState(context,{root,gitDir,commonDir,objectFormat}){
 const result={
  objectDir:null,objectAlternatesState:null,objectAlternatesSha256:null,objectAlternates:null,
  replaceRefs:null,replaceRefsSha256:null,grafts:null,graftsSha256:null,
  infoExcludeState:null,infoExcludeSha256:null,
  infoAttributesPath:null,infoAttributesState:null,infoAttributesSha256:null,
  localConfigSha256:null,
  coreSparseCheckoutState:null,indexSparseState:null,
  splitIndexState:null,splitIndexSha256:null,
  workspaceLinks:null,workspaceLinksSha256:null,
  indexPath:null,
  failureKind:null,
 };

 // object dir + alternates
 try{
  const objectDir=fs.realpathSync(path.join(commonDir,'objects'));
  const stat=fs.lstatSync(objectDir);
  if(!stat.isDirectory())throw new AffectedCheckError('object directory missing','snapshot-unavailable');
  result.objectDir=objectDir;
  const infoDir=lstatOrNull(path.join(objectDir,'info'));
  if(infoDir===null||(infoDir.isDirectory()&&!infoDir.isSymbolicLink())){
   const resolved=gitPathAbsolute(context,['objects/info/alternates']);
   requireEqualPath(resolved,path.join(objectDir,'info','alternates'),'object alternates');
   const {state,bytes}=fileState(resolved);
   result.objectAlternatesState=state==='unavailable'?null:state;
   if(state==='unavailable'||state===null){
    result.objectAlternatesSha256=null;result.objectAlternates=null;
   }else{
    const raw=bytes??Buffer.alloc(0);
    result.objectAlternatesSha256=framedHash('object-alternates-v1',[[ascii(state),raw]]);
    result.objectAlternates=state==='nonempty'?null:[];
    if(state==='nonempty')result.failureKind='git-history-rewrite';
   }
  }
 }catch(error){
  if(error instanceof AffectedCheckError)throw error;
  result.objectAlternatesState=null;result.objectAlternatesSha256=null;result.objectAlternates=null;
 }

 // replace refs
 try{
  const stdout=context.run(['for-each-ref','--format=%(refname)%00%(objectname)','refs/replace']).stdout;
  const parsed=parseReplaceRefs(stdout);
  if(parsed.records===null){result.replaceRefsSha256=null;result.replaceRefs=null;}
  else{
   result.replaceRefsSha256=parsed.digest;
   result.replaceRefs=parsed.records.length===0?[]:null;
   if(parsed.records.length>0)result.failureKind='git-history-rewrite';
  }
 }catch{result.replaceRefsSha256=null;result.replaceRefs=null;}

 // grafts
 try{
  const resolved=gitPathAbsolute(context,['info/grafts']);
  requireEqualPath(resolved,path.join(commonDir,'info','grafts'),'grafts');
  const {state,bytes}=fileState(resolved);
  result.grafts=state==='unavailable'?null:state;
  if(state==='unavailable'||state===null){result.graftsSha256=null;}
  else{
   const raw=bytes??Buffer.alloc(0);
   result.graftsSha256=framedHash('grafts-v1',[[ascii('info/grafts'),ascii(state),raw]]);
   if(state==='nonempty')result.failureKind='git-history-rewrite';
  }
  if(state==='absent')result.graftsSha256=framedHash('grafts-v1',[[ascii('info/grafts'),ascii('absent'),Buffer.alloc(0)]]);
 }catch(error){
  if(error instanceof AffectedCheckError)throw error;
  result.grafts=null;result.graftsSha256=null;
 }

 // info/exclude + info/attributes
 try{
  const exclude=hashInfoFile(context,['info/exclude'],path.join(commonDir,'info'),'exclude','info-exclude-v1','info/exclude');
  result.infoExcludeState=exclude.state;
  result.infoExcludeSha256=exclude.sha256;
 }catch(error){if(error instanceof AffectedCheckError)throw error;}
 try{
  const resolved=gitPathAbsolute(context,['info/attributes']);
  const accepted=new Set([path.join(gitDir,'info','attributes'),path.join(commonDir,'info','attributes')]);
  if(!accepted.has(resolved))throw new AffectedCheckError('info/attributes resolves outside canonical dirs','snapshot-unavailable');
  result.infoAttributesPath=resolved;
  const dir=lstatOrNull(path.dirname(resolved));
  if(dir===null||!dir.isDirectory()||dir.isSymbolicLink()){result.infoAttributesState='absent';}
  else{
   const {state,bytes}=fileState(resolved);
   result.infoAttributesState=state==='unavailable'?null:state;
   const raw=bytes??Buffer.alloc(0);
   const digest=framedHash('info-attributes-v1',[[ascii('info/attributes'),ascii(result.infoAttributesState),raw]]);
   result.infoAttributesSha256=raw.length>0?sha256Hex(raw):digest;
  }
  if(result.infoAttributesState==='absent'&&result.infoAttributesSha256===null)
   result.infoAttributesSha256=framedHash('info-attributes-v1',[[ascii('info/attributes'),ascii('absent'),Buffer.alloc(0)]]);
  if(result.infoAttributesState==='absent'&&result.infoAttributesPath===null)result.infoAttributesPath=resolved;
 }catch(error){if(error instanceof AffectedCheckError)throw error;result.infoAttributesState=null;}

 // local config digest: exact bytes of the pinned config list command
 try{
  const configPath=path.join(commonDir,'config');
  const listed=context.run(['config','--no-includes','--null','--list','--file',configPath]).stdout;
  result.localConfigSha256=sha256Hex(listed);
 }catch{result.localConfigSha256=null;}

 // sparse + split index config probes
 const boolProbe=args=>normalizedBoolConfig(context.run(args,{allowFailure:true}));
 result.coreSparseCheckoutState=boolProbe(['config','--bool','--get','core.sparseCheckout']);
 result.indexSparseState=boolProbe(['config','--bool','--get','index.sparse']);
 const splitIndexConfig=boolProbe(['config','--bool','--get','core.splitIndex']);
 let sharedIndexPath=null;
 try{
  const sharedResult=context.run(['rev-parse','--shared-index-path'],{allowFailure:true});
  sharedIndexPath=sharedResult.status===0?trimOneLf(sharedResult.stdout):null;
 }catch{sharedIndexPath=null;}
 const splitActive=splitIndexConfig==='true'||(typeof sharedIndexPath==='string'&&sharedIndexPath!=='');
 const splitInactive=(splitIndexConfig==='unset'||splitIndexConfig==='false')&&(sharedIndexPath===''||sharedIndexPath===null);
 result.splitIndexState=splitActive?'active':splitInactive?'inactive':'unknown';
 result.splitIndexSha256=splitInactive?framedHash('split-index-v1',[[ascii('inactive')]]):null;
 if(splitActive||result.coreSparseCheckoutState==='true'||result.indexSparseState==='true')result.failureKind='hidden-index-state';
 if(result.splitIndexState==='unknown'||result.coreSparseCheckoutState===null||result.indexSparseState===null){
  // fail-closed: capture incomplete
 }

 // index path
 try{
  const resolved=gitPathAbsolute(context,['index']);
  requireEqualPath(resolved,path.join(gitDir,'index'),'index');
  result.indexPath=resolved;
 }catch(error){if(error instanceof AffectedCheckError)throw error;result.indexPath=null;}

 // workspace links
 try{
  const names=['motion-core','web','server'];
  const rows=[];
  let ok=true;
  for(const name of names){
   const linkPath=`node_modules/@human3d/${name}`;
   const absolute=path.join(root,linkPath);
   const stat=lstatOrNull(absolute);
   if(stat===null){ok=false;break;}
   let type;let rawTarget=Buffer.alloc(0);let realTarget='';
   if(stat.isSymbolicLink()){
    type='symlink';
    rawTarget=Buffer.from(fs.readlinkSync(absolute),'utf8');
    const resolved=fs.realpathSync(absolute);
    realTarget=path.relative(root,resolved);
    if(path.isAbsolute(realTarget)||realTarget.startsWith('..')){ok=false;break;}
   }else if(stat.isDirectory()){type='directory';}
   else if(stat.isFile()){type='file';}
   else{ok=false;break;}
   const mode=(stat.mode&0o7777).toString(8).padStart(4,'0');
   rows.push([utf8(name),utf8(linkPath),ascii(type),rawTarget,utf8(realTarget),ascii(String(stat.dev)),ascii(String(stat.ino)),ascii(mode)]);
  }
  if(ok){
   result.workspaceLinks=rows.map(row=>({name:decodeUtf8Strict(row[0]),type:row[2].toString('ascii')}));
   result.workspaceLinksSha256=framedHash('workspace-links-v1',rows);
  }else{result.workspaceLinks=null;result.workspaceLinksSha256=null;}
 }catch{result.workspaceLinks=null;result.workspaceLinksSha256=null;}

 return result;
}

export const repositoryIdentityObject=fields=>({
 root:fields.root,
 gitDir:fields.gitDir,
 commonDir:fields.commonDir,
 indexPath:fields.indexPath,
 objectDir:fields.objectDir,
 objectFormat:fields.objectFormat,
 headSha:fields.headSha,
 gitNoReplaceObjects:true,
 shallow:fields.shallow,
 coreSparseCheckoutState:fields.coreSparseCheckoutState,
 indexSparseState:fields.indexSparseState,
 worktreeMatchesIndex:fields.worktreeMatchesIndex,
 splitIndexSha256:fields.splitIndexSha256,
 localConfigSha256:fields.localConfigSha256,
 infoExcludeState:fields.infoExcludeState,
 infoExcludeSha256:fields.infoExcludeSha256,
 infoAttributesPath:fields.infoAttributesPath,
 infoAttributesState:fields.infoAttributesState,
 infoAttributesSha256:fields.infoAttributesSha256,
 objectAlternatesState:fields.objectAlternatesState,
 objectAlternatesSha256:fields.objectAlternatesSha256,
 replaceRefsSha256:fields.replaceRefsSha256,
 graftsSha256:fields.graftsSha256,
 workspaceLinksSha256:fields.workspaceLinksSha256,
});

export function repositoryIdentitySha256(identity){
 const required=['root','gitDir','commonDir','indexPath','objectDir','objectFormat','gitNoReplaceObjects','shallow','worktreeMatchesIndex','splitIndexSha256','localConfigSha256','infoExcludeState','infoAttributesPath','infoAttributesState','objectAlternatesState','objectAlternatesSha256','replaceRefsSha256','graftsSha256','workspaceLinksSha256'];
 for(const key of required){
  if(identity[key]===null||identity[key]===undefined)return null;
 }
 return orderedJsonSha256(identity);
}

const modeOctal=stat=>(stat.mode&0o7777).toString(8).padStart(4,'0');

const blobOid=(bytes,format)=>{
 const hash=format==='sha256'?'sha256':'sha1';
 return crypto.createHash(hash).update(Buffer.concat([ascii(`blob ${bytes.length}`),Buffer.from([0]),bytes])).digest('hex');
};

// Read a worktree file under root without following parent symlinks.
const readWorktreeLeaf=(root,relative)=>{
 const absolute=path.join(root,relative);
 const parent=path.dirname(absolute);
 const rel=path.relative(root,parent);
 if(rel.startsWith('..')||path.isAbsolute(rel))return null;
 // walk components, require each existing parent a real directory
 let current=root;
 if(rel!==''){
  for(const part of rel.split(path.sep)){
   current=path.join(current,part);
   const stat=lstatOrNull(current);
   if(stat===null||!stat.isDirectory()||stat.isSymbolicLink())return null;
  }
 }
 const stat=lstatOrNull(absolute);
 if(stat===null)return {missing:true};
 if(stat.isSymbolicLink())return {type:'symlink',bytes:Buffer.from(fs.readlinkSync(absolute),'utf8'),mode:modeOctal(stat),stat};
 if(stat.isFile())return {type:'file',bytes:fs.readFileSync(absolute),mode:modeOctal(stat),stat};
 return null;
};

export function trackedContentDigest(context,root,format){
 const stageRaw=context.run(['ls-files','--stage','-z']).stdout;
 const rows=[];
 let worktreeMatchesIndex=true;
 let complete=true;
 for(const record of nulPathList(stageRaw)){
  const tab=record.indexOf(0x09);
  if(tab<0){complete=false;break;}
  const header=record.subarray(0,tab).toString('ascii');
  const pathBytes=Buffer.from(record.subarray(tab+1));
  const [mode,oid,stage]=header.split(' ');
  if(mode==='040000'){worktreeMatchesIndex=false;}
  if(stage!=='0'){worktreeMatchesIndex=false;}
  const relPath=decodeUtf8Strict(pathBytes);
  if(relPath===undefined){complete=false;continue;}
  const leaf=readWorktreeLeaf(root,relPath);
  if(leaf===null){complete=false;continue;}
  if(leaf.missing){
   rows.push([pathBytes,ascii('missing'),ascii('NULL'),Buffer.alloc(0)]);
   worktreeMatchesIndex=false;
   continue;
  }
  const computed=blobOid(leaf.bytes,format);
  const indexType=mode==='120000'?'symlink':(mode==='100644'||mode==='100755')?'file':'other';
  const matchesOid=computed===oid&&(indexType==='other'||leaf.type===indexType);
  const executable=leaf.mode[0]==='7'||leaf.mode[1]==='7'||leaf.mode[2]==='7';
  const matchesMode=mode==='120000'?leaf.type==='symlink'
   :mode==='100755'?leaf.type==='file'&&executable
   :mode==='100644'?leaf.type==='file'&&!executable
   :leaf.type===indexType;
  if(!matchesOid||!matchesMode)worktreeMatchesIndex=false;
  rows.push([pathBytes,ascii(leaf.type),ascii(leaf.mode),leaf.bytes]);
 }
 if(!complete)return {digest:null,worktreeMatchesIndex:null};
 rows.sort((a,b)=>Buffer.compare(a[0],b[0]));
 return {
  digest:framedHash('tracked-content-v1',rows),
  worktreeMatchesIndex,
 };
}

export function nulPathList(stdout){
 if(stdout.length===0)return [];
 if(stdout[stdout.length-1]!==0)throw new AffectedCheckError('path stream is not NUL terminated','snapshot-unavailable');
 const list=[];
 let start=0;
 for(let index=0;index<stdout.length;index++){
  if(stdout[index]!==0)continue;
  list.push(Buffer.from(stdout.subarray(start,index)));
  start=index+1;
 }
 return list;
}

export function untrackedContentDigest(context,root,extraArgs=[]){
 const raw=context.run(['ls-files','--others','--exclude-standard','-z',...extraArgs]).stdout;
 const paths=nulPathList(raw);
 const rows=[];
 let complete=true;
 for(const pathBytes of paths){
  const relPath=decodeUtf8Strict(pathBytes);
  if(relPath===undefined){complete=false;continue;}
  const leaf=readWorktreeLeaf(root,relPath);
  if(leaf===null){complete=false;continue;}
  if(leaf.missing){
   rows.push([pathBytes,ascii('missing'),ascii('NULL'),Buffer.alloc(0)]);
   continue;
  }
  rows.push([pathBytes,ascii(leaf.type),ascii(leaf.mode),leaf.bytes??Buffer.alloc(0)]);
 }
 if(!complete)return null;
 rows.sort((a,b)=>Buffer.compare(a[0],b[0]));
 return framedHash('untracked-content-v1',rows);
}

const GENERATED_FILTER=/((^|\/)node_modules(\/|$))|(^\.out\/)|(^\.venv-dynamics\/)|(^dist\/)|((^|\/)__pycache__(\/|$))|(^|\/)\.DS_Store$|\.tsbuildinfo$/;

export function ignoredInputManifestDigest(context,root,scopePaths){
 const raw=context.run(['ls-files','--others','--ignored','--exclude-standard','-z','--',...scopePaths]).stdout;
 const paths=nulPathList(raw);
 const rows=[];
 for(const pathBytes of paths){
  const relPath=decodeUtf8Strict(pathBytes);
  if(relPath===undefined||GENERATED_FILTER.test(relPath))continue;
  const leaf=readWorktreeLeaf(root,relPath);
  if(leaf===null||leaf.missing)continue;
  rows.push([pathBytes,ascii(leaf.type),ascii(leaf.mode),leaf.bytes??Buffer.alloc(0)]);
 }
 rows.sort((a,b)=>Buffer.compare(a[0],b[0]));
 return {digest:framedHash('ignored-input-manifest-v1',rows),count:rows.length};
}

export const CAPTURE_KEYS=[
 'captureId','boundary','checkId','pass','complete','headStartSha','headEndSha',
 'statusSha256','committedManifestSha256','stagedManifestSha256','unstagedManifestSha256',
 'untrackedManifestSha256','committedPatchSha256','stagedPatchSha256','unstagedPatchSha256',
 'trackedContentSha256','untrackedContentSha256','ignoredInputManifestSha256',
 'indexFileSha256','indexEntriesSha256','indexFlagsSha256','splitIndexSha256',
 'replaceRefsSha256','graftsSha256','workspaceLinksSha256','repositoryIdentitySha256',
 'toolIdentitySha256','environmentSha256','captureSha256',
];

export const captureDigest=capture=>{
 const pairs=CAPTURE_KEYS.filter(key=>!['captureSha256','captureId','boundary','checkId','pass','complete'].includes(key)).map(key=>[key,capture[key]??null]);
 return sha256Hex(Buffer.from(JSON.stringify(pairs),'utf8'));
};

export const PROJECTION_KEYS=CAPTURE_KEYS.slice(5,28);
