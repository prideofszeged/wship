import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { QueueJob } from "../types/plan.js";

export interface ClaimedJob<TPayload> {
  id: string;
  job: QueueJob<TPayload>;
  processingPath: string;
}

interface QueueDirs {
  pending: string;
  processing: string;
  completed: string;
  failed: string;
}

export class FileJobQueue<TPayload> {
  private dirs: QueueDirs;

  constructor(rootDir: string) {
    this.dirs = {
      pending: path.join(rootDir, "pending"),
      processing: path.join(rootDir, "processing"),
      completed: path.join(rootDir, "completed"),
      failed: path.join(rootDir, "failed"),
    };
  }

  async init(): Promise<void> {
    await Promise.all([
      mkdir(this.dirs.pending, { recursive: true }),
      mkdir(this.dirs.processing, { recursive: true }),
      mkdir(this.dirs.completed, { recursive: true }),
      mkdir(this.dirs.failed, { recursive: true }),
    ]);
  }

  async enqueue(job: QueueJob<TPayload>): Promise<void> {
    await this.init();
    const filename = `${Date.now()}-${randomUUID()}.json`;
    const outPath = path.join(this.dirs.pending, filename);
    await writeFile(outPath, JSON.stringify(job, null, 2), "utf8");
  }

  async claimNext(): Promise<ClaimedJob<TPayload> | null> {
    await this.init();
    const entries = (await readdir(this.dirs.pending)).sort();

    for (const entry of entries) {
      const pendingPath = path.join(this.dirs.pending, entry);
      const processingPath = path.join(this.dirs.processing, entry);

      try {
        await rename(pendingPath, processingPath);
      } catch {
        continue;
      }

      const content = await readFile(processingPath, "utf8");
      const job = JSON.parse(content) as QueueJob<TPayload>;
      return {
        id: job.id,
        job,
        processingPath,
      };
    }

    return null;
  }

  async complete(claimed: ClaimedJob<TPayload>, result: unknown): Promise<void> {
    const outPath = path.join(this.dirs.completed, `${path.basename(claimed.processingPath, ".json")}.json`);
    const payload = {
      ...claimed.job,
      completedAt: new Date().toISOString(),
      result,
    };
    await writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
    await rename(claimed.processingPath, `${claimed.processingPath}.done`);
  }

  async fail(claimed: ClaimedJob<TPayload>, errorText: string): Promise<void> {
    const outPath = path.join(this.dirs.failed, `${path.basename(claimed.processingPath, ".json")}.json`);
    const payload = {
      ...claimed.job,
      failedAt: new Date().toISOString(),
      errorText,
    };
    await writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
    await rename(claimed.processingPath, `${claimed.processingPath}.failed`);
  }
}
