import pg from "pg";

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;
export type QueryResult<T extends pg.QueryResultRow = pg.QueryResultRow> = pg.QueryResult<T>;

/** Anything that can run a query: a pool, or a checked-out client inside a transaction. */
export type Queryable = Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query">;

export interface PoolOptions {
  connectionString: string;
  /** Maximum number of clients in the pool. Defaults to 10. */
  max?: number;
  applicationName?: string;
}

export function createPool(options: PoolOptions): Pool {
  return new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? "ticketry",
    idleTimeoutMillis: 10_000
  });
}

/**
 * Run `fn` inside a single transaction. Commits when `fn` resolves, rolls back
 * when it throws, and always returns the client to the pool.
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The original error is the one worth reporting.
    }
    throw error;
  } finally {
    client.release();
  }
}
