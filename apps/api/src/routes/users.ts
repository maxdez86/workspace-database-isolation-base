import type { FastifyInstance } from "fastify";

import { getUser, listMemberships, listTenantMembers } from "@ticketry/core";
import type { Pool } from "@ticketry/db";

import { paramId } from "../lib/http.js";

export function registerUserRoutes(app: FastifyInstance, pool: Pool): void {
  app.get("/me", async (request) => {
    const { principal } = request;
    const memberships = await listMemberships(pool, principal.userId);
    return {
      user: {
        id: principal.userId,
        email: principal.email,
        displayName: principal.displayName,
        isStaff: principal.isStaff
      },
      workspace: { id: principal.tenantId, slug: principal.tenantSlug, role: principal.role },
      memberships: memberships.filter((m) => !m.revokedAt).map((m) => ({ tenantSlug: m.tenantSlug, role: m.role }))
    };
  });

  app.get("/users", async (request) => {
    return { users: await listTenantMembers(pool, request.principal.tenantId) };
  });

  app.get("/users/:id", async (request) => {
    const userId = paramId(request, "id");
    const [user, memberships] = await Promise.all([getUser(pool, userId), listMemberships(pool, userId)]);
    return {
      user,
      memberships: memberships.map((m) => ({ tenantId: m.tenantId, tenantSlug: m.tenantSlug, role: m.role, revokedAt: m.revokedAt }))
    };
  });
}
