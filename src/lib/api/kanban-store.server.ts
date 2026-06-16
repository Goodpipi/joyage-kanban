import fs from "node:fs/promises";
import path from "node:path";

import { KANBAN_SEED } from "@/lib/kanban-seed";
import type { Task } from "@/lib/kanban-types";
import {
  isDatabaseStorageEnabled,
  readFromDatabase,
  writeToDatabase,
} from "@/lib/api/kanban-store-pg.server";

export interface KanbanSnapshot {
  tasks: Task[];
  updatedAt: string;
}

export type KanbanStorageMode = "database" | "disk" | "file";

const DATA_FILE = path.join(
  process.env.DATA_DIR || path.join(process.cwd(), ".data"),
  "kanban.json",
);
const BACKUP_FILE = path.join(path.dirname(DATA_FILE), "kanban.backup.json");

let memorySnapshot: KanbanSnapshot | null = null;

function isNewer(a: string, b: string): boolean {
  return a > b;
}

async function readFromFile(): Promise<KanbanSnapshot | null> {
  for (const file of [DATA_FILE, BACKUP_FILE]) {
    try {
      const raw = await fs.readFile(file, "utf-8");
      const parsed = JSON.parse(raw) as KanbanSnapshot;
      if (!Array.isArray(parsed.tasks) || typeof parsed.updatedAt !== "string") continue;
      return parsed;
    } catch {
      // try next file
    }
  }
  return null;
}

async function writeToFile(snapshot: KanbanSnapshot): Promise<void> {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const payload = JSON.stringify(snapshot, null, 2);
  await fs.writeFile(DATA_FILE, payload, "utf-8");
  await fs.writeFile(BACKUP_FILE, payload, "utf-8");
}

function seedSnapshot(): KanbanSnapshot {
  return { tasks: KANBAN_SEED, updatedAt: new Date().toISOString() };
}

function mergeSnapshots(a: KanbanSnapshot | null, b: KanbanSnapshot | null): KanbanSnapshot | null {
  if (!a) return b;
  if (!b) return a;
  return isNewer(a.updatedAt, b.updatedAt) ? a : b;
}

export function getKanbanStorageMode(): KanbanStorageMode {
  if (isDatabaseStorageEnabled()) return "database";
  if (process.env.DATA_DIR) return "disk";
  return "file";
}

export function getKanbanStorageInfoDetails() {
  return {
    mode: getKanbanStorageMode(),
    dataDir: process.env.DATA_DIR ?? null,
    dataFile: DATA_FILE,
    persistent: getKanbanStorageMode() !== "file",
  };
}

async function persistSnapshot(snapshot: KanbanSnapshot): Promise<void> {
  memorySnapshot = snapshot;
  if (isDatabaseStorageEnabled()) {
    await writeToDatabase(snapshot);
  }
  const shouldWriteFile = !isDatabaseStorageEnabled() || !!process.env.DATA_DIR;
  if (shouldWriteFile) {
    await writeToFile(snapshot);
  }
}

async function loadFromFileStorage(): Promise<KanbanSnapshot> {
  const fromFile = await readFromFile();
  const merged = mergeSnapshots(fromFile, memorySnapshot);

  if (merged) {
    memorySnapshot = merged;
    if (fromFile && isNewer(merged.updatedAt, fromFile.updatedAt)) {
      try {
        await writeToFile(merged);
      } catch (error) {
        console.warn("[kanban] failed to sync newer memory snapshot to file", error);
      }
    }
    return merged;
  }

  const seeded = seedSnapshot();
  await persistSnapshot(seeded);
  return seeded;
}

async function loadFromDatabaseStorage(): Promise<KanbanSnapshot> {
  const fromDb = await readFromDatabase();
  if (fromDb) {
    memorySnapshot = fromDb;
    return fromDb;
  }

  const fromFile = await readFromFile();
  if (fromFile) {
    memorySnapshot = fromFile;
    await writeToDatabase(fromFile);
    return fromFile;
  }

  if (memorySnapshot) return memorySnapshot;

  const seeded = seedSnapshot();
  await persistSnapshot(seeded);
  return seeded;
}

export async function loadKanbanSnapshot(): Promise<KanbanSnapshot> {
  if (isDatabaseStorageEnabled()) return await loadFromDatabaseStorage();
  return await loadFromFileStorage();
}

export async function saveKanbanSnapshot(
  tasks: Task[],
  expectedUpdatedAt?: string,
): Promise<KanbanSnapshot | { conflict: true; snapshot: KanbanSnapshot }> {
  const current = await loadKanbanSnapshot();
  if (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt) {
    return { conflict: true, snapshot: current };
  }

  const snapshot: KanbanSnapshot = { tasks, updatedAt: new Date().toISOString() };
  try {
    await persistSnapshot(snapshot);
  } catch (error) {
    console.warn("[kanban] failed to persist snapshot", error);
    throw error;
  }
  return snapshot;
}

export async function importKanbanSnapshot(tasks: Task[]): Promise<KanbanSnapshot> {
  const snapshot: KanbanSnapshot = { tasks, updatedAt: new Date().toISOString() };
  await persistSnapshot(snapshot);
  return snapshot;
}
