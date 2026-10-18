import path from 'node:path';
import {pathToFileURL} from 'node:url';

const successful='success';

const statusReason=(name,status)=>{
 if(status===undefined||status===null||status==='')return `${name}_unrun`;
 if(status==='failure')return `${name}_failed`;
 if(status==='cancelled')return `${name}_cancelled`;
 if(status==='stale')return `${name}_stale`;
 if(status==='skipped')return `${name}_skipped`;
 return `${name}_not_successful`;
};

export function requiredResult({event,draft,fast,full}){
 if(event!=='pull_request'&&event!=='push')return {ok:false,reason:'unsupported_event'};
 if(event==='pull_request'&&typeof draft!=='boolean')return {ok:false,reason:'draft_state_unrun'};
 if(event==='pull_request'&&draft){
  if(fast!=='success')return {ok:false,reason:statusReason('fast',fast)};
  return {ok:false,reason:'draft_deferred'};
 }
 if(fast!=='success'&&fast!=='skipped')return {ok:false,reason:statusReason('fast',fast)};
 const checks=full?.checks;
 if(checks!==successful)return {ok:false,reason:statusReason('full_checks',checks)};
 const dynamics=full?.dynamics;
 if(dynamics!==successful)return {ok:false,reason:statusReason('dynamics',dynamics)};
 return {ok:true,reason:'required_checks_succeeded'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const result=requiredResult({
  event:process.env.GITHUB_EVENT_NAME,
  draft:process.env.GITHUB_EVENT_NAME==='pull_request'?process.env.DRAFT==='true':false,
  fast:process.env.FAST_RESULT,
  full:{checks:process.env.FULL_CHECKS_RESULT,dynamics:process.env.FULL_DYNAMICS_RESULT},
 });
 console.log(JSON.stringify(result));
 if(!result.ok)process.exitCode=1;
}
