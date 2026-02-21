export function logInfo(event: string, meta: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ level: "info", event, ts: new Date().toISOString(), ...meta })}\n`,
  );
}

export function logError(event: string, meta: Record<string, unknown> = {}): void {
  process.stderr.write(
    `${JSON.stringify({ level: "error", event, ts: new Date().toISOString(), ...meta })}\n`,
  );
}
