import {createHash} from 'node:crypto';
import {canonical,rigManifestBody,type RigJsonFile,type RigManifest} from '../core/protocol';
export const sha256=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
/** Server-side manifest assembly: the shared body plus its own content hash
 * and the source asset's hash. The browser twin lives in
 * src/core/package-export.ts (WebCrypto digest). */
export function buildRigManifest(rig:RigJsonFile,sourceHash:string):RigManifest{
 const body=rigManifestBody(rig);
 return {...body,manifestSHA256:sha256(canonical(body)),sourceSHA256:sourceHash};
}
// Compatibility re-exports — the implementations moved to src/core/protocol.ts.
export {canonical,RIG_ID,rigManifestBody} from '../core/protocol';
export type {RigJsonBone,RigJsonFile,RigManifest} from '../core/protocol';
