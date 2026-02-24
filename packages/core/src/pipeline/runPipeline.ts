import type { PlanJobPayload, PlanPipelineOptions, PlanPipelineResult } from "../types/plan.js";
import { buildRetrievedContext } from "../retrieval/contextBuilder.js";
import { fetchJiraIssue } from "../retrieval/jiraEnricher.js";
import { fetchGitHubRepoContext } from "../retrieval/githubEnricher.js";
import { plannerStage } from "./planner.js";
import { criticStage } from "./critic.js";
import { scorePlan } from "./scorer.js";
import { validateHandoffPrompt } from "./handoffValidator.js";
import { finalizePlan } from "./finalizer.js";

const QUALITY_THRESHOLD = 70;

export async function runPlanPipeline(payloadArg: PlanJobPayload, options?: PlanPipelineOptions): Promise<PlanPipelineResult> {
  const startedAt = Date.now();
  let payload = payloadArg;

  const retrievalStart = Date.now();
  // Enrich payload from Jira if issueBody is empty and credentials are available
  if (options?.jira && payload.provider === "jira" && !payload.issueBody) {
    const jiraData = await fetchJiraIssue(options.jira, payload.workItemId);
    if (jiraData) {
      payload = {
        ...payload,
        issueTitle: jiraData.summary || payload.issueTitle,
        issueBody: jiraData.description,
        issueLabels: jiraData.labels.length > 0 ? jiraData.labels : payload.issueLabels,
      };
    }
  }
  const github = await fetchGitHubRepoContext(payload.repoFullName, options?.github?.token);
  const retrieved = buildRetrievedContext(payload, github);
  const retrievalMs = Date.now() - retrievalStart;

  const plannerStart = Date.now();
  const planner = await plannerStage({
    payload,
    ctx: retrieved,
    ...(options?.mode ? { mode: options.mode } : {}),
    ...(options?.llm ? { llm: options.llm } : {}),
  });
  const plannerMs = Date.now() - plannerStart;

  const criticStart = Date.now();
  const critic = criticStage(payload, retrieved, planner.draft);
  const criticNotes = [...planner.notes, ...critic.notes];
  const criticMs = Date.now() - criticStart;

  const scoringStart = Date.now();
  const score = scorePlan(critic.revisedDraft, retrieved);
  const handoff = validateHandoffPrompt(critic.revisedDraft, retrieved);
  const scoringMs = Date.now() - scoringStart;

  const finalizerStart = Date.now();
  const finalized = finalizePlan({
    draft: critic.revisedDraft,
    critic: {
      ...critic,
      notes: criticNotes,
    },
    score,
    handoff,
    threshold: QUALITY_THRESHOLD,
  });
  const finalizerMs = Date.now() - finalizerStart;

  return {
    status: finalized.status,
    markdown: finalized.markdown,
    score,
    handoff,
    criticNotes,
    plannerMeta: planner.meta,
    timingsMs: {
      retrieval: retrievalMs,
      planner: plannerMs,
      critic: criticMs,
      scoring: scoringMs,
      finalizer: finalizerMs,
      total: Date.now() - startedAt,
    },
  };
}
