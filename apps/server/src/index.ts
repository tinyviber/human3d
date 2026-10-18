/** @human3d/server — the loopback Motion Protocol v1 service.
 *
 * One public entry for the service's consumers (the web package's tests, the
 * CLIs under scripts/): the request handler and context factory, the node:crypto
 * identity helpers and the executable contract. The transport itself
 * (`serve.ts`) stays a separate subpath so a test can spawn the real process
 * without importing it. */
export * from './service';
export * from './rig-manifest';
export * from './contract';
export * from './errors';
