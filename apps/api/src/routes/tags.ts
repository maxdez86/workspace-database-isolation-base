import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { listTags, listTicketTags, tagTicket, untagTicket } from "@ticketry/core";
import type { Pool } from "@ticketry/db";

import { paramId, parseBody } from "../lib/http.js";
import { requireWrite } from "../plugins/auth.js";

const tagSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be a lowercase slug")
});

export function registerTagRoutes(app: FastifyInstance, pool: Pool): void {
  app.get("/tags", async (request) => {
    return { tags: await listTags(pool, request.principal.tenantId) };
  });

  app.get("/tickets/:id/tags", async (request) => {
    return { tags: await listTicketTags(pool, request.principal.tenantId, paramId(request, "id")) };
  });

  app.post("/tickets/:id/tags", async (request, reply) => {
    requireWrite(request.principal);
    const input = parseBody(tagSchema, request.body);
    const tag = await tagTicket(pool, request.principal.tenantId, paramId(request, "id"), input.name);
    return reply.status(201).send({ tag });
  });

  app.delete("/tickets/:id/tags/:name", async (request, reply) => {
    requireWrite(request.principal);
    const { name } = request.params as { name: string };
    await untagTicket(pool, request.principal.tenantId, paramId(request, "id"), name);
    return reply.status(204).send();
  });
}
