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
