import type { FastifyInstance, FastifyRequest } from "fastify";

import { hashApiKey, looksLikeApiKey, recordAudit } from "@ticketry/core";
import type { MembershipRole } from "@ticketry/core";
import type { Pool } from "@ticketry/db";

import { forbidden, unauthorized } from "../lib/http.js";

export interface Principal {
  userId: string;
  email: string;
  displayName: string;
  isStaff: boolean;
  apiKeyId: string;
  tenantId: string;
  tenantSlug: string;
  role: MembershipRole | "staff";
}

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal;
  }
}

export const TENANT_HEADER = "x-ticketry-tenant";

interface KeyRow {
  key_id: string;
  key_tenant_id: string | null;
  key_revoked_at: Date | null;
  user_id: string;
  email: string;
  display_name: string;
  is_staff: boolean;
  disabled_at: Date | null;
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) {
    return null;
  }
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token || !looksLikeApiKey(token)) {
    return null;
  }
  return token;
}

/** Resolve the caller and the workspace the request acts in. */
export async function authenticate(pool: Pool, request: FastifyRequest): Promise<Principal> {
  const token = bearerToken(request);
  if (!token) {
    throw unauthorized();
  }
  const keys = await pool.query<KeyRow>(
    `SELECT k.id AS key_id, k.tenant_id AS key_tenant_id, k.revoked_at AS key_revoked_at,
            u.id AS user_id, u.email, u.display_name, u.is_staff, u.disabled_at
     FROM api_keys k JOIN users u ON u.id = k.user_id
     WHERE k.key_hash = $1`,
    [hashApiKey(token)]
  );
  const key = keys.rows[0];
  if (!key || key.key_revoked_at || key.disabled_at) {
    throw unauthorized();
  }
  await pool.query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [key.key_id]);

  const base = {
    userId: key.user_id,
    email: key.email,
    displayName: key.display_name,
    isStaff: key.is_staff,
    apiKeyId: key.key_id
  };

  if (key.key_tenant_id) {
    const membership = await pool.query<{ role: MembershipRole; slug: string }>(
      `SELECT m.role, t.slug FROM memberships m JOIN tenants t ON t.id = m.tenant_id
       WHERE m.tenant_id = $1 AND m.user_id = $2`,
      [key.key_tenant_id, key.user_id]
    );
    const row = membership.rows[0];
    if (!row) {
      throw forbidden("the key's user is not a member of its workspace");
    }
    return { ...base, tenantId: key.key_tenant_id, tenantSlug: row.slug, role: row.role };
  }

  // Platform staff keys are not bound to a workspace; the caller names one per request.
  if (!key.is_staff) {
    throw forbidden("API key is not bound to a workspace");
  }
  const requested = request.headers[TENANT_HEADER];
  const slug = Array.isArray(requested) ? requested[0] : requested;
  if (!slug) {
    throw forbidden(`staff requests must name a workspace in ${TENANT_HEADER}`);
  }
  const tenant = await pool.query<{ id: string; slug: string }>("SELECT id, slug FROM tenants WHERE slug = $1", [
    slug
  ]);
  const found = tenant.rows[0];
  if (!found) {
    throw forbidden(`unknown workspace: ${slug}`);
  }
  await recordAudit(pool, {
    tenantId: found.id,
    actorId: key.user_id,
    action: "staff.workspace_access",
    targetType: "tenant",
    targetId: found.id,
    metadata: { method: request.method, path: request.url }
  });
  return { ...base, tenantId: found.id, tenantSlug: found.slug, role: "staff" };
}

const WRITE_ROLES: ReadonlySet<Principal["role"]> = new Set(["owner", "agent", "staff"]);

export function canWrite(principal: Principal): boolean {
  return WRITE_ROLES.has(principal.role);
}

export function requireWrite(principal: Principal): void {
  if (!canWrite(principal)) {
    throw forbidden("viewers cannot modify tickets");
  }
}

export function registerAuth(app: FastifyInstance, pool: Pool, publicPaths: ReadonlySet<string>): void {
  app.decorateRequest("principal");
  app.addHook("onRequest", async (request) => {
    const pathname = request.url.split("?")[0] ?? request.url;
    if (publicPaths.has(pathname)) {
      return;
    }
    request.principal = await authenticate(pool, request);
  });
}
