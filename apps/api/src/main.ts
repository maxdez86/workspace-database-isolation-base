import { createPool } from "@ticketry/db";

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool({
    connectionString: config.appDatabaseUrl,
    max: config.poolMax,
    applicationName: "ticketry-api"
  });
  const app = buildApp({ pool, logger: { level: config.logLevel } });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
