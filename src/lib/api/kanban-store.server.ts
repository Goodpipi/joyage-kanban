import fs from "node:fs/promises";
import path from "node:path";

import { KANBAN_SEED } from "@/lib/kanban-seed";
import type { Task } from "@/lib/kanban-types";

export interface KanbanSnapshot {
  tasks: Task[];
  updatedAt: string;
}

const DATA_FILE = path.join(
  process.env.DATA_DIR || path.join(process.cwd(), ".data"),
  "kanban.json",
);

let memorySnapshot: KanbanSnapshot | null = null;

function isNewer(a: string, b: string): boolean {
  return a > b;
}

async function readFromFile(): Promise<KanbanSnapshot | null> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw) as KanbanSnapshot;
    if (!Array.isArray(parsed.tasks) || typeof parsed.updatedAt !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeToFile(snapshot: KanbanSnapshot): Promise<void> {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(snapshot, null, 2), "utf-8");
}

function seedSnapshot(): KanbanSnapshot {
  return { tasks: KANBAN_SEED, updatedAt: new Date().toISOString() };
}

function mergeSnapshots(a: KanbanSnapshot | null, b: KanbanSnapshot | null): KanbanSnapshot | null {
  if (!a) return b;
  if (!b) return a;
  return isNewer(a.updatedAt, b.updatedAt) ? a : b;
}

async function persistSnapshot(snapshot: KanbanSnapshot): Promise<void> {
  memorySnapshot = snapshot;
  await writeToFile(snapshot);
}

export async function loadKanbanSnapshot(): Promise<KanbanSnapshot> {
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
