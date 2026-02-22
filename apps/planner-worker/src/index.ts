import {
  FileJobQueue,
  logError,
  logInfo,
  runPlanPipeline,
  type PlanJobPayload,
} from "@issue-planner/core";
import { loadConfig } from "./config.js";
import { postSlackResult } from "./slack.js";
import { postProviderResult } from "./outbound.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const config = loadConfig();
const queue = new FileJobQueue<PlanJobPayload>(config.queueDir);
await queue.init();

logInfo("planner_worker_started", {
  queueDir: config.queueDir,
  pollMs: config.pollMs,
  plannerLlmProvider: config.plannerLlmProvider,
  ...(config.plannerLlmModel ? { plannerLlmModel: config.plannerLlmModel } : {}),
});

for (;;) {
  try {
    const claimed = await queue.claimNext();
    if (!claimed) {
      await sleep(config.pollMs);
      continue;
    }

    const startedAt = Date.now();
    const result = await runPlanPipeline(claimed.job.payload, {
      mode: claimed.job.mode,
      llm: {
        provider: config.plannerLlmProvider,
        ...(config.plannerLlmModel ? { model: config.plannerLlmModel } : {}),
        ...(config.plannerLlmFallback ? { fallback: config.plannerLlmFallback } : {}),
        timeoutMs: config.plannerLlmTimeoutMs,
        timeoutQuickMs: config.plannerLlmTimeoutQuickMs,
        ...(config.plannerCodexBin ? { codexBin: config.plannerCodexBin } : {}),
        ...(config.plannerClaudeBin ? { claudeBin: config.plannerClaudeBin } : {}),
      },
    });
    let slackCallback:
      | { attempted: true; ok: true; status: number; postedAt: string }
      | { attempted: true; ok: false; status?: number; error: string; postedAt: string }
      | { attempted: false }
      | undefined;
    let providerCallback:
      | { attempted: false; reason: string }
      | { attempted: true; ok: true; status: number; provider: "github" | "jira"; postedAt: string }
      | {
          attempted: true;
          ok: false;
          provider: "github" | "jira";
          error: string;
          status?: number;
          postedAt: string;
        }
      | undefined;

    const providerPostResult = await postProviderResult({
      config,
      job: claimed.job,
      result,
    });

    if (!providerPostResult.attempted) {
      providerCallback = providerPostResult;
    } else if (providerPostResult.ok) {
      providerCallback = {
        ...providerPostResult,
        postedAt: new Date().toISOString(),
      };

      logInfo("provider_result_posted", {
        jobId: claimed.id,
        provider: providerPostResult.provider,
        workItemId: claimed.job.payload.workItemId,
        score: result.score.total,
        status: result.status,
        responseStatus: providerPostResult.status,
      });
    } else {
      providerCallback = {
        ...providerPostResult,
        postedAt: new Date().toISOString(),
      };

      logError("provider_result_post_failed", {
        jobId: claimed.id,
        provider: providerPostResult.provider,
        error: providerPostResult.error,
        ...(providerPostResult.status ? { responseStatus: providerPostResult.status } : {}),
      });
    }

    if (claimed.job.payload.slackResponseUrl) {
      const postedAt = new Date().toISOString();
      const postResult = await postSlackResult({
        responseUrl: claimed.job.payload.slackResponseUrl,
        job: claimed.job,
        result,
      });

      if (postResult.ok) {
        slackCallback = {
          attempted: true,
          ok: true,
          status: postResult.status,
          postedAt,
        };

        logInfo("slack_result_posted", {
          jobId: claimed.id,
          provider: claimed.job.payload.provider,
          workItemId: claimed.job.payload.workItemId,
          score: result.score.total,
          status: result.status,
          responseStatus: postResult.status,
        });
      } else {
        slackCallback = {
          attempted: true,
          ok: false,
          postedAt,
          error: postResult.error,
          ...(postResult.status ? { status: postResult.status } : {}),
        };

        logError("slack_result_post_failed", {
          jobId: claimed.id,
          error: postResult.error,
          ...(postResult.status ? { responseStatus: postResult.status } : {}),
        });
      }
    } else {
      slackCallback = { attempted: false };
    }

    const completedPayload = {
      status: result.status,
      score: result.score,
      handoff: result.handoff,
      criticNotes: result.criticNotes,
      markdown: result.markdown,
      timingsMs: result.timingsMs,
      runtimeMs: Date.now() - startedAt,
      ...(slackCallback ? { slackCallback } : {}),
      ...(providerCallback ? { providerCallback } : {}),
    };

    await queue.complete(claimed, completedPayload);

    logInfo("job_completed", {
      jobId: claimed.id,
      provider: claimed.job.payload.provider,
      source: claimed.job.payload.requestOrigin ?? "webhook",
      type: claimed.job.type,
      mode: claimed.job.mode,
      repo: claimed.job.payload.repoFullName,
      issueNumber: claimed.job.payload.issueNumber,
      score: result.score.total,
      status: result.status,
      runtimeMs: Date.now() - startedAt,
      retrievalMs: result.timingsMs.retrieval,
      llmMs: result.timingsMs.planner + result.timingsMs.critic,
      plannerLlmProvider: config.plannerLlmProvider,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError("worker_loop_error", { error: message });
    await sleep(config.pollMs);
  }
}
