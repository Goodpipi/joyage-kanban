import { useState } from "react";
import { ArrowRight, Plus, X } from "lucide-react";
import type { Task } from "@/lib/kanban-types";
import { uid } from "@/lib/kanban-types";
import { TaskCard } from "./TaskCard";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tasks: Task[];
  setTasks: (updater: (prev: Task[]) => Task[]) => void;
  onSendToTodo: (id: string) => void;
  onOpenTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
}

export function BacklogPanel({ open, onOpenChange, tasks, setTasks, onSendToTodo, onOpenTask, onDeleteTask }: Props) {
  const [filter, setFilter] = useState("");

  const visible = tasks.filter((t) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      t.title.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.assignee.toLowerCase().includes(q)
    );
  });

  const add = () =>
    setTasks((prev) => [
      { id: uid(), title: "", description: "", assignee: "", column: "backlog" },
      ...prev,
    ]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full border-l border-white/70 bg-white/95 shadow-[var(--shadow-pop)] backdrop-blur-2xl sm:max-w-md"
      >
        <SheetHeader className="space-y-1">
          <SheetTitle className="text-xl font-bold tracking-tight">Backlog</SheetTitle>
          <SheetDescription>Park ideas here, then send them to To Do when ready.</SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex items-center gap-2">
          <div className="glass-soft flex flex-1 items-center gap-2 rounded-full px-3 py-1.5">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter title, description, assignee…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
            />
            {filter && (
              <button onClick={() => setFilter("")} className="text-muted-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={add}
            className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-2.5 overflow-y-auto pb-6" style={{ maxHeight: "calc(100vh - 180px)" }}>
          {visible.length === 0 && (
            <div className="glass-soft rounded-xl px-4 py-10 text-center text-sm text-muted-foreground">
              No items in backlog.
            </div>
          )}
          {visible.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              draggable={false}
              onOpen={onOpenTask}
              onDelete={onDeleteTask}
              onChange={(nt) => setTasks((prev) => prev.map((x) => (x.id === nt.id ? nt : x)))}
              extraAction={
                <button
                  onClick={(e) => { e.stopPropagation(); onSendToTodo(t.id); }}
                  title="Send to To Do"
                  className="flex items-center gap-1 rounded-full bg-primary-soft px-2 py-1 text-[10px] font-semibold text-primary hover:bg-primary hover:text-primary-foreground"
                >
                  To Do <ArrowRight className="h-3 w-3" />
                </button>
              }
            />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
