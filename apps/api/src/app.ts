import Fastify from "fastify";
import type { FastifyInstance, FastifyServerOptions } from "fastify";

import type { Pool } from "@ticketry/db";

import { HttpError, sendError, toHttpError } from "./lib/http.js";
import { registerAuth } from "./plugins/auth.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerCommentRoutes } from "./routes/comments.js";
import { registerExportRoutes } from "./routes/exports.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerTagRoutes } from "./routes/tags.js";
import { registerTicketRoutes } from "./routes/tickets.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerViewRoutes } from "./routes/views.js";

export interface BuildAppOptions {
  pool: Pool;
  logger?: FastifyServerOptions["logger"];
}

const PUBLIC_PATHS: ReadonlySet<string> = new Set(["/health"]);

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const { pool } = options;

  app.setErrorHandler((error, request, reply) => {
    const mapped = toHttpError(error);
    if (mapped.statusCode >= 500) {
      request.log.error({ err: error }, "unhandled error");
    }
    return sendError(reply, mapped);
  });

  app.setNotFoundHandler((_request, reply) => sendError(reply, new HttpError(404, "not_found", "route not found")));

  app.get("/health", async () => {
    const result = await pool.query<{ version: number }>(
      "SELECT max(version) AS version FROM schema_migrations"
    );
    return { status: "ok", schemaVersion: result.rows[0]?.version ?? 0 };
  });

  registerAuth(app, pool, PUBLIC_PATHS);
  registerUserRoutes(app, pool);
  registerTicketRoutes(app, pool);
  registerCommentRoutes(app, pool);
  registerTagRoutes(app, pool);
  registerSearchRoutes(app, pool);
  registerViewRoutes(app, pool);
  registerExportRoutes(app, pool);
  registerAuditRoutes(app, pool);

  return app;
}
