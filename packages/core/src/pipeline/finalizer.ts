import type { CriticOutput, HandoffValidation, PlanDraft, ScoreBreakdown } from "../types/plan.js";

interface FinalizerInput {
  draft: PlanDraft;
  critic: CriticOutput;
  score: ScoreBreakdown;
  handoff: HandoffValidation;
  threshold: number;
}

function section(title: string, content: string): string {
  return `## ${title}\n\n${content.trim()}`;
}

export function finalizePlan(input: FinalizerInput): { status: "ready" | "needs_revision"; markdown: string } {
  const { draft, critic, score, handoff, threshold } = input;

  if (score.total < threshold || !handoff.passed) {
    const reasons = [
      score.total < threshold ? `Score ${score.total} is below threshold ${threshold}.` : "",
      ...handoff.reasons,
    ]
      .filter(Boolean)
      .map((r) => `- ${r}`)
      .join("\n");

    return {
      status: "needs_revision",
      markdown: [
        "# Plan Generation Needs Revision",
        "",
        `Quality score: **${score.total}/100**`,
        "",
        "## Blocking Reasons",
        reasons || "- Unknown reason",
        "",
        "## Critic Notes",
        ...(critic.notes.length > 0 ? critic.notes.map((n) => `- ${n}`) : ["- None"]),
      ].join("\n"),
    };
  }

  const markdown = [
    "# Issue Plan",
    "",
    `Quality score: **${score.total}/100**`,
    "",
    section("Problem Summary", draft.summary),
    "",
    section("Current State Findings", draft.research),
    "",
    section("Assumptions and Open Questions", "- Confirm hidden dependencies during implementation.\n- Validate acceptance criteria with issue owner."),
    "",
    section("Implementation Strategy", draft.designChoices),
    "",
    section("Phased Task Breakdown", `${draft.phases}\n\n${draft.tasks}`),
    "",
    section("Risk and Mitigations", draft.risks),
    "",
    section("Testing and Validation Plan", draft.testing),
    "",
    section("Agent Handoff Prompt", draft.handoffPrompt),
    "",
    "## Critic Notes",
    ...(critic.notes.length > 0 ? critic.notes.map((n) => `- ${n}`) : ["- None"]),
  ].join("\n");

  return {
    status: "ready",
    markdown,
  };
}
