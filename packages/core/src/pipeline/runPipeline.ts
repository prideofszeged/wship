import type { PlanJobPayload, PlanPipelineResult } from "../types/plan.js";
import { buildRetrievedContext } from "../retrieval/contextBuilder.js";
import { plannerStage } from "./planner.js";
import { criticStage } from "./critic.js";
import { scorePlan } from "./scorer.js";
import { validateHandoffPrompt } from "./handoffValidator.js";
import { finalizePlan } from "./finalizer.js";

const QUALITY_THRESHOLD = 70;

export function runPlanPipeline(payload: PlanJobPayload): PlanPipelineResult {
  const startedAt = Date.now();

  const retrievalStart = Date.now();
  const retrieved = buildRetrievedContext(payload);
  const retrievalMs = Date.now() - retrievalStart;

  const plannerStart = Date.now();
  const draft = plannerStage(payload, retrieved);
  const plannerMs = Date.now() - plannerStart;

  const criticStart = Date.now();
  const critic = criticStage(payload, retrieved, draft);
  const criticMs = Date.now() - criticStart;

  const scoringStart = Date.now();
  const score = scorePlan(critic.revisedDraft, retrieved);
  const handoff = validateHandoffPrompt(critic.revisedDraft, retrieved);
  const scoringMs = Date.now() - scoringStart;

  const finalizerStart = Date.now();
  const finalized = finalizePlan({
    draft: critic.revisedDraft,
    critic,
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
    criticNotes: critic.notes,
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
