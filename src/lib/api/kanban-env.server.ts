import { getKanbanStorageMode, type KanbanStorageMode } from "@/lib/api/kanban-store.server";

/** Local `npm run dev` without DATA_DIR — isolated demo, never touches Render disk. */
export function isLocalDemoMode(): boolean {
  return process.env.NODE_ENV === "development" && !process.env.DATA_DIR;
}

export function getKanbanRuntimeInfo(): {
  mode: KanbanStorageMode;
  isLocalDemo: boolean;
  isProduction: boolean;
  dataDir: string | null;
} {
  return {
    mode: getKanbanStorageMode(),
    isLocalDemo: isLocalDemoMode(),
    isProduction: process.env.NODE_ENV === "production" && !!process.env.DATA_DIR,
    dataDir: process.env.DATA_DIR ?? null,
  };
}
