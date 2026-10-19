export type NameStatusRecord = {
  status: string;
  path: Buffer;
  oldPath?: Buffer;
  score?: number;
};

export type PorcelainRecord = {
  kind: string;
  xy?: string;
  sub?: string;
  score?: string;
  path?: Buffer;
  originalPath?: Buffer;
  raw?: Buffer;
};

export type ChangedPathItem = {
  path: string;
  status: string;
  index: number;
  category: string;
  fallbackReason: string | null;
  selectedCheckIds: readonly string[];
};

export type Selection = {
  selectedCheckIds: readonly string[];
  fallbackReasons: readonly string[];
  changedPaths: ChangedPathItem[];
};

export declare const CHECK_IDS: readonly string[];
export declare const FALLBACK_REASONS: readonly string[];
export declare const RECEIPT_SCHEMA_VERSION: 2;
export declare const RECEIPT_AUTHORITY: 'human3d.local-check-runner';
export declare const SNAPSHOT_CONSISTENCY: string;
export declare const SNAPSHOT_CONSISTENCY_PLAN: string;
export declare const GIT_REDIRECT_VARIABLES: readonly string[];
export declare const GIT_CONFIG_PREAMBLE: readonly string[];

export declare class AffectedCheckError extends Error {
  constructor(message: string, kind?: string, options?: ErrorOptions);
  kind: string;
}

export declare function parseNameStatusZ(input: Buffer | Uint8Array): NameStatusRecord[];
export declare function parsePorcelainV2Z(input: Buffer | Uint8Array): PorcelainRecord[];
export declare function classifyChangedPath(
  relativePath: string,
  status?: string,
): Pick<ChangedPathItem, 'category' | 'fallbackReason' | 'selectedCheckIds'>;
export declare function selectAffectedChecks(
  changedPaths: Array<{ path: string; status?: string }>,
  options?: {
    dirty?: boolean;
    hiddenIndex?: boolean;
    mergeBaseUnavailable?: boolean;
    shallow?: boolean;
    graphUncertainty?: boolean;
  },
): Selection;
export declare function collectVitestTargets(input: {
  trackedFiles: readonly string[];
  changedPaths: Array<string | { path?: string }>;
  readFile: (relativePath: string) => string;
  workspacePackages?: Record<string, Record<string, string>>;
}): { tests: string[]; uncertain: boolean };
export declare function createReceipt(input: Record<string, unknown>): Record<string, unknown>;
export declare function serializeReceipt(receipt: Record<string, unknown>): Buffer;
export declare function fingerprintSnapshot(snapshot: {
  headSha: string;
  baseSha: string;
  mergeBaseSha: string | null;
  shallow: boolean;
  dirty: boolean;
  status: Array<{ kind: string; xy?: string; path?: Buffer }>;
  changedPaths: Array<{ status: string; path: Buffer; oldPath?: Buffer; score?: number }>;
}): string;
export declare function sanitizedGitEnv(
  baseEnv?: Record<string, string | undefined>,
  extra?: Record<string, string>,
): Record<string, string>;
export declare function findGitRedirect(env?: Record<string, string | undefined>): string | undefined;
export declare function decodeUtf8Strict(input: Buffer | Uint8Array | string): string | undefined;
export declare function isSafeSha(value: string): boolean;
export declare function extractImportSpecifiers(source: string): string[];
export declare function snapshotFingerprintFromCaptures(
  captures: Array<{ captureId: number; captureSha256: string | null }>,
): string | null;
export declare const CATEGORY_CHECKS: Readonly<Record<string, readonly string[]>>;
export declare const FAILURE_MESSAGES: Readonly<Record<string, string>>;
