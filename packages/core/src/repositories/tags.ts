import type { Pool, Queryable } from "@ticketry/db";
import { withTransaction } from "@ticketry/db";

import type { Tag } from "../domain/types.js";
import { tagFromRow } from "./rows.js";
import type { TagRow } from "./rows.js";
import { getTicket } from "./tickets.js";

export interface TagCount extends Tag {
  ticketCount: number;
}

export async function tagTicket(pool: Pool, tenantId: string, ticketId: string, name: string): Promise<Tag> {
  return withTransaction(pool, async (client) => {
    await getTicket(client, tenantId, ticketId);
    const tag = await client.query<TagRow>(
      `INSERT INTO tags (tenant_id, name) VALUES ($1, $2)
       ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, tenant_id, name`,
      [tenantId, name]
    );
    const row = tag.rows[0] as TagRow;
    await client.query(
      "INSERT INTO ticket_tags (ticket_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [ticketId, row.id]
    );
    return tagFromRow(row);
  });
}

export async function untagTicket(db: Queryable, tenantId: string, ticketId: string, name: string): Promise<void> {
  await getTicket(db, tenantId, ticketId);
  await db.query(
    `DELETE FROM ticket_tags tt USING tags g
     WHERE tt.tag_id = g.id AND tt.ticket_id = $1 AND g.tenant_id = $2 AND g.name = $3`,
    [ticketId, tenantId, name]
  );
}

export async function listTicketTags(db: Queryable, tenantId: string, ticketId: string): Promise<Tag[]> {
  const result = await db.query<TagRow>(
    `SELECT g.id, g.tenant_id, g.name FROM tags g
     JOIN ticket_tags tt ON tt.tag_id = g.id
     WHERE tt.ticket_id = $1 AND g.tenant_id = $2
     ORDER BY g.name`,
    [ticketId, tenantId]
  );
  return result.rows.map(tagFromRow);
}

export async function listTags(db: Queryable, tenantId: string): Promise<TagCount[]> {
  const result = await db.query<TagRow & { ticket_count: string }>(
    `SELECT g.id, g.tenant_id, g.name, count(tt.ticket_id)::text AS ticket_count
     FROM tags g LEFT JOIN ticket_tags tt ON tt.tag_id = g.id
     WHERE g.tenant_id = $1
     GROUP BY g.id
     ORDER BY g.name`,
    [tenantId]
  );
  return result.rows.map((row) => ({ ...tagFromRow(row), ticketCount: Number(row.ticket_count) }));
}
