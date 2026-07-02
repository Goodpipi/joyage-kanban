import { useState } from "react";
import { ArchiveRestore, CheckSquare, Trash2, X } from "lucide-react";
import type { CustomTag, Task } from "@/lib/kanban-types";
import { TaskCard } from "./TaskCard";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tasks: Task[];
  customTags?: CustomTag[];
  onOpenTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onDeleteTasks: (ids: string[]) => void;
  onRestoreTask: (id: string) => void;
  onChangeTask: (t: Task) => void;
}

export function ArchivedPanel({
  open,
  onOpenChange,
  tasks,
  customTags,
  onOpenTask,
  onDeleteTask,
  onDeleteTasks,
  onRestoreTask,
  onChangeTask,
}: Props) {
  const [filter, setFilter] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const visible = tasks.filter((t) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      (t.code?.toLowerCase() ?? "").includes(q) ||
      t.title.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.assignee.toLowerCase().includes(q)
    );
  });

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

  const handleOpenChange = (v: boolean) => {
    if (!v) exitSelectMode();
    onOpenChange(v);
  };

  const selectedCount = [...selectedIds].filter((id) => visible.some((t) => t.id === id)).length;

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          className="w-full border-l border-white/70 bg-white/95 shadow-[var(--shadow-pop)] backdrop-blur-2xl sm:max-w-md"
        >
          <SheetHeader className="space-y-1">
            <SheetTitle className="text-xl font-bold tracking-tight">已归档</SheetTitle>
            <SheetDescription>已归档的任务不会出现在看板列中，可随时恢复。</SheetDescription>
          </SheetHeader>

          <div className="mt-4 flex items-center gap-2">
            <div className="glass-soft flex flex-1 items-center gap-2 rounded-full px-3 py-1.5">
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="搜索编码、标题、描述、责任人…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
              />
              {filter && (
                <button onClick={() => setFilter("")} className="text-muted-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
              className={cn(
                "flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                selectMode
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-foreground/10 text-muted-foreground hover:text-primary",
              )}
            >
              <CheckSquare className="h-3.5 w-3.5" />
              {selectMode ? "取消" : "多选"}
            </button>
          </div>

          {selectMode && selectedCount > 0 && (
            <div className="mt-3 flex items-center justify-between rounded-xl bg-red-50 px-3 py-2 ring-1 ring-red-200">
              <span className="text-sm font-medium text-red-800">已选 {selectedCount} 项</span>
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1 rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white"
              >
                <Trash2 className="h-3.5 w-3.5" /> 批量删除
              </button>
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2.5 overflow-y-auto p-1.5 pb-6" style={{ maxHeight: "calc(100vh - 220px)" }}>
            {visible.length === 0 && (
              <div className="glass-soft rounded-xl px-4 py-10 text-center text-sm text-muted-foreground">
                暂无已归档任务。
              </div>
            )}
            {visible.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                customTags={customTags}
                draggable={false}
                menuMode="archived"
                selectable={selectMode}
                selected={selectedIds.has(t.id)}
                onSelectToggle={toggleSelect}
                onOpen={onOpenTask}
                onDelete={onDeleteTask}
                onRestore={onRestoreTask}
                onChange={onChangeTask}
                extraAction={
                  !selectMode ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); onRestoreTask(t.id); }}
                      title="恢复任务"
                      className="flex items-center gap-1 rounded-full bg-primary-soft px-2 py-1 text-[10px] font-semibold text-primary hover:bg-primary hover:text-primary-foreground"
                    >
                      恢复 <ArchiveRestore className="h-3 w-3" />
                    </button>
                  ) : undefined
                }
              />
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除 {selectedCount} 个已归档任务？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作不可撤销，任务将从看板中永久删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const ids = [...selectedIds].filter((id) => visible.some((t) => t.id === id));
                onDeleteTasks(ids);
                exitSelectMode();
                setConfirmDelete(false);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
