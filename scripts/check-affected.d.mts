export declare const repositoryRoot: string;
export declare const GIT_EXECUTABLE: string | undefined;

export declare function parseArgs(
  argv: string[],
): { base: string; head?: string; run: boolean };

export type GitResult = { status: number | null; stdout: Buffer; stderr: Buffer };

export declare class GitContext {
  constructor(root: string, env: Record<string, string>);
  root: string;
  env: Record<string, string>;
  gitDir: string;
  commonDir: string;
  run(args: string[], options?: { allowFailure?: boolean }): GitResult;
}

export declare function objectFormatOf(context: GitContext): 'sha1' | 'sha256';
export declare function resolveVitestTargets(
  context: GitContext,
  root: string,
  selection: import('./lib/affected-checks.mjs').Selection,
): { tests: string[]; uncertain: boolean };
export declare const runIdFor: (clock: Date) => string;
export type CheckCommand = { checkId: string; command: string; args: string[]; cwd: string };

export declare function checkCommands(
  checkId: string,
  options: { root: string; runRoot: string; vitestTargets?: string[] },
): CheckCommand[];
export declare function checkCommand(
  checkId: string,
  options: { root: string; runRoot: string; vitestTargets?: string[] },
): CheckCommand | undefined;
export declare function executeChecks(
  checkIds: readonly string[],
  options: { root: string; runRoot: string; vitestTargets?: string[] },
): Array<{
  checkId: string;
  selected: boolean;
  outcome: string;
  argv: string[] | null;
  cwd: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  exitCode: number | null;
  signal: string | null;
  runnerError: string | null;
}>;
export declare function main(
  argv?: string[],
  options?: { root?: string },
): number;
