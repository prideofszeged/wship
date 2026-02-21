import path from "node:path";

export interface WorkerConfig {
  queueDir: string;
  pollMs: number;
}

export function loadConfig(): WorkerConfig {
  return {
    queueDir: process.env.QUEUE_DIR ?? path.resolve(process.cwd(), "data/queue"),
    pollMs: Number(process.env.WORKER_POLL_MS ?? 1500),
  };
}
