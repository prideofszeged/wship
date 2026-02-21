import type { PlanJobPayload, PlanPipelineOptions, PlanPipelineResult } from "../types/plan.js";
import { buildRetrievedContext } from "../retrieval/contextBuilder.js";
import { plannerStage } from "./planner.js";
import { criticStage } from "./critic.js";
import { scorePlan } from "./scorer.js";
import { validateHandoffPrompt } from "./handoffValidator.js";
import { finalizePlan } from "./finalizer.js";

const QUALITY_THRESHOLD = 70;

export async function runPlanPipeline(payload: PlanJobPayload, options?: PlanPipelineOptions): Promise<PlanPipelineResult> {
  const startedAt = Date.now();

  const retrievalStart = Date.now();
  const retrieved = buildRetrievedContext(payload);
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
