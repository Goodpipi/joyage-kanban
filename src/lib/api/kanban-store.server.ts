import fs from "node:fs/promises";
import path from "node:path";

import { KANBAN_SEED } from "@/lib/kanban-seed";
import { ensureTaskCodes, mergeKanbanTasks, type Task } from "@/lib/kanban-types";
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

export interface DiskSnapshotInfo {
  source: string;
  taskCount: number;
  updatedAt: string;
  bytes: number;
}

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "kanban.json");
const BACKUP_FILE = path.join(DATA_DIR, "kanban.backup.json");
const HISTORY_DIR = path.join(DATA_DIR, "history");

const MAX_HISTORY_FILES = 100;

let memorySnapshot: KanbanSnapshot | null = null;

function isNewer(a: string, b: string): boolean {
  return a > b;
}

function isValidSnapshot(parsed: unknown): parsed is KanbanSnapshot {
  return (
    !!parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as KanbanSnapshot).tasks) &&
    typeof (parsed as KanbanSnapshot).updatedAt === "string"
  );
}

function pickBestSnapshot(snapshots: KanbanSnapshot[]): KanbanSnapshot | null {
  if (snapshots.length === 0) return null;
  return snapshots.reduce((best, cur) => {
    if (cur.tasks.length > best.tasks.length) return cur;
    if (cur.tasks.length < best.tasks.length) return best;
    return isNewer(cur.updatedAt, best.updatedAt) ? cur : best;
  });
}

