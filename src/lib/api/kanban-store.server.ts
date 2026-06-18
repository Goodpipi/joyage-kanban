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
  kind: "current" | "backup" | "history" | "daily" | "deploy" | "database";
}

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "kanban.json");
const BACKUP_FILE = path.join(DATA_DIR, "kanban.backup.json");
const HISTORY_DIR = path.join(DATA_DIR, "history");
const DAILY_DIR = path.join(HISTORY_DIR, "daily");
const DEPLOY_DIR = path.join(HISTORY_DIR, "deploy");

const MAX_HISTORY_FILES = Number(process.env.KANBAN_HISTORY_MAX ?? 100);
const AUTO_SNAPSHOT_MS = Number(process.env.KANBAN_AUTO_SNAPSHOT_MS ?? 60 * 60 * 1000);
const MAX_DAILY_FILES = Number(process.env.KANBAN_DAILY_MAX ?? 90);
const MAX_DEPLOY_FILES = Number(process.env.KANBAN_DEPLOY_MAX ?? 60);
const SAVE_HISTORY_THROTTLE_MS = Number(process.env.KANBAN_SAVE_HISTORY_MS ?? 5 * 60 * 1000);

let memorySnapshot: KanbanSnapshot | null = null;
let autoHistoryStarted = false;
let deployBackupDone = false;
let lastAutoSnapshotAt = 0;
let lastSaveHistoryAt = 0;
let persistChain: Promise<void> = Promise.resolve();

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

