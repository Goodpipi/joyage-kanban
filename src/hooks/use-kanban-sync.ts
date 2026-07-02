import { useCallback, useEffect, useRef, useState } from "react";

import { getKanbanSnapshot, saveKanbanSnapshotFn } from "@/lib/api/kanban.functions";
import { mergeKanbanTasks, type CustomTag, type Task } from "@/lib/kanban-types";

const POLL_MS = 8000;
const SAVE_DEBOUNCE_MS = 800;

function tasksFingerprint(tasks: Task[]): string {
  return `${tasks.length}|${tasks.map((t) => `${t.id}:${t.column}:${t.updatedAt ?? ""}:${t.title.length}`).join(",")}`;
}

export function useKanbanSync(enabled: boolean) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [customTags, setCustomTags] = useState<CustomTag[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const updatedAtRef = useRef<string | null>(null);
  const tasksRef = useRef<Task[]>([]);
  const customTagsRef = useRef<CustomTag[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);

  useEffect(() => {
    updatedAtRef.current = updatedAt;
  }, [updatedAt]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    customTagsRef.current = customTags;
  }, [customTags]);

  const hasPendingLocalEdits = useCallback(() => {
    return dirtyRef.current || savingRef.current || saveTimerRef.current !== null;
  }, []);

  const applySnapshot = useCallback((nextTasks: Task[], nextCustomTags: CustomTag[], nextUpdatedAt: string) => {
    setTasks(nextTasks);
    setCustomTags(nextCustomTags);
    setUpdatedAt(nextUpdatedAt);
    updatedAtRef.current = nextUpdatedAt;
    tasksRef.current = nextTasks;
    customTagsRef.current = nextCustomTags;
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
    const tagsToSave = customTagsRef.current;
    const expectedAt = updatedAtRef.current ?? undefined;
    const tasksFingerprintAtSave = tasksFingerprint(tasksToSave);
    try {
      const result = await saveKanbanSnapshotFn({
        data: {
          tasks: tasksToSave,
          expectedUpdatedAt: expectedAt,
          customTags: tagsToSave,
        },
      });
      if (tasksFingerprint(tasksRef.current) !== tasksFingerprintAtSave) {
        dirtyRef.current = true;
        return;
      }
      dirtyRef.current = false;
      bumpUpdatedAt(result.updatedAt);
      if (result.customTags) {
        setCustomTags(result.customTags);
        customTagsRef.current = result.customTags;
      }
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
    const tasksBeforeFetch = tasksFingerprint(tasksRef.current);
    const updatedAtBeforeFetch = updatedAtRef.current;
    try {
      const snapshot = await getKanbanSnapshot();
      if (hasPendingLocalEdits()) return;
      if (tasksFingerprint(tasksRef.current) !== tasksBeforeFetch) return;
      if (snapshot.updatedAt === updatedAtBeforeFetch) return;

      const local = tasksRef.current;
      const merged = local.length === 0 ? snapshot.tasks : mergeKanbanTasks(snapshot.tasks, local);
      if (hasPendingLocalEdits()) return;
      if (tasksFingerprint(tasksRef.current) !== tasksBeforeFetch) return;

      applySnapshot(merged, snapshot.customTags ?? [], snapshot.updatedAt);
      if (local.length > 0 && tasksFingerprint(merged) !== tasksFingerprint(snapshot.tasks)) {
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

  const setCustomTagsAndSave = useCallback(
    (updater: CustomTag[] | ((prev: CustomTag[]) => CustomTag[])) => {
      setCustomTags((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        customTagsRef.current = next;
        return next;
      });
      scheduleSave();
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

  return { tasks, customTags, setTasks: setTasksAndSave, setCustomTags: setCustomTagsAndSave, ready, syncError, refresh };
}
