import type { ParsedPlanCommand } from "../types/plan.js";

const PLAN_RE = /(?:^|\s)(?:@coderabbitai\s+)?\/??plan(?:\s+--(quick|full))?(?:\s|$)/i;
const REPLAN_RE = /(?:^|\s)(?:@coderabbitai\s+)?\/??replan(?:\s|$)/i;

export function parsePlanCommand(text: string): ParsedPlanCommand | null {
  if (!text) {
    return null;
  }

  const replan = text.match(REPLAN_RE);
  if (replan) {
    return {
      intent: "replan",
      mode: "full",
      raw: replan[0].trim(),
    };
  }

  const plan = text.match(PLAN_RE);
  if (plan) {
    const arg = (plan[1] || "full").toLowerCase();
    const mode = arg === "quick" ? "quick" : "full";
    return {
      intent: "plan",
      mode,
      raw: plan[0].trim(),
    };
  }

  return null;
}
