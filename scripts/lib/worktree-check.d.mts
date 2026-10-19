export type ValidationResult = { ok: boolean; issues: string[] };

export declare function validateWorktreePath(
  repoRoot: string,
  worktreeRoot: string,
): ValidationResult;

export declare function validateWorkspaceLinks(
  worktreeRoot: string,
  workspaceNames: readonly string[],
): ValidationResult;

export declare function assertPortAvailable(
  host: string,
  port: number,
): Promise<{ host: string; port: number; available: true }>;

export type WebIdentityResult =
  | { ok: true; probe: string; detail?: never }
  | { ok: false; detail: string; probe?: never };

export declare function verifyWebIdentity(
  repoRoot: string,
  webBase: string | URL,
  options?: { fetchImpl?: typeof fetch },
): Promise<WebIdentityResult>;
