import { recordAudit } from "@ticketry/core";
import type { Pool } from "@ticketry/db";
import { withTransaction } from "@ticketry/db";

export interface SlaSweepResult {
  breached: number;
}

interface BreachedRow {
  id: string;
  tenant_id: string;
  number: number;
}

/**
 * Flag every active ticket whose SLA due time has passed. Idempotent: a
 * ticket is flagged once, and re-running the sweep finds nothing new.
 */
export async function runSlaSweep(pool: Pool, now: Date = new Date()): Promise<SlaSweepResult> {
  return withTransaction(pool, async (client) => {
    const result = await client.query<BreachedRow>(
      `UPDATE tickets
       SET sla_breached = true, updated_at = $1
       WHERE sla_due_at IS NOT NULL
         AND sla_due_at < $1
         AND status IN ('open', 'pending')
         AND sla_breached = false
       RETURNING id, tenant_id, number`,
      [now]
    );
    for (const row of result.rows) {
      await recordAudit(client, {
        tenantId: row.tenant_id,
        actorId: null,
        action: "ticket.sla_breached",
        targetType: "ticket",
        targetId: row.id,
        metadata: { number: row.number }
      });
    }
    return { breached: result.rows.length };
  });
}
