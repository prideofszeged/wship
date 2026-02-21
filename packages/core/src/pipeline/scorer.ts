import type { PlanDraft, RetrievedContext, ScoreBreakdown } from "../types/plan.js";

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

export function scorePlan(draft: PlanDraft, ctx: RetrievedContext): ScoreBreakdown {
  const sections = [
    draft.summary,
    draft.research,
    draft.designChoices,
    draft.phases,
    draft.tasks,
    draft.risks,
    draft.testing,
    draft.handoffPrompt,
  ];

  const filledSections = sections.filter(nonEmpty).length;
  const completeness = Math.round((filledSections / 8) * 40);

  const specificity = ctx.candidateFiles.length >= 5 ? 20 : Math.round((ctx.candidateFiles.length / 5) * 20);
  const testability = /test/i.test(draft.testing) ? 20 : 5;
  const riskCoverage = /risk|rollback|mitig/i.test(draft.risks) ? 20 : 5;

  const total = completeness + specificity + testability + riskCoverage;

  return {
    completeness,
    specificity,
    testability,
    riskCoverage,
    total,
  };
}
