import { createHmac, randomUUID } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import {
  FileJobQueue,
  buildIdempotencyKey,
  logError,
  logInfo,
  parseIntegrationWebhook,
  type InboundPlanRequest,
  type IntegrationProvider,
  type PlanJobPayload,
  type QueueJob,
} from "@issue-planner/core";
import { loadConfig } from "./config.js";
import { parseSlackPlanRequest, slackEphemeral, verifySlackSignature, type SlackRequestMeta } from "./slack.js";

function getHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const raw = headers[name.toLowerCase()];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return raw;
}

function verifyGitHubSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const computed = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(computed);
  const b = Buffer.from(signature);
  if (a.length !== b.length) {
    return false;
  }
  return Buffer.compare(a, b) === 0;
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function respond(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

function getPathname(urlValue: string): string {
  try {
    return new URL(urlValue, "http://localhost").pathname;
  } catch {
    return urlValue;
  }
}

function resolveProviderFromPath(urlPath: string): IntegrationProvider | null {
  if (urlPath === "/webhooks/github") {
    return "github";
  }
  if (urlPath === "/webhooks/jira") {
    return "jira";
  }
  if (urlPath === "/webhooks/linear") {
    return "linear";
  }
  if (urlPath === "/webhooks/gitlab") {
    return "gitlab";
  }
  return null;
}

function verifyProviderAuth(args: {
  provider: IntegrationProvider;
  headers: IncomingHttpHeaders;
  rawBody: Buffer;
  config: ReturnType<typeof loadConfig>;
}): { ok: boolean; reason?: string } {
  const { provider, headers, rawBody, config } = args;

  if (provider === "github") {
    if (!config.githubWebhookSecret) {
      return { ok: true };
    }
    const signature = getHeader(headers, "x-hub-signature-256");
    if (!signature || !verifyGitHubSignature(rawBody, signature, config.githubWebhookSecret)) {
      return { ok: false, reason: "invalid_github_signature" };
    }
    return { ok: true };
  }

  if (provider === "gitlab" && config.gitlabWebhookToken) {
    const token = getHeader(headers, "x-gitlab-token");
    return token === config.gitlabWebhookToken ? { ok: true } : { ok: false, reason: "invalid_gitlab_token" };
  }

  if (provider === "jira" && config.jiraWebhookToken) {
    const token = getHeader(headers, "x-jira-token") ?? getHeader(headers, "x-webhook-token");
    return token === config.jiraWebhookToken ? { ok: true } : { ok: false, reason: "invalid_jira_token" };
  }

  if (provider === "linear" && config.linearWebhookToken) {
    const token = getHeader(headers, "x-linear-token") ?? getHeader(headers, "x-webhook-token");
    return token === config.linearWebhookToken ? { ok: true } : { ok: false, reason: "invalid_linear_token" };
  }

  return { ok: true };
}

function resolveRepo(args: {
  provider: IntegrationProvider;
  projectKey?: string;
  repoHint?: string;
  repoMap: Record<string, string>;
}): { repoFullName: string; repoResolution: PlanJobPayload["repoResolution"] } {
  if (args.repoHint) {
    return { repoFullName: args.repoHint, repoResolution: "provided" };
  }

  const projectKey = args.projectKey ?? "";
  const providerMapKey = projectKey ? `${args.provider}:${projectKey}` : "";
  const defaultKey = `${args.provider}:default`;
  const mapped = (providerMapKey && args.repoMap[providerMapKey]) || args.repoMap[defaultKey];
  if (mapped) {
    return { repoFullName: mapped, repoResolution: "mapped" };
  }

  return { repoFullName: `unresolved/${args.provider}`, repoResolution: "unresolved" };
}

const config = loadConfig();
const queue = new FileJobQueue<PlanJobPayload>(config.queueDir);
await queue.init();

async function enqueuePlanRequest(args: {
  request: InboundPlanRequest;
  requestOrigin: "webhook" | "slack";
  slackMeta?: SlackRequestMeta;
}): Promise<{ job: QueueJob<PlanJobPayload>; payload: PlanJobPayload }> {
  const { request, requestOrigin, slackMeta } = args;
  const type = request.command.intent === "replan" ? "REPLAN_REQUEST" : "PLAN_REQUEST";
  const issueNumber = request.workItem.numericIssueNumber ?? 1;
  const resolvedRepo = resolveRepo({
    provider: request.provider,
    repoMap: config.repoMap,
    ...(request.workItem.projectKey ? { projectKey: request.workItem.projectKey } : {}),
    ...(request.workItem.repoHint ? { repoHint: request.workItem.repoHint } : {}),
  });

  const idempotencyKey = buildIdempotencyKey({
    provider: request.provider,
    repoFullName: resolvedRepo.repoFullName,
    issueNumber,
    type,
    commandRaw: request.command.raw,
    mode: request.command.mode,
  });

  const payload: PlanJobPayload = {
    provider: request.provider,
    sourceEvent: request.sourceEvent,
    requestOrigin,
    workItemId: request.workItem.id,
    repoFullName: resolvedRepo.repoFullName,
    repoResolution: resolvedRepo.repoResolution,
    issueNumber,
    issueTitle: request.workItem.title,
    issueBody: request.workItem.body,
    issueLabels: request.workItem.labels,
    commentBody: request.comment.body,
    commentAuthor: request.comment.author,
    ...(request.workItem.url ? { workItemUrl: request.workItem.url } : {}),
    ...(request.workItem.projectKey ? { projectKey: request.workItem.projectKey } : {}),
    ...(slackMeta?.responseUrl ? { slackResponseUrl: slackMeta.responseUrl } : {}),
    ...(slackMeta?.channelId ? { slackChannelId: slackMeta.channelId } : {}),
    ...(slackMeta?.userId ? { slackUserId: slackMeta.userId } : {}),
    ...(slackMeta?.teamId ? { slackTeamId: slackMeta.teamId } : {}),
  };

  const job: QueueJob<PlanJobPayload> = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    idempotencyKey,
    type,
    mode: request.command.mode,
    payload,
  };

  await queue.enqueue(job);

  logInfo("job_enqueued", {
    jobId: job.id,
    provider: request.provider,
    source: requestOrigin,
    type: job.type,
    mode: job.mode,
    idempotencyKey: job.idempotencyKey,
    repo: payload.repoFullName,
    issueNumber: payload.issueNumber,
    workItemId: payload.workItemId,
  });

  return { job, payload };
}