async function readSnapshotFile(file: string): Promise<KanbanSnapshot | null> {
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidSnapshot(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function listHistoryFiles(): Promise<string[]> {
  try {
    const names = await fs.readdir(HISTORY_DIR);
    return names
      .filter((n) => n.endsWith(".json"))
      .map((n) => path.join(HISTORY_DIR, n))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export async function scanDiskKanbanSnapshots(): Promise<DiskSnapshotInfo[]> {
  const candidates: { source: string; snapshot: KanbanSnapshot; bytes: number }[] = [];

  const fixedFiles = [
    { source: "kanban.json", file: DATA_FILE },
    { source: "kanban.backup.json", file: BACKUP_FILE },
  ];

  for (const { source, file } of fixedFiles) {
    try {
      const raw = await fs.readFile(file, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (isValidSnapshot(parsed)) {
        candidates.push({ source, snapshot: parsed, bytes: Buffer.byteLength(raw, "utf8") });
      }
    } catch {
      // skip
    }
  }

  for (const file of await listHistoryFiles()) {
    try {
      const raw = await fs.readFile(file, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (isValidSnapshot(parsed)) {
        candidates.push({
          source: `history/${path.basename(file)}`,
          snapshot: parsed,
          bytes: Buffer.byteLength(raw, "utf8"),
        });
      }
    } catch {
      // skip
    }
  }

  if (isDatabaseStorageEnabled()) {
    const fromDb = await readFromDatabase();
    if (fromDb) {
      candidates.push({
        source: "database",
        snapshot: fromDb,
        bytes: JSON.stringify(fromDb).length,
      });
    }
  }

  return candidates
    .map(({ source, snapshot, bytes }) => ({
      source,
      taskCount: snapshot.tasks.length,
      updatedAt: snapshot.updatedAt,
      bytes,
    }))
    .sort((a, b) => b.taskCount - a.taskCount || b.updatedAt.localeCompare(a.updatedAt));
}

async function readAllDiskSnapshots(): Promise<KanbanSnapshot[]> {
  const snapshots: KanbanSnapshot[] = [];

  for (const file of [DATA_FILE, BACKUP_FILE, ...(await listHistoryFiles())]) {
    const parsed = await readSnapshotFile(file);
    if (parsed) snapshots.push(parsed);
  }

  if (isDatabaseStorageEnabled()) {
    const fromDb = await readFromDatabase();
    if (fromDb) snapshots.push(fromDb);
  }

  return snapshots;
}

async function readFromFile(): Promise<KanbanSnapshot | null> {
  return pickBestSnapshot(await readAllDiskSnapshots());
}

async function appendHistorySnapshot(snapshot: KanbanSnapshot): Promise<void> {
  if (snapshot.tasks.length === 0) return;
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  const stamp = snapshot.updatedAt.replace(/[:.]/g, "-");
  const file = path.join(HISTORY_DIR, `${stamp}-${snapshot.tasks.length}tasks.json`);
  await fs.writeFile(file, JSON.stringify(snapshot, null, 2), "utf-8");

  const files = await listHistoryFiles();
  if (files.length > MAX_HISTORY_FILES) {
    for (const old of files.slice(MAX_HISTORY_FILES)) {
      await fs.unlink(old).catch(() => {});
    }
  }
}

async function writeToFile(snapshot: KanbanSnapshot): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const currentMain = await readSnapshotFile(DATA_FILE);
  if (currentMain && currentMain.tasks.length > 0) {
    await appendHistorySnapshot(currentMain);
  }

  const payload = JSON.stringify(snapshot, null, 2);
  await fs.writeFile(DATA_FILE, payload, "utf-8");

  if (snapshot.tasks.length > 0) {
    await fs.writeFile(BACKUP_FILE, payload, "utf-8");
    await appendHistorySnapshot(snapshot);
  }
}

function seedSnapshot(): KanbanSnapshot {
  return { tasks: KANBAN_SEED, updatedAt: new Date().toISOString() };
}

function mergeSnapshots(a: KanbanSnapshot | null, b: KanbanSnapshot | null): KanbanSnapshot | null {
  if (!a) return b;
  if (!b) return a;
  return pickBestSnapshot([a, b]);
}

export function getKanbanStorageMode(): KanbanStorageMode {
  if (isDatabaseStorageEnabled()) return "database";
  if (process.env.DATA_DIR) return "disk";
  return "file";
}

async function normalizeSnapshot(snapshot: KanbanSnapshot): Promise<KanbanSnapshot> {
  const { tasks, changed } = ensureTaskCodes(snapshot.tasks);
  if (!changed) return snapshot;
  const migrated: KanbanSnapshot = { tasks, updatedAt: new Date().toISOString() };
  memorySnapshot = migrated;
  try {
    await persistSnapshot(migrated);
  } catch (error) {
    console.warn("[kanban] failed to persist migrated task codes", error);
  }
  return migrated;
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
  const snapshot = isDatabaseStorageEnabled()
    ? await loadFromDatabaseStorage()
    : await loadFromFileStorage();
  return await normalizeSnapshot(snapshot);
}

export async function recoverBestKanbanSnapshot(): Promise<{
  restored: KanbanSnapshot;
  pickedFrom: string;
  scanned: DiskSnapshotInfo[];
}> {
  const scanned = await scanDiskKanbanSnapshots();
  const snapshots = await readAllDiskSnapshots();
  const best = pickBestSnapshot(snapshots);

  if (!best || best.tasks.length === 0) {
    throw new Error("No recoverable kanban snapshot found on disk");
  }

  let pickedFrom = "unknown";
  let bestCount = -1;
  for (const info of scanned) {
    if (info.taskCount > bestCount || (info.taskCount === bestCount && info.updatedAt === best.updatedAt)) {
      bestCount = info.taskCount;
      pickedFrom = info.source;
    }
  }

  const restored: KanbanSnapshot = {
    tasks: ensureTaskCodes(best.tasks).tasks,
    updatedAt: new Date().toISOString(),
  };
  await persistSnapshot(restored);

  return { restored, pickedFrom, scanned };
}

export async function replaceKanbanSnapshot(tasks: Task[]): Promise<KanbanSnapshot> {
  const snapshot: KanbanSnapshot = {
    tasks: ensureTaskCodes(tasks).tasks,
    updatedAt: new Date().toISOString(),
  };
  await persistSnapshot(snapshot);
  return snapshot;
}

export async function saveKanbanSnapshot(
  tasks: Task[],
  expectedUpdatedAt?: string,
): Promise<KanbanSnapshot> {
  const current = await loadKanbanSnapshot();
  if (tasks.length === 0 && current.tasks.length > 0) {
    console.warn("[kanban] refused to save empty task list over existing data");
    return current;
  }
  const mergedTasks =
    expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt
      ? mergeKanbanTasks(current.tasks, tasks)
      : tasks;

  const snapshot: KanbanSnapshot = {
    tasks: ensureTaskCodes(mergedTasks).tasks,
    updatedAt: new Date().toISOString(),
  };
  try {
    await persistSnapshot(snapshot);
  } catch (error) {
    console.warn("[kanban] failed to persist snapshot", error);
    throw error;
  }
  return snapshot;
}
