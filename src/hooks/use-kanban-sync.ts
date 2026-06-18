import { useCallback, useEffect, useRef, useState } from "react";

import { getKanbanSnapshot, saveKanbanSnapshotFn } from "@/lib/api/kanban.functions";
import { mergeKanbanTasks, type Task } from "@/lib/kanban-types";

const POLL_MS = 3000;
const SAVE_DEBOUNCE_MS = 400;

export function useKanbanSync(enabled: boolean) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const updatedAtRef = useRef<string | null>(null);
  const tasksRef = useRef<Task[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);

  useEffect(() => {
    updatedAtRef.current = updatedAt;
  }, [updatedAt]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const hasPendingLocalEdits = useCallback(() => {
    return dirtyRef.current || savingRef.current || saveTimerRef.current !== null;
  }, []);

  const applySnapshot = useCallback((nextTasks: Task[], nextUpdatedAt: string) => {
    setTasks(nextTasks);
    setUpdatedAt(nextUpdatedAt);
    updatedAtRef.current = nextUpdatedAt;
    tasksRef.current = nextTasks;
  }, []);

  const bumpUpdatedAt = useCallback((nextUpdatedAt: string) => {
    setUpdatedAt(nextUpdatedAt);
    updatedAtRef.current = nextUpdatedAt;
  }, []);

  const flushSave = useCallback(async () => {
    if (!dirtyRef.current || savingRef.current) return;
    savingRef.current = true;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const tasksToSave = tasksRef.current;
    const expectedAt = updatedAtRef.current ?? undefined;
    const tasksFingerprint = JSON.stringify(tasksToSave);
    try {
      const result = await saveKanbanSnapshotFn({
        data: {
          tasks: tasksToSave,
          expectedUpdatedAt: expectedAt,
        },
      });
      if (JSON.stringify(tasksRef.current) !== tasksFingerprint) {
        dirtyRef.current = true;
        return;
      }
      dirtyRef.current = false;
      bumpUpdatedAt(result.updatedAt);
      setSyncError(null);
    } catch {
      dirtyRef.current = true;
      setSyncError("保存失败，稍后重试");
    } finally {
      savingRef.current = false;
      if (dirtyRef.current) void flushSave();
    }
  }, [bumpUpdatedAt]);

  const scheduleSave = useCallback(
    (immediate = false) => {
      dirtyRef.current = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (immediate) {
        void flushSave();
        return;
      }
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void flushSave();
      }, SAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  const refresh = useCallback(async () => {
    if (hasPendingLocalEdits()) return;
    const tasksBeforeFetch = tasksRef.current;
    const updatedAtBeforeFetch = updatedAtRef.current;
    try {
      const snapshot = await getKanbanSnapshot();
      if (hasPendingLocalEdits()) return;
      if (JSON.stringify(tasksRef.current) !== JSON.stringify(tasksBeforeFetch)) return;
      if (snapshot.updatedAt === updatedAtBeforeFetch) return;

      const local = tasksRef.current;
      const merged = local.length === 0 ? snapshot.tasks : mergeKanbanTasks(snapshot.tasks, local);
      if (hasPendingLocalEdits()) return;
      if (JSON.stringify(tasksRef.current) !== JSON.stringify(tasksBeforeFetch)) return;

      applySnapshot(merged, snapshot.updatedAt);
      if (local.length > 0 && JSON.stringify(merged) !== JSON.stringify(snapshot.tasks)) {
        dirtyRef.current = true;
        scheduleSave(true);
      }
      setSyncError(null);
    } catch {
      setSyncError("无法同步看板数据");
    } finally {
      setReady(true);
    }
  }, [applySnapshot, hasPendingLocalEdits, scheduleSave]);

  const setTasksAndSave = useCallback(
    (updater: Task[] | ((prev: Task[]) => Task[]), options?: { immediate?: boolean; persist?: boolean }) => {
      setTasks((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        tasksRef.current = next;
        return next;
      });
      if (options?.persist === false) {
        dirtyRef.current = true;
        return;
      }
      scheduleSave(options?.immediate);
    },
    [scheduleSave],
  );

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const poll = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => {
      clearInterval(poll);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (dirtyRef.current) void flushSave();
    };
  }, [enabled, refresh, flushSave]);

  return { tasks, setTasks: setTasksAndSave, ready, syncError, refresh };
}
