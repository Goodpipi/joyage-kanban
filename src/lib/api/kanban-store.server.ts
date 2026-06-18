import fs from "node:fs/promises";
import path from "node:path";

import { externalizeTaskImages, migrateEmbeddedImagesInJsonFile } from "@/lib/api/kanban-image-store.server";
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
  kind: "current" | "backup" | "deploy" | "database";
}

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "kanban.json");
const BACKUP_FILE = path.join(DATA_DIR, "kanban.backup.json");
const DEPLOY_DIR = path.join(DATA_DIR, "history", "deploy");
const MAX_DEPLOY_FILES = Number(process.env.KANBAN_DEPLOY_MAX ?? 5);

let memorySnapshot: KanbanSnapshot | null = null;
let deployBackupDone = false;
let deployBackupPromise: Promise<void> | null = null;
let imageMigrationDone = false;
let imageMigrationPromise: Promise<void> | null = null;
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

async function pruneDir(files: string[], max: number): Promise<void> {
  if (files.length <= max) return;
  for (const old of files.slice(max)) {
    await fs.unlink(old).catch(() => {});
  }
}

function enqueuePersist(work: () => Promise<void>): Promise<void> {
  persistChain = persistChain.then(work).catch((error) => {
    console.warn("[kanban] persist queue error", error);
  });
  return persistChain;
}

async function pickLiveDataFile(): Promise<string | null> {
  for (const file of [DATA_FILE, BACKUP_FILE]) {
    try {
      const stat = await fs.stat(file);
      if (stat.size > 64) return file;
    } catch {
      // missing
    }
  }
  return null;
}

