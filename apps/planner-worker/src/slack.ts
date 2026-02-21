import type { PlanJobPayload, PlanPipelineResult, QueueJob } from "@issue-planner/core";

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 18))}\n\n[truncated preview]`;
}

function sanitizeCodeFence(text: string): string {
  return text.replace(/```/g, "'''");
}

function buildSlackText(args: {
  job: QueueJob<PlanJobPayload>;
  result: PlanPipelineResult;
}): string {
  const { job, result } = args;

  const statusText = result.status === "ready" ? "Plan ready" : "Plan needs revision";
  const preview = truncate(sanitizeCodeFence(result.markdown), 2500);

  const lines = [
    `${statusText}: ${job.payload.provider}:${job.payload.workItemId}`,
    `Repo: ${job.payload.repoFullName}`,
    `Mode: ${job.mode}`,
    `Quality: ${result.score.total}/100`,
    job.payload.workItemUrl ? `Work item: ${job.payload.workItemUrl}` : "",
    "",
    "Preview:",
    "```",
    preview,
    "```",
  ].filter(Boolean);

  return lines.join("\n");
}

export async function postSlackResult(args: {
  responseUrl: string;
  job: QueueJob<PlanJobPayload>;
  result: PlanPipelineResult;
}): Promise<void> {
  const response = await fetch(args.responseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      response_type: "ephemeral",
      replace_original: false,
      text: buildSlackText({ job: args.job, result: args.result }),
    }),
  });

  if (!response.ok) {
    throw new Error(`slack_response_url_http_${response.status}`);
  }
}
