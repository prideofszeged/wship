import type { CriticOutput, PlanDraft, PlanJobPayload, RetrievedContext } from "../types/plan.js";

function ensureLine(block: string, required: string): string {
  return block.includes(required) ? block : `${block}\n${required}`;
}

export function criticStage(payload: PlanJobPayload, ctx: RetrievedContext, draft: PlanDraft): CriticOutput {
  const notes: string[] = [];
  let revised = { ...draft };

  if (payload.repoResolution === "unresolved") {
    notes.push("Repository mapping unresolved; validate target repository before execution.");
    revised.designChoices = ensureLine(
      revised.designChoices,
      "- Resolve repository mapping from tracker project before implementation begins.",
    );
  }

  if (ctx.candidateFiles.length < 5) {
    notes.push("Low file specificity: fewer than 5 candidate files in retrieval context.");
    revised.research = ensureLine(revised.research, "- Add targeted discovery for additional impacted files before coding.");
  }

  if (!/integration/i.test(revised.testing)) {
    notes.push("Testing plan missing explicit integration coverage.");
    revised.testing = ensureLine(revised.testing, "- Include at least one integration test for cross-module behavior.");
  }

  if (/migrat|database|schema/i.test(payload.issueBody) && !/rollback/i.test(revised.risks)) {
    notes.push("Issue may require rollback strategy for data changes.");
    revised.risks = ensureLine(revised.risks, "- Rollback: include reversible migration/feature flag fallback.");
  }

  if (!/Do not|must/i.test(revised.handoffPrompt)) {
    notes.push("Handoff prompt lacks hard guardrails.");
    revised.handoffPrompt = ensureLine(revised.handoffPrompt, "Do not introduce unrelated refactors or dependency upgrades.");
  }

  return {
    revisedDraft: revised,
    notes,
  };
}
