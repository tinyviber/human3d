export type GateStatus = string | null | undefined;

export declare function requiredResult(input: {
  event: string | undefined;
  draft: boolean | undefined;
  fast: GateStatus;
  full?: {
    checks?: GateStatus;
    dynamics?: GateStatus;
  };
}): { ok: boolean; reason: string };
