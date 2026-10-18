export type OutputDirectory = {
  dir: string;
  args: string[];
  updateEvidence: boolean;
};

export declare function canonicalOutputTarget(target: string): string;

export declare function resolveOutputDir(
  scriptKey: string,
  args: readonly string[],
  root: string,
  env?: Readonly<Record<string, string | undefined>>,
): OutputDirectory;

export declare function assertTrackedWriteAllowed(
  target: string,
  options: { root: string; updateEvidence?: boolean },
): string;

export declare function ensureOutputDir(dir: string, options: { root: string }): string;
