import { enqueueNotification, listActiveMemberUserIds, listMemberships } from "@ticketry/core";
import type { Pool } from "@ticketry/db";

export interface DigestResult {
  usersProcessed: number;
  notificationsQueued: number;
}

interface AssignedRow {
  id: string;
  number: number;
  subject: string;
  priority: string;
  sla_due_at: Date | null;
  sla_breached: boolean;
}

/**
 * Queue one "what is on my plate" digest per active workspace membership,
 * listing the user's open and pending assignments ordered by SLA urgency.
 */
export async function runDigest(pool: Pool, now: Date = new Date()): Promise<DigestResult> {
  const userIds = await listActiveMemberUserIds(pool);
  let notificationsQueued = 0;
  for (const userId of userIds) {
    const assigned = await pool.query<AssignedRow>(
      `SELECT id, number, subject, priority, sla_due_at, sla_breached
       FROM tickets
       WHERE assignee_id = $1 AND status IN ('open', 'pending')
       ORDER BY sla_breached DESC, sla_due_at ASC NULLS LAST, number ASC`,
      [userId]
    );
    if (assigned.rows.length === 0) {
      continue;
    }
    const memberships = (await listMemberships(pool, userId)).filter((m) => !m.revokedAt);
    for (const membership of memberships) {
      await enqueueNotification(pool, {
        tenantId: membership.tenantId,
        userId,
        kind: "daily_digest",
        payload: {
          generatedAt: now.toISOString(),
          tickets: assigned.rows.map((row) => ({
            id: row.id,
            number: row.number,
            subject: row.subject,
            priority: row.priority,
            slaDueAt: row.sla_due_at,
            slaBreached: row.sla_breached
          }))
        }
      });
      notificationsQueued += 1;
    }
  }
  return { usersProcessed: userIds.length, notificationsQueued };
}
