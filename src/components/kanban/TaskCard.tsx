import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  Archive,
  ArchiveRestore,
  Calendar as CalendarIcon,
  GripVertical,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Trash2,
} from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  PRIORITY_OPTIONS,
  avatarColor,
  isTaskDueToday,
  isTaskOverdue,
  resolveTagOptions,
  type CustomTag,
  type Task,
} from "@/lib/kanban-types";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface Props {
  task: Task;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onArchive?: (id: string) => void;
  onRestore?: (id: string) => void;
  onChange?: (task: Task) => void;
  draggable?: boolean;
  menuMode?: "board" | "archived" | "none";
  extraAction?: React.ReactNode;
  customTags?: CustomTag[];
  selectable?: boolean;
  selected?: boolean;
  onSelectToggle?: (id: string) => void;
}

export function TaskCard({
  task,
  onOpen,
  onDelete,
  onArchive,
  onRestore,
  onChange,
  draggable = true,
  menuMode = "board",
  extraAction,
  customTags = [],
  selectable = false,
  selected = false,
  onSelectToggle,
}: Props) {
  const sortable = useSortable({ id: task.id, disabled: !draggable });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  useEffect(() => setTitleDraft(task.title), [task.title]);

  const commitTitle = () => {
    setEditing(false);
    if (onChange && titleDraft !== task.title) onChange({ ...task, title: titleDraft });
  };

  const style = draggable
    ? { transform: CSS.Translate.toString(transform), transition }
    : undefined;

  const initials = (task.assignee || "?").trim().slice(0, 2).toUpperCase();
  const tagLookup = resolveTagOptions(customTags);
  const tags = (task.tags || [])
    .map((id) => tagLookup.find((t) => t.id === id) ?? { id, label: id, className: "bg-muted text-muted-foreground ring-1 ring-border" })
    .filter(Boolean);
  const priority = PRIORITY_OPTIONS.find((p) => p.id === task.priority);
  const dueToday = isTaskDueToday(task);
  const overdue = isTaskOverdue(task);
  const commentCount = task.comments?.length || 0;
  const imageCount = (task.descriptionImages?.length || 0) + (task.comments?.reduce((s, c) => s + c.images.length, 0) || 0);
  const showMenu = menuMode !== "none";

  return (
    <div
      ref={draggable ? setNodeRef : undefined}
      style={style}
      onClick={() => {
        if (selectable) {
          onSelectToggle?.(task.id);
          return;
        }
        onOpen(task.id);
      }}
      className={cn(
        "glass-card group relative cursor-pointer rounded-xl p-3.5 transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-1 hover:shadow-[var(--shadow-card-hover)]",
        isDragging && "opacity-50 shadow-none",
        selected && "ring-2 ring-inset ring-primary",
        overdue && "border border-red-200/80",
        dueToday && !overdue && "border border-amber-200/80",
      )}
    >
      <div className="absolute right-2 top-2 flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        {selectable && (
          <Checkbox
            checked={selected}
            onCheckedChange={() => onSelectToggle?.(task.id)}
            aria-label="选择任务"
          />
        )}
        {draggable && !selectable && (
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab rounded-md p-1 text-muted-foreground/50 opacity-0 transition hover:bg-primary-soft hover:text-primary group-hover:opacity-100 active:cursor-grabbing"
            aria-label="拖拽"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        {showMenu && !selectable && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="rounded-md p-1 text-muted-foreground/60 opacity-0 transition hover:bg-primary-soft hover:text-primary group-hover:opacity-100 data-[state=open]:opacity-100"
                aria-label="更多操作"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[8.5rem]">
              {menuMode === "archived" ? (
                <>
                  <DropdownMenuItem onClick={() => onRestore?.(task.id)} className="gap-2">
                    <ArchiveRestore className="h-4 w-4" />
                    恢复任务
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onDelete(task.id)}
                    className="gap-2 text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    删除任务
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuItem onClick={() => onArchive?.(task.id)} className="gap-2">
                    <Archive className="h-4 w-4" />
                    归档任务
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onDelete(task.id)}
                    className="gap-2 text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    删除任务
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className={cn("min-w-0 pr-14", showMenu || draggable || selectable ? "" : "pr-0")} onClick={(e) => { if (editing) e.stopPropagation(); }}>
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <span className="inline-block rounded-md bg-primary-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-primary">
            {task.code}
          </span>
          {priority && (
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", priority.className)}>
              {priority.label}
            </span>
          )}
        </div>
        {editing ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitTitle(); }
              if (e.key === "Escape") { setTitleDraft(task.title); setEditing(false); }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-md bg-white/80 px-1.5 py-0.5 text-sm font-semibold leading-snug text-foreground outline-none ring-1 ring-primary/40"
          />
        ) : (
          <h4
            className="truncate text-sm font-semibold leading-snug text-foreground hover:text-primary"
            onClick={(e) => { if (onChange && !selectable) { e.stopPropagation(); setEditing(true); } }}
            title={onChange ? "Click to edit" : undefined}
          >
            {task.title || <span className="text-muted-foreground/60">Untitled</span>}
          </h4>
        )}
      </div>

      {task.description && (
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {task.description}
        </p>
      )}

      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.map((t) => (
            <span key={t.id} className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", t.className)}>
              {t.label}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {task.dueDate && (
            <span className={cn(
              "glass-soft flex items-center gap-1 rounded-full px-2 py-0.5",
              overdue && "bg-red-50 text-red-600 ring-1 ring-red-200",
              dueToday && !overdue && "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
            )}>
              <CalendarIcon className="h-3 w-3" />
              {format(new Date(task.dueDate), "MMM d")}
              {overdue && " · 逾期"}
              {dueToday && !overdue && " · 今日"}
            </span>
          )}
          {commentCount > 0 && (
            <span className="flex items-center gap-0.5"><MessageSquare className="h-3 w-3" />{commentCount}</span>
          )}
          {imageCount > 0 && (
            <span className="flex items-center gap-0.5"><Paperclip className="h-3 w-3" />{imageCount}</span>
          )}
        </div>

        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {extraAction}
          <span title={task.assignee || "Unassigned"} className="flex items-center gap-1.5">
            <span
              style={task.assignee ? { backgroundImage: avatarColor(task.assignee) } : undefined}
              className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold text-white shadow-sm ring-1 ring-white/70"
            >
              {task.assignee ? initials : "?"}
            </span>
            <span className="max-w-[80px] truncate text-xs text-foreground/70">
              {task.assignee || "Unassigned"}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
