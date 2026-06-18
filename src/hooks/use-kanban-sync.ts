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

  const applySnapshot = useCallback((nextTasks: Task[], nextUpdatedAt: string) => {
    setTasks(nextTasks);
    setUpdatedAt(nextUpdatedAt);
    updatedAtRef.current = nextUpdatedAt;
    tasksRef.current = nextTasks;
  }, []);

  const flushSave = useCallback(async () => {
    if (!dirtyRef.current || savingRef.current) return;
    savingRef.current = true;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    try {
      const result = await saveKanbanSnapshotFn({
        data: {
          tasks: tasksRef.current,
          expectedUpdatedAt: updatedAtRef.current ?? undefined,
        },
      });
      dirtyRef.current = false;
      applySnapshot(result.tasks, result.updatedAt);
      setSyncError(null);
    } catch {
      dirtyRef.current = true;
      setSyncError("保存失败，稍后重试");
    } finally {
      savingRef.current = false;
    }
  }, [applySnapshot]);

  const scheduleSave = useCallback(
    (immediate = false) => {
      dirtyRef.current = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (immediate) {
        void flushSave();
        return;
      }
      saveTimerRef.current = setTimeout(() => {
        void flushSave();
      }, SAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  const refresh = useCallback(async () => {
    if (dirtyRef.current || savingRef.current) return;
    try {
      const snapshot = await getKanbanSnapshot();
      if (snapshot.updatedAt !== updatedAtRef.current) {
        const merged = mergeKanbanTasks(snapshot.tasks, tasksRef.current);
        applySnapshot(merged, snapshot.updatedAt);
        if (JSON.stringify(merged) !== JSON.stringify(snapshot.tasks)) {
          dirtyRef.current = true;
          scheduleSave(true);
        }
      }
      setSyncError(null);
    } catch {
      setSyncError("无法同步看板数据");
    } finally {
      setReady(true);
    }
  }, [applySnapshot, scheduleSave]);

  const setTasksAndSave = useCallback(
    (updater: Task[] | ((prev: Task[]) => Task[]), options?: { immediate?: boolean }) => {
      setTasks((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        tasksRef.current = next;
        return next;
      });
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
