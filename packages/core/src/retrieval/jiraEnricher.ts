import { request } from "node:https";

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export interface JiraIssueData {
  summary: string;
  description: string;
  labels: string[];
  status: string;
}

function extractAdfText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as Record<string, unknown>;
  if (n["type"] === "text" && typeof n["text"] === "string") return n["text"] as string;
  if (Array.isArray(n["content"])) {
    return (n["content"] as unknown[])
      .map(extractAdfText)
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

export async function fetchJiraIssue(config: JiraConfig, issueKey: string): Promise<JiraIssueData | null> {
  const base = config.baseUrl.replace(/\/$/, "");
  const path = `/rest/api/3/issue/${encodeURIComponent(issueKey)}`;
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  const url = new URL(base + path);

  return new Promise((resolve) => {
    const req = request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            resolve(null);
            return;
          }
          try {
            const j = JSON.parse(body) as Record<string, unknown>;
            const fields = j["fields"] as Record<string, unknown>;
            const summary = typeof fields["summary"] === "string" ? fields["summary"] : issueKey;
            const description = extractAdfText(fields["description"]);
            const labels = Array.isArray(fields["labels"])
              ? (fields["labels"] as unknown[]).filter((l): l is string => typeof l === "string")
              : [];
            const statusName = (fields["status"] as Record<string, unknown> | undefined)?.["name"];
            const status = typeof statusName === "string" ? statusName : "";
            resolve({ summary, description, labels, status });
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.end();
  });
}
