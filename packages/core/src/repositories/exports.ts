import type { Pool, Queryable } from "@ticketry/db";
import { withTransaction } from "@ticketry/db";

import type { ExportJob, Page } from "../domain/types.js";
import { toCsv } from "../lib/csv.js";
import { NotFoundError } from "../lib/errors.js";
import { recordAudit } from "./audit.js";
import { EXPORT_JOB_COLUMNS, exportJobFromRow } from "./rows.js";
import type { ExportJobRow } from "./rows.js";
import { listTickets } from "./tickets.js";
import { findSavedView, getSavedView } from "./views.js";

export const EXPORT_PAGE_SIZE = 500;

export async function enqueueExport(
  db: Queryable,
  tenantId: string,
  requestedBy: string,
  viewId: string | null
): Promise<ExportJob> {
  if (viewId) {
    const view = await findSavedView(db, tenantId, viewId);
    if (!view) {
      throw new NotFoundError("view", viewId);
    }
  }
  const result = await db.query<ExportJobRow>(
    `INSERT INTO export_jobs (tenant_id, requested_by, view_id)
     VALUES ($1, $2, $3)
     RETURNING ${EXPORT_JOB_COLUMNS}`,
    [tenantId, requestedBy, viewId]
  );
  return exportJobFromRow(result.rows[0] as ExportJobRow);
}

/** Export jobs are addressed by their id; the row itself records the workspace it belongs to. */
export async function getExportJob(db: Queryable, jobId: string): Promise<ExportJob> {
  const result = await db.query<ExportJobRow>(
    `SELECT ${EXPORT_JOB_COLUMNS} FROM export_jobs WHERE id = $1`,
    [jobId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new NotFoundError("export", jobId);
  }
  return exportJobFromRow(row);
}

export async function listExportJobs(db: Queryable, tenantId: string, page: Page): Promise<ExportJob[]> {
  const result = await db.query<ExportJobRow>(
    `SELECT ${EXPORT_JOB_COLUMNS} FROM export_jobs
     WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [tenantId, page.limit, page.offset]
  );
  return result.rows.map(exportJobFromRow);
}

/**
 * Claim the oldest queued job, build its CSV, and mark it done or failed.
 * Returns null when the queue is empty. Two workers never process the same
 * job: the claim uses SKIP LOCKED under a row lock.
 */
export async function processNextExport(pool: Pool, now: Date = new Date()): Promise<ExportJob | null> {
  const claimed = await withTransaction(pool, async (client) => {
    const result = await client.query<ExportJobRow>(
      `UPDATE export_jobs SET status = 'running', started_at = $1
       WHERE id = (
         SELECT id FROM export_jobs WHERE status = 'queued'
         ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       RETURNING ${EXPORT_JOB_COLUMNS}`,
      [now]
    );
    const row = result.rows[0];
    return row ? exportJobFromRow(row) : null;
  });
  if (!claimed) {
    return null;
  }

  try {
    const filters = claimed.viewId ? (await getSavedView(pool, claimed.viewId)).filters : {};
    const rows: (string | number | boolean | Date | null)[][] = [];
    for (let offset = 0; ; offset += EXPORT_PAGE_SIZE) {
      const batch = await listTickets(pool, claimed.tenantId, filters, { limit: EXPORT_PAGE_SIZE, offset });
      for (const ticket of batch) {
        rows.push([
          ticket.number,
          ticket.subject,
          ticket.status,
          ticket.priority,
          ticket.assigneeId,
          ticket.slaDueAt,
          ticket.slaBreached,
          ticket.createdAt
        ]);
      }
      if (batch.length < EXPORT_PAGE_SIZE) {
        break;
      }
    }
    const csv = toCsv(
      ["number", "subject", "status", "priority", "assignee_id", "sla_due_at", "sla_breached", "created_at"],
      rows
    );
    return withTransaction(pool, async (client) => {
      const result = await client.query<ExportJobRow>(
        `UPDATE export_jobs SET status = 'done', csv = $2, row_count = $3, finished_at = $4
         WHERE id = $1 RETURNING ${EXPORT_JOB_COLUMNS}`,
        [claimed.id, csv, rows.length, now]
      );
      await recordAudit(client, {
        tenantId: claimed.tenantId,
        actorId: null,
        action: "export.completed",
        targetType: "export",
        targetId: claimed.id,
        metadata: { rowCount: rows.length }
      });
      return exportJobFromRow(result.rows[0] as ExportJobRow);
    });
  } catch (error) {
    const result = await pool.query<ExportJobRow>(
      `UPDATE export_jobs SET status = 'failed', error = $2, finished_at = $3
       WHERE id = $1 RETURNING ${EXPORT_JOB_COLUMNS}`,
      [claimed.id, error instanceof Error ? error.message : String(error), now]
    );
    return exportJobFromRow(result.rows[0] as ExportJobRow);
  }
}