/** One-time per process: copy kanban.json before any writes (deploy backup). */
export function runDeployBackupOnStartup(): Promise<void> {
  if (deployBackupPromise) return deployBackupPromise;

  deployBackupPromise = (async () => {
    if (deployBackupDone) return;
    try {
      const source = await pickLiveDataFile();
      if (!source) {
        console.warn("[kanban] deploy backup skipped: no data file on disk");
        deployBackupDone = true;
        return;
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const deployFile = path.join(DEPLOY_DIR, `${stamp}-deploy.json`);
      await fs.mkdir(DEPLOY_DIR, { recursive: true });
      await fs.copyFile(source, deployFile);
      await fs.copyFile(source, path.join(DATA_DIR, "kanban.predeploy.json"));
      await pruneDir(await listDeployFiles(), MAX_DEPLOY_FILES);

      const { size } = await fs.stat(source);
      deployBackupDone = true;
      console.info(`[kanban] deploy backup: copied ${size} bytes (keeping ${MAX_DEPLOY_FILES} copies)`);
    } catch (error) {
      deployBackupDone = false;
      deployBackupPromise = null;
      console.warn("[kanban] deploy backup failed", error);
      throw error;
    }
  })();

  return deployBackupPromise;
}

/** Migrate embedded base64 images to /var/data/images/ without loading full JSON tree. */
export function runImageMigrationOnStartup(): Promise<void> {
  if (imageMigrationPromise) return imageMigrationPromise;

  imageMigrationPromise = (async () => {
    if (imageMigrationDone) return;
    try {
      let changed = false;
      if (await migrateEmbeddedImagesInJsonFile(DATA_FILE)) changed = true;
      if (await migrateEmbeddedImagesInJsonFile(BACKUP_FILE)) changed = true;
      if (changed) memorySnapshot = null;
      imageMigrationDone = true;
    } catch (error) {
      imageMigrationDone = false;
      imageMigrationPromise = null;
      console.warn("[kanban] image migration failed", error);
    }
  })();

  return imageMigrationPromise;
}

async function ensureStartupMaintenance(): Promise<void> {
  await runDeployBackupOnStartup();
  await runImageMigrationOnStartup();
}

async function readFromFile(): Promise<KanbanSnapshot | null> {
  const main = await readSnapshotFile(DATA_FILE);
  if (main && main.tasks.length > 0) return main;
  const backup = await readSnapshotFile(BACKUP_FILE);
  if (backup && backup.tasks.length > 0) return backup;

  const deployFiles = await listDeployFiles();
  const snapshots: KanbanSnapshot[] = [];
  for (const file of deployFiles.slice(0, MAX_DEPLOY_FILES)) {
    const parsed = await readSnapshotFile(file);
    if (parsed) snapshots.push(parsed);
  }
  return pickBestSnapshot(snapshots);
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
  await ensureStartupMaintenance();
  memorySnapshot = snapshot;
  await enqueuePersist(async () => {
    const { tasks, changed } = await externalizeTaskImages(snapshot.tasks);
    const stored = changed ? { ...snapshot, tasks } : snapshot;
    if (changed) memorySnapshot = stored;

    if (isDatabaseStorageEnabled()) {
      await writeToDatabase(stored);
    }
    const shouldWriteFile = !isDatabaseStorageEnabled() || !!process.env.DATA_DIR;
    if (shouldWriteFile) {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const payload = JSON.stringify(stored);
      await fs.writeFile(DATA_FILE, payload, "utf-8");
      if (stored.tasks.length > 0) {
        await fs.copyFile(DATA_FILE, BACKUP_FILE);
      }
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
  await ensureStartupMaintenance();
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

export async function scanDiskKanbanSnapshots(): Promise<DiskSnapshotInfo[]> {
  const candidates: DiskSnapshotInfo[] = [];

  for (const { source, file, kind } of [
    { source: "kanban.json", file: DATA_FILE, kind: "current" as const },
    { source: "kanban.backup.json", file: BACKUP_FILE, kind: "backup" as const },
  ]) {
    try {
      const stat = await fs.stat(file);
      const snapshot = await readSnapshotFile(file);
      if (snapshot) {
        candidates.push({
          source,
          kind,
          taskCount: snapshot.tasks.length,
          updatedAt: snapshot.updatedAt,
          bytes: stat.size,
        });
      }
    } catch {
      // skip
    }
  }

  for (const file of await listDeployFiles()) {
    try {
      const stat = await fs.stat(file);
      const snapshot = await readSnapshotFile(file);
      if (snapshot) {
        candidates.push({
          source: `history/deploy/${path.basename(file)}`,
          kind: "deploy",
          taskCount: snapshot.tasks.length,
          updatedAt: snapshot.updatedAt,
          bytes: stat.size,
        });
      }
    } catch {
      // skip
    }
  }

  return candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.taskCount - a.taskCount);
}

export async function listKanbanHistory(): Promise<DiskSnapshotInfo[]> {
  return (await scanDiskKanbanSnapshots()).filter((s) => s.kind === "deploy");
}

export async function restoreKanbanFromSource(source: string): Promise<KanbanSnapshot> {
  let file: string;
  if (source === "kanban.json") file = DATA_FILE;
  else if (source === "kanban.backup.json") file = BACKUP_FILE;
  else if (source.startsWith("history/deploy/")) {
    file = path.join(DEPLOY_DIR, source.replace("history/deploy/", ""));
  } else {
    throw new Error(`Unknown snapshot source: ${source}`);
  }

  const snapshot = await readSnapshotFile(file);
  if (!snapshot || snapshot.tasks.length === 0) {
    throw new Error("Snapshot is empty or unreadable");
  }

  return await replaceKanbanSnapshot(snapshot.tasks);
}

export async function recoverBestKanbanSnapshot(): Promise<{
  restored: KanbanSnapshot;
  pickedFrom: string;
  scanned: DiskSnapshotInfo[];
}> {
  const scanned = await scanDiskKanbanSnapshots();
  const snapshots: KanbanSnapshot[] = [];
  for (const info of scanned) {
    let file: string;
    if (info.source === "kanban.json") file = DATA_FILE;
    else if (info.source === "kanban.backup.json") file = BACKUP_FILE;
    else file = path.join(DEPLOY_DIR, info.source.replace("history/deploy/", ""));
    const parsed = await readSnapshotFile(file);
    if (parsed) snapshots.push(parsed);
  }

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
  return memorySnapshot ?? snapshot;
}
