import {
  FileJobQueue,
  logError,
  logInfo,
  runPlanPipeline,
  type PlanJobPayload,
} from "@issue-planner/core";
import { loadConfig } from "./config.js";
import { postSlackResult } from "./slack.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const config = loadConfig();
const queue = new FileJobQueue<PlanJobPayload>(config.queueDir);
await queue.init();

logInfo("planner_worker_started", {
  queueDir: config.queueDir,
  pollMs: config.pollMs,
});

for (;;) {
  try {
    const claimed = await queue.claimNext();
    if (!claimed) {
      await sleep(config.pollMs);
      continue;
    }

    const startedAt = Date.now();
    const result = runPlanPipeline(claimed.job.payload);

    const completedPayload = {
      status: result.status,
      score: result.score,
      handoff: result.handoff,
      criticNotes: result.criticNotes,
      markdown: result.markdown,
      timingsMs: result.timingsMs,
      runtimeMs: Date.now() - startedAt,
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
    });

    if (claimed.job.payload.slackResponseUrl) {
      try {
        await postSlackResult({
          responseUrl: claimed.job.payload.slackResponseUrl,
          job: claimed.job,
          result,
        });

        logInfo("slack_result_posted", {
          jobId: claimed.id,
          provider: claimed.job.payload.provider,
          workItemId: claimed.job.payload.workItemId,
          score: result.score.total,
          status: result.status,
        });
      } catch (error) {
        logError("slack_result_post_failed", {
          jobId: claimed.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError("worker_loop_error", { error: message });
    await sleep(config.pollMs);
  }
}
