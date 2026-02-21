import type { PlanJobType } from "../types/plan.js";
import type { IntegrationProvider } from "../types/integration.js";
import { sha256 } from "./hash.js";

export function buildIdempotencyKey(args: {
  provider: IntegrationProvider;
  repoFullName: string;
  issueNumber: number;
  type: PlanJobType;
  commandRaw: string;
  mode: "quick" | "full";
}): string {
  return sha256(
    [
      args.provider,
      args.repoFullName,
      String(args.issueNumber),
      args.type,
      args.commandRaw,
      args.mode,
    ].join("|"),
  );
}
