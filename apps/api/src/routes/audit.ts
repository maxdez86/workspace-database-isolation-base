import type { FastifyInstance } from "fastify";

import { listAudit } from "@ticketry/core";
import type { Pool } from "@ticketry/db";

import { pageFromQuery } from "../lib/http.js";

export function registerAuditRoutes(app: FastifyInstance, pool: Pool): void {
  app.get("/audit", async (request) => {
    const page = pageFromQuery(request.query as Record<string, unknown>);
    return { entries: await listAudit(pool, request.principal.tenantId, page), limit: page.limit, offset: page.offset };
  });
}
