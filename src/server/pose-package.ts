import {canonical} from '../core/protocol';
import {sha256} from './rig-manifest';
// The package builder moved to src/core/pose-package.ts (Node-free, so the
// browser bundle can share it); this module keeps the old import surface and
// the one node:crypto dependency — the definition hash.
export * from '../core/pose-package';
/** Sorted-key canonical JSON hash of the fully resolved action definition. */
export const actionDefinitionHash=(payload:unknown)=>sha256(canonical(payload));
