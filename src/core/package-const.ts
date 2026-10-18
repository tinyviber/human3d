/** Pose-package wire constants shared by the service, the validator and the
 * browser decoder. This module is deliberately pure — no imports — so the
 * constants can reach the lab bundle without dragging the server's node
 * chain (node:crypto via rig-manifest) along. */
export const POSE_PACKAGE_KIND='pose-package';
export const POSE_PACKAGE_SCHEMA_VERSION=2;
