import { processNextExport } from "@ticketry/core";
import type { ExportJob } from "@ticketry/core";
import type { Pool } from "@ticketry/db";

export interface ExportRunResult {
  processed: ExportJob[];
}

/** Drain the export queue, at most `maxJobs` at a time. */
export async function runExports(pool: Pool, maxJobs = 20, now: Date = new Date()): Promise<ExportRunResult> {
  const processed: ExportJob[] = [];
  for (let i = 0; i < maxJobs; i += 1) {
    const job = await processNextExport(pool, now);
    if (!job) {
      break;
    }
    processed.push(job);
  }
  return { processed };
}
