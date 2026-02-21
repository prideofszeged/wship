import type { PlanDraft, PlanJobPayload, RetrievedContext } from "../types/plan.js";

export function plannerStage(payload: PlanJobPayload, ctx: RetrievedContext): PlanDraft {
  const targetFiles = ctx.candidateFiles.slice(0, 10);
  const files = targetFiles.map((f) => `- ${f}`).join("\n");
  const symbols = ctx.symbolMentions.length > 0 ? ctx.symbolMentions.join(", ") : "No direct symbol mentions detected.";

  return {
    summary: `Implement issue #${payload.issueNumber} for ${payload.repoFullName} using a phased, test-first change plan aligned with existing patterns.`,
    research: [
      "Key candidate files:",
      files || "- No direct file mentions found; retrieval fallback applied.",
      "", 
      `Symbols referenced: ${symbols}`,
      ctx.historicalHints.length > 0 ? `Historical hints: ${ctx.historicalHints.join(" ")}` : "Historical hints: none",
    ].join("\n"),
    designChoices: [
      "- Prioritize incremental changes over broad refactors.",
      "- Preserve public interfaces where possible.",
      "- Ensure each phase has deterministic validation.",
    ].join("\n"),
    phases: [
      "1. Confirm current behavior and failure mode.",
      "2. Implement core change in identified modules.",
      "3. Add/adjust tests and run validation.",
      "4. Document rollout and rollback steps.",
    ].join("\n"),
    tasks: [
      "- Update core implementation files referenced above.",
      "- Add regression tests covering expected and edge behaviors.",
      "- Verify no breaking behavior for adjacent flows.",
      "- Prepare concise PR summary with risks and mitigations.",
    ].join("\n"),
    risks: [
      "- Hidden dependency changes across shared modules.",
      "- Incomplete test coverage for edge cases.",
      "- Runtime regressions from behavior changes.",
    ].join("\n"),
    testing: [
      "- Unit tests for changed logic paths.",
      "- Integration tests for API/workflow boundaries.",
      "- Regression checks against issue acceptance criteria.",
    ].join("\n"),
    handoffPrompt: [
      "You are implementing a pre-approved issue plan.",
      `Provider: ${payload.provider}`,
      `Work item: ${payload.workItemId}`,
      `Repo: ${payload.repoFullName}`,
      `Issue: #${payload.issueNumber} - ${payload.issueTitle}`,
      "Target files:",
      ...targetFiles.map((f) => `- ${f}`),
      "Read and modify only files listed in the Research section unless necessary.",
      "If you must expand scope, explain why before coding.",
      "Write tests first for current failing behavior, then implement fix, then rerun tests.",
      "Return: change summary, tests run, risks, and rollback notes.",
    ].join("\n"),
  };
}
