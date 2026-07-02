import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { Archive, CheckSquare, Inbox, LogOut, Search, X } from "lucide-react";
import {
  COLUMNS,
  PRIORITY_OPTIONS,
  avatarColor,
  isTaskDueToday,
  isTaskOverdue,
  nextTaskCode,
  sortTasksByPriority,
  uid,
  type ActiveColumn,
  type ColumnId,
  type CustomTag,
  type Priority,
  type Task,
} from "@/lib/kanban-types";
import { KanbanColumn } from "@/components/kanban/KanbanColumn";
import { TaskCard } from "@/components/kanban/TaskCard";
import { BacklogPanel } from "@/components/kanban/BacklogPanel";
import { ArchivedPanel } from "@/components/kanban/ArchivedPanel";
import { BacklogDropZone } from "@/components/kanban/BacklogDropZone";
import { LocalDemoBanner } from "@/components/kanban/LocalDemoBanner";
import { TaskDetailDialog } from "@/components/kanban/TaskDetailDialog";
import { Login } from "@/components/kanban/Login";
import { useKanbanSync } from "@/hooks/use-kanban-sync";
import { LOGO_URL } from "@/lib/logo";
import { cn } from "@/lib/utils";

const USER_KEY = "joyage_user";
type DropColumn = ColumnId | "backlog";
type DueFilter = "all" | "overdue" | "today";

function readStoredUser(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(USER_KEY);
}

