import type { ParsedPlanCommand } from "../types/plan.js";

export type HeaderMap = Record<string, string | undefined>;

export function normalizeHeaders(headers: Record<string, string | string[] | undefined>): HeaderMap {
  const out: HeaderMap = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return out;
}

export function safeString(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (input == null) {
    return "";
  }
  return JSON.stringify(input);
}

export function parseRepoHint(labels: string[], textSources: string[]): string | undefined {
  for (const label of labels) {
    const match = label.match(/^repo:(.+\/.+)$/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  for (const text of textSources) {
    const match = text.match(/repository:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

export function parseNumericIssueNumber(id: string): number {
  const direct = Number(id);
  if (Number.isInteger(direct) && direct > 0) {
    return direct;
  }

  const hashMatch = id.match(/(\d+)$/);
  if (hashMatch?.[1]) {
    const parsed = Number(hashMatch[1]);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  let sum = 0;
  for (const ch of id) {
    sum += ch.charCodeAt(0);
  }
  return Math.max(1, sum);
}

export interface ParsedCommandResult {
  ok: boolean;
  command?: ParsedPlanCommand;
}

