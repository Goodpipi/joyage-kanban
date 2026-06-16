import pg from "pg";

import type { KanbanSnapshot } from "@/lib/api/kanban-store.server";

const BOARD_ID = "main";

let pool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

function getDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL;
}

function getPool(): pg.Pool {
  const url = getDatabaseUrl();
  if (!url) throw new Error("DATABASE_URL is not configured");
  if (!pool) {
    const useSsl = !url.includes("localhost") && !url.includes("127.0.0.1");
    pool = new pg.Pool({
      connectionString: url,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = await getPool().connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS kanban_board (
            id TEXT PRIMARY KEY,
            tasks JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
          )
        `);
      } finally {
        client.release();
      }
    })();
  }
  await schemaReady;
}

export function isDatabaseStorageEnabled(): boolean {
  return !!getDatabaseUrl();
}

export async function readFromDatabase(): Promise<KanbanSnapshot | null> {
  if (!isDatabaseStorageEnabled()) return null;
  await ensureSchema();
  const result = await getPool().query(
    "SELECT tasks, updated_at FROM kanban_board WHERE id = $1",
    [BOARD_ID],
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0] as { tasks: KanbanSnapshot["tasks"]; updated_at: Date | string };
  return {
    tasks: row.tasks,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function writeToDatabase(snapshot: KanbanSnapshot): Promise<void> {
  if (!isDatabaseStorageEnabled()) return;
  await ensureSchema();
  await getPool().query(
    `INSERT INTO kanban_board (id, tasks, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE
     SET tasks = EXCLUDED.tasks, updated_at = EXCLUDED.updated_at`,
    [BOARD_ID, JSON.stringify(snapshot.tasks), snapshot.updatedAt],
  );
}