export function KanbanBoard() {
  const [user, setUser] = useState<string | null>(readStoredUser);
  const { tasks, customTags, setTasks, setCustomTags, ready, syncError } = useKanbanSync(!!user);

  const login = (name: string) => {
    localStorage.setItem(USER_KEY, name);
    setUser(name);
  };
  const logout = () => {
    localStorage.removeItem(USER_KEY);
    setUser(null);
  };

  const [filter, setFilter] = useState("");
  const [dueFilter, setDueFilter] = useState<DueFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");
  const [showBacklog, setShowBacklog] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const hasActiveFilters = !!filter.trim() || dueFilter !== "all" || priorityFilter !== "all";

  const clearFilters = () => {
    setFilter("");
    setDueFilter("all");
    setPriorityFilter("all");
  };

  const matches = (t: Task) => {
    if (dueFilter === "overdue" && !isTaskOverdue(t)) return false;
    if (dueFilter === "today" && !isTaskDueToday(t)) return false;
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      (t.code?.toLowerCase() ?? "").includes(q) ||
      t.title.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.assignee.toLowerCase().includes(q)
    );
  };

  const byColumn = useMemo(() => {
    const map: Record<ColumnId, Task[]> = { todo: [], "in-progress": [], testing: [], done: [] };
    for (const t of tasks) {
      if (t.column !== "backlog" && t.column !== "archived" && matches(t)) {
        map[t.column].push(t);
      }
    }
    if (dueFilter !== "all" || priorityFilter !== "all") {
      for (const col of COLUMNS) {
        map[col.id] = sortTasksByPriority(map[col.id]);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, filter, dueFilter, priorityFilter]);

  const backlog = tasks.filter((t) => t.column === "backlog");
  const archived = tasks.filter((t) => t.column === "archived");
  const activeTask = tasks.find((t) => t.id === activeId) || null;

  const updateTask = (nt: Task) => setTasks((p) => p.map((x) => (x.id === nt.id ? nt : x)));
  const deleteTask = (id: string) =>
    setTasks((p) => p.filter((x) => x.id !== id), { immediate: true });

  const deleteTasks = (ids: string[]) =>
    setTasks((p) => p.filter((x) => !ids.includes(x.id)), { immediate: true });

  const archiveTasks = (ids: string[]) =>
    setTasks(
      (p) =>
        p.map((t) => {
          if (!ids.includes(t.id) || t.column === "archived") return t;
          const from: ActiveColumn = t.column === "backlog" ? "backlog" : t.column;
          return { ...t, archivedFrom: from, column: "archived" as const };
        }),
      { immediate: true },
    );

  const archiveTask = (id: string) => archiveTasks([id]);

  const restoreTask = (id: string) =>
    setTasks(
      (p) =>
        p.map((t) => {
          if (t.id !== id || t.column !== "archived") return t;
          const { archivedFrom, ...rest } = t;
          return { ...rest, column: archivedFrom ?? "todo" };
        }),
      { immediate: true },
    );

  const addToColumn = (col: ColumnId) => {
    const id = uid();
    setTasks((p) => [
      ...p,
      { id, code: nextTaskCode(p), title: "", description: "", assignee: user || "", column: col },
    ]);
    setOpenTaskId(id);
  };

  const addToBacklog = () => {
    const id = uid();
    setTasks((p) => [
      { id, code: nextTaskCode(p), title: "", description: "", assignee: user || "", column: "backlog" },
      ...p,
    ]);
    setOpenTaskId(id);
  };

  const sendToTodo = (id: string) =>
    setTasks((p) => p.map((x) => (x.id === id ? { ...x, column: "todo" } : x)));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const addCustomTag = (tag: CustomTag) => {
    setCustomTags((prev) => (prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]));
  };

  const findContainer = (id: string): DropColumn | null => {
    if (id === "backlog") return "backlog";
    const t = tasks.find((x) => x.id === id);
    if (t && t.column !== "backlog" && t.column !== "archived") return t.column;
    if (["todo", "in-progress", "testing", "done"].includes(id)) return id as ColumnId;
    return null;
  };

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    exitSelectMode();
  };

  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activeCol = findContainer(String(active.id));
    const overCol = findContainer(String(over.id));
    if (!activeCol || !overCol || activeCol === overCol) return;

    if (overCol === "backlog") {
      setTasks((prev) => prev.map((t) => (t.id === active.id ? { ...t, column: "backlog" } : t)), { persist: false });
      return;
    }

    setTasks((prev) => prev.map((t) => (t.id === active.id ? { ...t, column: overCol } : t)), { persist: false });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveId(null);
    if (!over) return;

    const activeCol = findContainer(String(active.id));
    const overCol = findContainer(String(over.id));
    if (!activeCol || !overCol) return;

    if (overCol === "backlog") {
      setTasks((prev) => prev.map((t) => (t.id === active.id ? { ...t, column: "backlog" } : t)), { immediate: true });
      return;
    }

    if (activeCol === overCol) {
      if (active.id === over.id) return;
      setTasks((prev) => {
        const inCol = prev.filter((t) => t.column === overCol);
        const oldIndex = inCol.findIndex((t) => t.id === active.id);
        const newIndex = inCol.findIndex((t) => t.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return prev;
        const reordered = arrayMove(inCol, oldIndex, newIndex);
        const others = prev.filter((t) => t.column !== overCol);
        return [...others, ...reordered];
      }, { immediate: true });
      return;
    }

    setTasks((prev) => prev, { immediate: true });
  };

  if (!user) return <Login onLogin={login} />;

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">正在加载看板…</p>
      </div>
    );
  }

  const initials = user.trim().slice(0, 2).toUpperCase();
  const boardSelectedCount = [...selectedIds].filter((id) => {
    const t = tasks.find((x) => x.id === id);
    return t && t.column !== "backlog" && t.column !== "archived";
  }).length;

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      <header className="flex flex-col gap-3 px-4 pt-4">
        <LocalDemoBanner />
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={LOGO_URL}
              alt="JoyAge"
              className="h-16 w-auto shrink-0 object-contain sm:h-[4.75rem]"
            />
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-foreground">任务看板</h1>
              <p className="text-xs text-muted-foreground">Plan · Build · Test · Ship</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => { setShowArchived(true); exitSelectMode(); }}
              className="flex items-center gap-1.5 rounded-full border border-primary/25 bg-white/70 px-4 py-2 text-sm font-semibold text-primary shadow-sm transition hover:bg-primary-soft"
            >
              <Archive className="h-4 w-4" /> 已归档
              <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[11px]">{archived.length}</span>
            </button>
            <button
              onClick={() => { setShowBacklog(true); exitSelectMode(); }}
              className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[0_8px_20px_-8px_oklch(0.72_0.11_0/0.7)] transition hover:opacity-90"
            >
              <Inbox className="h-4 w-4" /> Backlog
              <span className="ml-1 rounded-full bg-white/25 px-1.5 text-[11px]">{backlog.length}</span>
            </button>
            <button
              onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition",
                selectMode
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-foreground/10 bg-white/70 text-foreground hover:bg-primary-soft hover:text-primary",
              )}
            >
              <CheckSquare className="h-4 w-4" />
              {selectMode ? "取消多选" : "多选"}
            </button>
            <div className="glass-soft flex items-center gap-2 rounded-full py-1 pl-1 pr-3">
              <span
                style={{ backgroundImage: avatarColor(user) }}
                className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-semibold text-white shadow-sm ring-1 ring-white/70"
              >
                {initials}
              </span>
              <span className="text-sm font-medium text-foreground">{user}</span>
              <button
                onClick={logout}
                className="ml-1 rounded-full p-1 text-muted-foreground hover:bg-primary-soft hover:text-primary"
                aria-label="退出登录"
                title="退出登录"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
        {syncError && <p className="text-xs text-destructive">{syncError}</p>}

        <div className="glass-panel flex flex-col gap-2 rounded-2xl px-4 py-2.5 sm:flex-row sm:items-center">
          <div className="glass-soft flex w-full items-center gap-2 rounded-full px-3 py-1.5 sm:flex-1">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜索编码、标题、描述、责任人…"
              className="min-w-0 flex-1 bg-transparent text-left text-sm outline-none placeholder:text-muted-foreground/70"
            />
            {filter && (
              <button onClick={() => setFilter("")} className="text-muted-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={dueFilter}
              onChange={(e) => setDueFilter(e.target.value as DueFilter)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium outline-none transition",
                dueFilter !== "all"
                  ? "bg-primary-soft text-primary ring-1 ring-primary/20"
                  : "glass-soft text-muted-foreground",
              )}
            >
              <option value="all">全部到期状态</option>
              <option value="overdue">已逾期</option>
              <option value="today">今日到期</option>
            </select>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as Priority | "all")}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium outline-none transition",
                priorityFilter !== "all"
                  ? "bg-primary-soft text-primary ring-1 ring-primary/20"
                  : "glass-soft text-muted-foreground",
              )}
            >
              <option value="all">全部优先级</option>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}优先级</option>
              ))}
            </select>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 rounded-full bg-foreground/5 px-3 py-1 text-xs font-medium text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground"
              >
                <X className="h-3 w-3" /> 清除筛选
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="relative mb-4 mt-3 flex-1 overflow-hidden px-4 pb-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          <BacklogDropZone visible={!!activeId} />
          <div className="grid h-full min-h-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {COLUMNS.map((c) => (
              <KanbanColumn
                key={c.id}
                id={c.id}
                title={c.title}
                hint={c.hint}
                tasks={byColumn[c.id]}
                customTags={customTags}
                selectable={selectMode}
                selectedIds={selectedIds}
                onSelectToggle={toggleSelect}
                onAdd={() => addToColumn(c.id)}
                onOpenTask={setOpenTaskId}
                onDeleteTask={deleteTask}
                onArchiveTask={archiveTask}
                onChangeTask={updateTask}
              />
            ))}
          </div>
          <DragOverlay>
            {activeTask && (
              <div className="rotate-1">
                <TaskCard task={activeTask} customTags={customTags} onOpen={() => {}} onDelete={() => {}} menuMode="none" draggable={false} />
              </div>
            )}
          </DragOverlay>
        </DndContext>

        {selectMode && boardSelectedCount > 0 && (
          <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/80 bg-white/95 px-5 py-2.5 shadow-[var(--shadow-pop)] backdrop-blur-xl">
            <span className="text-sm font-medium">已选 {boardSelectedCount} 项</span>
            <button
              onClick={() => {
                const ids = [...selectedIds].filter((id) => {
                  const t = tasks.find((x) => x.id === id);
                  return t && t.column !== "backlog" && t.column !== "archived";
                });
                archiveTasks(ids);
                exitSelectMode();
              }}
              className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground"
            >
              <Archive className="h-4 w-4" /> 批量归档
            </button>
          </div>
        )}
      </main>

      <BacklogPanel
        open={showBacklog}
        onOpenChange={setShowBacklog}
        tasks={backlog}
        customTags={customTags}
        setTasks={(updater) =>
          setTasks((prev) => {
            const others = prev.filter((t) => t.column !== "backlog");
            const next = updater(prev.filter((t) => t.column === "backlog")).map((t) => ({
              ...t,
              column: "backlog" as const,
            }));
            return [...others, ...next];
          })
        }
        onAdd={addToBacklog}
        onSendToTodo={sendToTodo}
        onOpenTask={setOpenTaskId}
        onDeleteTask={deleteTask}
        onArchiveTask={archiveTask}
      />

      <ArchivedPanel
        open={showArchived}
        onOpenChange={setShowArchived}
        tasks={archived}
        customTags={customTags}
        onOpenTask={setOpenTaskId}
        onDeleteTask={deleteTask}
        onDeleteTasks={deleteTasks}
        onRestoreTask={restoreTask}
        onChangeTask={updateTask}
      />

      <TaskDetailDialog
        task={tasks.find((t) => t.id === openTaskId) || null}
        open={!!openTaskId}
        onOpenChange={(v) => !v && setOpenTaskId(null)}
        onChange={updateTask}
        currentUser={user}
        customTags={customTags}
        onAddCustomTag={addCustomTag}
      />
    </div>
  );
}
