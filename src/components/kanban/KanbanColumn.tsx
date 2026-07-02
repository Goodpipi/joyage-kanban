import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import type { ColumnId, CustomTag, Task } from "@/lib/kanban-types";
import { TaskCard } from "./TaskCard";
import { cn } from "@/lib/utils";

interface Props {
  id: ColumnId;
  title: string;
  hint: string;
  tasks: Task[];
  onAdd: () => void;
  onOpenTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onArchiveTask: (id: string) => void;
  onChangeTask: (t: Task) => void;
  customTags?: CustomTag[];
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectToggle?: (id: string) => void;
}

const accentByCol: Record<ColumnId, string> = {
  todo: "bg-primary/70",
  "in-progress": "bg-amber-400",
  testing: "bg-sky-400",
  done: "bg-emerald-400",
};

export function KanbanColumn({
  id,
  title,
  hint,
  tasks,
  onAdd,
  onOpenTask,
  onDeleteTask,
  onArchiveTask,
  onChangeTask,
  customTags,
  selectable,
  selectedIds,
  onSelectToggle,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "glass-panel flex h-full min-h-0 flex-col rounded-2xl p-3 transition-all",
        isOver && "ring-2 ring-primary/50 ring-offset-2 ring-offset-transparent",
      )}
    >
      <div className="mb-3 flex shrink-0 items-center justify-between px-1.5">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", accentByCol[id])} />
          <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
          <span className="rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {tasks.length}
          </span>
        </div>
        <button
          onClick={onAdd}
          className="rounded-md p-1 text-muted-foreground hover:bg-primary-soft hover:text-primary"
          aria-label="Add task"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <p className="mb-2 shrink-0 px-1.5 text-[11px] text-muted-foreground/70">{hint}</p>

      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="kanban-column-scroll flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-y-contain pr-1">
          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              customTags={customTags}
              selectable={selectable}
              selected={selectedIds?.has(t.id)}
              onSelectToggle={onSelectToggle}
              onOpen={onOpenTask}
              onDelete={onDeleteTask}
              onArchive={onArchiveTask}
              onChange={onChangeTask}
            />
          ))}
          <button
            onClick={onAdd}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-foreground/15 py-2 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-primary"
          >
            <Plus className="h-3.5 w-3.5" /> New task
          </button>
        </div>
      </SortableContext>
    </div>
  );
}
