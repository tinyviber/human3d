/** Every error code the service can return. The OpenAPI `Error.code` enum is
 * checked against this list (src/server/contract.test.ts), and the server
 * functions take `ErrorCode`, so a code cannot ship without being documented. */
export const ERROR_CODES=[
 'invalid_request','invalid_json','request_too_large','unsupported_media_type','forbidden',
 'validation_failed','unknown_action','unknown_rig','unsupported_rig','unsupported_output',
 'idempotency_conflict','precondition_failed','motion_rejected','not_found','internal',
] as const;
export type ErrorCode=typeof ERROR_CODES[number];
