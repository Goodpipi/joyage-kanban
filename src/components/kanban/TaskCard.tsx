import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, Trash2, GripVertical, MessageSquare, Paperclip } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TAG_OPTIONS, avatarColor, type Task } from "@/lib/kanban-types";
import { cn } from "@/lib/utils";

interface Props {
  task: Task;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onChange?: (task: Task) => void;
  draggable?: boolean;
  extraAction?: React.ReactNode;
}

export function TaskCard({ task, onOpen, onDelete, onChange, draggable = true, extraAction }: Props) {
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
  const tags = (task.tags || []).map((id) => TAG_OPTIONS.find((t) => t.id === id)).filter(Boolean) as typeof TAG_OPTIONS;
  const commentCount = task.comments?.length || 0;
  const imageCount = (task.descriptionImages?.length || 0) + (task.comments?.reduce((s, c) => s + c.images.length, 0) || 0);

  return (
    <div
      ref={draggable ? setNodeRef : undefined}
      style={style}
      onClick={() => onOpen(task.id)}
      className={cn(
        "glass-card group relative cursor-pointer rounded-xl p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]",
        isDragging && "opacity-50 shadow-none",
      )}
    >
      <div className="flex items-start gap-2">
        {draggable && (
          <button
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            className="-ml-1 mt-0.5 cursor-grab rounded p-0.5 text-muted-foreground/50 opacity-0 transition group-hover:opacity-100 active:cursor-grabbing"
            aria-label="Drag"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1" onClick={(e) => { if (editing) e.stopPropagation(); }}>
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
              onClick={(e) => { if (onChange) { e.stopPropagation(); setEditing(true); } }}
              title={onChange ? "Click to edit" : undefined}
            >
              {task.title || <span className="text-muted-foreground/60">Untitled</span>}
            </h4>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
          className="rounded-md p-1 text-muted-foreground/60 opacity-0 transition hover:bg-primary-soft hover:text-primary group-hover:opacity-100"
          aria-label="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
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
            <span className="glass-soft flex items-center gap-1 rounded-full px-2 py-0.5">
              <CalendarIcon className="h-3 w-3" />
              {format(new Date(task.dueDate), "MMM d")}
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
