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

async function persistSnapshot(snapshot: KanbanSnapshot): Promise<void> {
  memorySnapshot = snapshot;
  try {
    await writeToFile(snapshot);
  } catch (error) {
    console.warn("[kanban] failed to persist to file", error);
  }
}

export async function loadKanbanSnapshot(): Promise<KanbanSnapshot> {
  const fromFile = await readFromFile();
  if (fromFile) {
    if (!memorySnapshot || fromFile.updatedAt !== memorySnapshot.updatedAt) {
      memorySnapshot = fromFile;
    }
    return memorySnapshot;
  }

  if (memorySnapshot) return memorySnapshot;

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
  await persistSnapshot(snapshot);
  return snapshot;
}
