import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { searchTickets } from "@ticketry/core";
import type { Pool } from "@ticketry/db";

import { pageFromQuery, parseQuery } from "../lib/http.js";

const querySchema = z.object({
  q: z.string().trim().min(2).max(200)
});

export function registerSearchRoutes(app: FastifyInstance, pool: Pool): void {
  app.get("/search", async (request) => {
    const query = request.query as Record<string, unknown>;
    const { q } = parseQuery(querySchema, { q: query.q });
    const page = pageFromQuery(query);
    const hits = await searchTickets(pool, request.principal.tenantId, q, page);
    return { query: q, hits, limit: page.limit, offset: page.offset };
  });
}