async function listDailyFiles(): Promise<string[]> {
  try {
    const names = await fs.readdir(DAILY_DIR);
    return names
      .filter((n) => n.endsWith(".json"))
      .map((n) => path.join(DAILY_DIR, n))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

async function listDeployFiles(): Promise<string[]> {
  try {
    const names = await fs.readdir(DEPLOY_DIR);
    return names
      .filter((n) => n.endsWith(".json"))
      .map((n) => path.join(DEPLOY_DIR, n))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function snapshotSignature(snapshot: KanbanSnapshot): string {
  return `${snapshot.updatedAt}|${snapshot.tasks.length}|${snapshot.tasks.map((t) => t.id).join(",")}`;
}

async function pruneDir(files: string[], max: number): Promise<void> {
  if (files.length <= max) return;
  for (const old of files.slice(max)) {
    await fs.unlink(old).catch(() => {});
  }
}

async function writeSnapshotFile(file: string, snapshot: KanbanSnapshot): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(snapshot), "utf-8");
}

function enqueuePersist(work: () => Promise<void>): Promise<void> {
  persistChain = persistChain.then(work).catch((error) => {
    console.warn("[kanban] persist queue error", error);
  });
  return persistChain;
}

async function maybeAppendSaveHistory(snapshot: KanbanSnapshot): Promise<void> {
  const now = Date.now();
  if (now - lastSaveHistoryAt < SAVE_HISTORY_THROTTLE_MS) return;
  lastSaveHistoryAt = now;
  await appendHistorySnapshot(snapshot, "save");
}

async function appendHistorySnapshot(snapshot: KanbanSnapshot, tag = "save"): Promise<void> {
  if (snapshot.tasks.length === 0) return;

  const files = await listHistoryFiles();
  if (files.length > 0) {
    const last = await readSnapshotFile(files[0]);
    if (last && snapshotSignature(last) === snapshotSignature(snapshot)) return;
  }

  await fs.mkdir(HISTORY_DIR, { recursive: true });
  const stamp = snapshot.updatedAt.replace(/[:.]/g, "-");
  const file = path.join(HISTORY_DIR, `${stamp}-${snapshot.tasks.length}tasks-${tag}.json`);
  await writeSnapshotFile(file, snapshot);
  await pruneDir(await listHistoryFiles(), MAX_HISTORY_FILES);
}

async function appendDeploySnapshot(snapshot: KanbanSnapshot): Promise<void> {
  if (snapshot.tasks.length === 0) return;

  const files = await listDeployFiles();
  if (files.length > 0) {
    const existing = await readSnapshotFile(files[0]);
    if (existing && snapshotSignature(existing) === snapshotSignature(snapshot)) return;
  }

  await fs.mkdir(DEPLOY_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(DEPLOY_DIR, `${stamp}-${snapshot.tasks.length}tasks-deploy.json`);
  await writeSnapshotFile(file, snapshot);
  await pruneDir(await listDeployFiles(), MAX_DEPLOY_FILES);
}

async function ensureDeployBackup(): Promise<void> {
  if (deployBackupDone) return;
  deployBackupDone = true;
  try {
    const current = await readSnapshotFile(DATA_FILE);
    if (!current || current.tasks.length === 0) return;
    await appendDeploySnapshot(current);
  } catch (error) {
    console.warn("[kanban] deploy backup failed", error);
  }
}

async function appendDailySnapshot(snapshot: KanbanSnapshot): Promise<void> {
  if (snapshot.tasks.length === 0) return;
  const day = snapshot.updatedAt.slice(0, 10);
  const file = path.join(DAILY_DIR, `${day}.json`);
  const existing = await readSnapshotFile(file);
  if (existing) {
    const existingSig = snapshotSignature(existing);
    const nextSig = snapshotSignature(snapshot);
    if (existingSig === nextSig) return;
    if (!isNewer(snapshot.updatedAt, existing.updatedAt) && existing.tasks.length >= snapshot.tasks.length) {
      return;
    }
  }
  await writeSnapshotFile(file, snapshot);
  await pruneDir(await listDailyFiles(), MAX_DAILY_FILES);
}

export function ensureAutoHistoryScheduler(): void {
  if (autoHistoryStarted || typeof setInterval === "undefined") return;
  autoHistoryStarted = true;

  const tick = async () => {
    const now = Date.now();
    if (now - lastAutoSnapshotAt < AUTO_SNAPSHOT_MS - 5000) return;
    lastAutoSnapshotAt = now;
    try {
      const current = await readSnapshotFile(DATA_FILE);
      if (!current || current.tasks.length === 0) return;
      await appendHistorySnapshot(current, "auto");
      await appendDailySnapshot(current);
    } catch (error) {
      console.warn("[kanban] auto history snapshot failed", error);
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, AUTO_SNAPSHOT_MS);
}

export async function scanDiskKanbanSnapshots(): Promise<DiskSnapshotInfo[]> {
  const candidates: { source: string; snapshot: KanbanSnapshot; bytes: number; kind: DiskSnapshotInfo["kind"] }[] = [];

  const fixedFiles: { source: string; file: string; kind: DiskSnapshotInfo["kind"] }[] = [
    { source: "kanban.json", file: DATA_FILE, kind: "current" },
    { source: "kanban.backup.json", file: BACKUP_FILE, kind: "backup" },
  ];

  for (const { source, file, kind } of fixedFiles) {
    try {
      const raw = await fs.readFile(file, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (isValidSnapshot(parsed)) {
        candidates.push({ source, snapshot: parsed, bytes: Buffer.byteLength(raw, "utf8"), kind });
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
          kind: "history",
        });
      }
    } catch {
      // skip
    }
  }

  for (const file of await listDailyFiles()) {
    try {
      const raw = await fs.readFile(file, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (isValidSnapshot(parsed)) {
        candidates.push({
          source: `history/daily/${path.basename(file)}`,
          snapshot: parsed,
          bytes: Buffer.byteLength(raw, "utf8"),
          kind: "daily",
        });
      }
    } catch {
      // skip
    }
  }

  for (const file of await listDeployFiles()) {
    try {
      const raw = await fs.readFile(file, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (isValidSnapshot(parsed)) {
        candidates.push({
          source: `history/deploy/${path.basename(file)}`,
          snapshot: parsed,
          bytes: Buffer.byteLength(raw, "utf8"),
          kind: "deploy",
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
        kind: "database",
      });
    }
  }

  return candidates
    .map(({ source, snapshot, bytes, kind }) => ({
      source,
      kind,
      taskCount: snapshot.tasks.length,
      updatedAt: snapshot.updatedAt,
      bytes,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.taskCount - a.taskCount);
}

export async function listKanbanHistory(): Promise<DiskSnapshotInfo[]> {
  const all = await scanDiskKanbanSnapshots();
  return all.filter((s) => s.kind === "history" || s.kind === "daily" || s.kind === "deploy");
}

export async function restoreKanbanFromSource(source: string): Promise<KanbanSnapshot> {
  let file: string;
  if (source === "kanban.json") file = DATA_FILE;
  else if (source === "kanban.backup.json") file = BACKUP_FILE;
  else if (source.startsWith("history/daily/")) {
    file = path.join(DAILY_DIR, source.replace("history/daily/", ""));
  } else if (source.startsWith("history/deploy/")) {
    file = path.join(DEPLOY_DIR, source.replace("history/deploy/", ""));
  } else if (source.startsWith("history/")) {
    file = path.join(HISTORY_DIR, source.replace("history/", ""));
  } else {
    throw new Error(`Unknown snapshot source: ${source}`);
  }

  const snapshot = await readSnapshotFile(file);
  if (!snapshot || snapshot.tasks.length === 0) {
    throw new Error("Snapshot is empty or unreadable");
  }

  const current = await readSnapshotFile(DATA_FILE);
  if (current && current.tasks.length > 0) {
    await appendHistorySnapshot(current, "before-restore");
  }

  return await replaceKanbanSnapshot(snapshot.tasks);
}

async function readAllDiskSnapshots(): Promise<KanbanSnapshot[]> {
  const snapshots: KanbanSnapshot[] = [];

  for (const file of [
    DATA_FILE,
    BACKUP_FILE,
    ...(await listHistoryFiles()),
    ...(await listDailyFiles()),
    ...(await listDeployFiles()),
  ]) {
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
  const main = await readSnapshotFile(DATA_FILE);
  if (main && main.tasks.length > 0) return main;
  const backup = await readSnapshotFile(BACKUP_FILE);
  if (backup && backup.tasks.length > 0) return backup;
  return pickBestSnapshot(await readAllDiskSnapshots());
}

async function writeToFile(snapshot: KanbanSnapshot): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const payload = JSON.stringify(snapshot);
  await fs.writeFile(DATA_FILE, payload, "utf-8");

  if (snapshot.tasks.length > 0) {
    await fs.writeFile(BACKUP_FILE, payload, "utf-8");
    await maybeAppendSaveHistory(snapshot);
    await appendDailySnapshot(snapshot);
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
  await enqueuePersist(async () => {
    if (isDatabaseStorageEnabled()) {
      await writeToDatabase(snapshot);
    }
    const shouldWriteFile = !isDatabaseStorageEnabled() || !!process.env.DATA_DIR;
    if (shouldWriteFile) {
      await writeToFile(snapshot);
    }
  });
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
  await ensureDeployBackup();
  ensureAutoHistoryScheduler();
  if (memorySnapshot && memorySnapshot.tasks.length > 0) {
    return memorySnapshot;
  }
  const snapshot = isDatabaseStorageEnabled()
    ? await loadFromDatabaseStorage()
    : await loadFromFileStorage();
  return await normalizeSnapshot(snapshot);
}

async function ensureMemorySnapshot(): Promise<KanbanSnapshot> {
  if (memorySnapshot && memorySnapshot.tasks.length > 0) return memorySnapshot;
  return loadKanbanSnapshot();
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
  const current = await ensureMemorySnapshot();
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