const server = createServer(async (req, res) => {
  try {
    const pathname = req.url ? getPathname(req.url) : "";

    if (req.method === "GET" && pathname === "/health") {
      respond(res, 200, { ok: true });
      return;
    }

    if (req.method !== "POST") {
      respond(res, 404, { error: "not_found" });
      return;
    }

    if (pathname === "/webhooks/slack") {
      const rawBody = await readRequestBody(req);
      const auth = verifySlackSignature({
        rawBody,
        headers: req.headers,
        ...(config.slackSigningSecret ? { signingSecret: config.slackSigningSecret } : {}),
      });

      if (!auth.ok) {
        respond(res, 401, { error: auth.reason ?? "invalid_slack_signature" });
        return;
      }

      const parsedSlack = await parseSlackPlanRequest({
        rawBody,
        config,
      });

      if (!parsedSlack.ok) {
        respond(res, parsedSlack.status, slackEphemeral(parsedSlack.message));
        return;
      }

      const { job, payload } = await enqueuePlanRequest({
        request: parsedSlack.request,
        requestOrigin: "slack",
        slackMeta: parsedSlack.meta,
      });

      respond(
        res,
        200,
        slackEphemeral(
          [
            `Queued ${job.type} (${job.mode}) for ${payload.provider}:${payload.workItemId}.`,
            `Job ID: ${job.id}`,
            `Repo: ${payload.repoFullName} (${payload.repoResolution})`,
          ].join("\n"),
        ),
      );
      return;
    }

    if (!req.url) {
      respond(res, 404, { error: "not_found" });
      return;
    }

    const provider = resolveProviderFromPath(pathname);
    if (!provider) {
      respond(res, 404, { error: "not_found" });
      return;
    }

    const rawBody = await readRequestBody(req);
    const auth = verifyProviderAuth({ provider, headers: req.headers, rawBody, config });
    if (!auth.ok) {
      respond(res, 401, { error: auth.reason ?? "unauthorized" });
      return;
    }

    const payload = JSON.parse(rawBody.toString("utf8")) as unknown;
    const eventName = provider === "github" ? getHeader(req.headers, "x-github-event") ?? "" : undefined;
    const parsed = parseIntegrationWebhook({
      provider,
      payload,
      ...(eventName ? { eventName } : {}),
    });

    if (!parsed.accepted) {
      respond(res, 202, { ignored: true, reason: parsed.reason });
      return;
    }

    const result = await enqueuePlanRequest({
      request: parsed.request,
      requestOrigin: "webhook",
    });

    respond(res, 202, {
      accepted: true,
      provider: parsed.request.provider,
      jobId: result.job.id,
      type: result.job.type,
      mode: result.job.mode,
      repoResolution: result.payload.repoResolution,
    });
  } catch (error) {
    logError("webhook_error", {
      error: error instanceof Error ? error.message : String(error),
    });
    respond(res, 500, { error: "internal_error" });
  }
});

server.listen(config.port, () => {
  logInfo("integration_webhook_app_started", {
    port: config.port,
    queueDir: config.queueDir,
    endpoints: ["/webhooks/github", "/webhooks/jira", "/webhooks/slack"],
  });
});
