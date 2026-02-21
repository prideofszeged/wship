import type { HandoffValidation, PlanDraft, RetrievedContext } from "../types/plan.js";

export function validateHandoffPrompt(draft: PlanDraft, ctx: RetrievedContext): HandoffValidation {
  const reasons: string[] = [];

  if (draft.handoffPrompt.trim().length < 120) {
    reasons.push("Handoff prompt is too short for reliable execution context.");
  }

  const referencesAnyFile = ctx.candidateFiles.some((f) => draft.handoffPrompt.includes(f));
  if (!referencesAnyFile) {
    reasons.push("Handoff prompt does not reference candidate files from retrieval context.");
  }

  if (!/test/i.test(draft.handoffPrompt)) {
    reasons.push("Handoff prompt does not explicitly require running tests.");
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}
