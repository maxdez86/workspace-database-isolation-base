import type { Pool, Queryable } from "@ticketry/db";
import { withTransaction } from "@ticketry/db";

import type { Comment } from "../domain/types.js";
import { recordAudit } from "./audit.js";
import { COMMENT_COLUMNS, commentFromRow } from "./rows.js";
import type { CommentRow } from "./rows.js";
import { getTicket, getTicketById } from "./tickets.js";

export interface CreateCommentInput {
  body: string;
  isInternal: boolean;
  now?: Date;
}

export async function listComments(db: Queryable, tenantId: string, ticketId: string): Promise<Comment[]> {
  await getTicket(db, tenantId, ticketId);
  const result = await db.query<CommentRow>(
    `SELECT ${COMMENT_COLUMNS} FROM comments WHERE ticket_id = $1 ORDER BY created_at ASC, id ASC`,
    [ticketId]
  );
  return result.rows.map(commentFromRow);
}

export async function createComment(
  pool: Pool,
  authorId: string,
  ticketId: string,
  input: CreateCommentInput
): Promise<Comment> {
  const now = input.now ?? new Date();
  return withTransaction(pool, async (client) => {
    const ticket = await getTicketById(client, ticketId);
    const inserted = await client.query<CommentRow>(
      `INSERT INTO comments (tenant_id, ticket_id, author_id, body, is_internal, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COMMENT_COLUMNS}`,
      [ticket.tenantId, ticket.id, authorId, input.body, input.isInternal, now]
    );
    await client.query("UPDATE tickets SET updated_at = $2 WHERE id = $1", [ticket.id, now]);
    const comment = commentFromRow(inserted.rows[0] as CommentRow);
    await recordAudit(client, {
      tenantId: ticket.tenantId,
      actorId: authorId,
      action: "comment.created",
      targetType: "ticket",
      targetId: ticket.id,
      metadata: { commentId: comment.id, isInternal: comment.isInternal }
    });
    return comment;
  });
}
