import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, ImagePlus, Send, Tag as TagIcon, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  TAG_OPTIONS, avatarColor, collectImagesFromClipboard, fileToDataUrl, uid,
  type Task, type TagId, type TaskComment,
} from "@/lib/kanban-types";
import { cn } from "@/lib/utils";

interface Props {
  task: Task | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChange: (t: Task) => void;
  currentUser: string;
}

export function TaskDetailDialog({ task, open, onOpenChange, onChange, currentUser }: Props) {
  const [draft, setDraft] = useState<Task | null>(task);
  const [commentText, setCommentText] = useState("");
  const [commentImages, setCommentImages] = useState<string[]>([]);
  const descFileRef = useRef<HTMLInputElement>(null);
  const commentFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(task);
    setCommentText("");
    setCommentImages([]);
  }, [task?.id, open]);

  if (!draft) return null;

  const update = (patch: Partial<Task>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    onChange(next);
  };

  const toggleTag = (id: TagId) => {
    const current = draft.tags?.[0];
    update({ tags: current === id ? [] : [id] });
  };

  const onDescPaste = async (e: React.ClipboardEvent) => {
    const imgs = await collectImagesFromClipboard(e);
    if (imgs.length) update({ descriptionImages: [...(draft.descriptionImages || []), ...imgs] });
  };

  const onDescFiles = async (files: FileList | null) => {
    if (!files) return;
    const urls: string[] = [];
    for (const f of Array.from(files)) {
      const u = await fileToDataUrl(f);
      if (u) urls.push(u);
    }
    if (urls.length) update({ descriptionImages: [...(draft.descriptionImages || []), ...urls] });
  };

  const onCommentPaste = async (e: React.ClipboardEvent) => {
    const imgs = await collectImagesFromClipboard(e);
    if (imgs.length) setCommentImages((p) => [...p, ...imgs]);
  };

  const onCommentFiles = async (files: FileList | null) => {
    if (!files) return;
    const urls: string[] = [];
    for (const f of Array.from(files)) {
      const u = await fileToDataUrl(f);
      if (u) urls.push(u);
    }
    if (urls.length) setCommentImages((p) => [...p, ...urls]);
  };

  const addComment = () => {
    if (!commentText.trim() && commentImages.length === 0) return;
    const c: TaskComment = {
      id: uid(),
      author: currentUser.trim() || "匿名",
      text: commentText.trim(),
      images: commentImages,
      createdAt: new Date().toISOString(),
    };
    update({ comments: [...(draft.comments || []), c] });
    setCommentText("");
    setCommentImages([]);
  };

  const removeComment = (id: string) =>
    update({ comments: (draft.comments || []).filter((c) => c.id !== id) });

  const removeDescImage = (i: number) =>
    update({ descriptionImages: (draft.descriptionImages || []).filter((_, ix) => ix !== i) });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border border-white/80 bg-white/95 p-0 shadow-[var(--shadow-pop)] backdrop-blur-2xl sm:rounded-2xl">
        <div className="p-6">
          <DialogTitle asChild>
            <Input
              value={draft.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="Task title"
              className="h-auto border-0 bg-transparent p-0 text-xl font-bold tracking-tight shadow-none focus-visible:ring-0"
            />
          </DialogTitle>

          {/* Meta row */}
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Assignee</label>
              <Input
                value={draft.assignee}
                onChange={(e) => update({ assignee: e.target.value })}
                placeholder="Who owns this?"
                className="mt-1 glass-soft border-0"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Due date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <button className="glass-soft mt-1 flex h-9 w-full items-center gap-2 rounded-md px-3 text-sm">
                    <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    {draft.dueDate ? format(new Date(draft.dueDate), "PPP") : <span className="text-muted-foreground">Pick date</span>}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={draft.dueDate ? new Date(draft.dueDate) : undefined}
                    onSelect={(d) => update({ dueDate: d?.toISOString() })}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Tags */}
          <div className="mt-4">
            <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <TagIcon className="h-3 w-3" /> Tags
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {TAG_OPTIONS.map((t) => {
                const active = (draft.tags || []).includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => toggleTag(t.id)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition",
                      active ? t.className : "glass-soft text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Description */}
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <button
                onClick={() => descFileRef.current?.click()}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ImagePlus className="h-3 w-3" /> Add image
              </button>
              <input
                ref={descFileRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={(e) => { onDescFiles(e.target.files); e.target.value = ""; }}
              />
            </div>
            <Textarea
              value={draft.description}
              onChange={(e) => update({ description: e.target.value })}
              onPaste={onDescPaste}
              placeholder="Describe the task… (paste images directly)"
              rows={4}
              className="glass-soft mt-1 resize-none border-0"
            />
            {(draft.descriptionImages?.length || 0) > 0 && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {draft.descriptionImages!.map((src, i) => (
                  <div key={i} className="group relative overflow-hidden rounded-lg ring-1 ring-border">
                    <img src={src} alt="" className="aspect-video w-full object-cover" />
                    <button
                      onClick={() => removeDescImage(i)}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Comments */}
          <div className="mt-6">
            <label className="text-xs font-medium text-muted-foreground">
              Comments ({draft.comments?.length || 0})
            </label>

            <div className="mt-2 space-y-3">
              {(draft.comments || []).map((c) => (
                <div key={c.id} className="glass-soft group rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs">
                      <span
                        style={{ backgroundImage: avatarColor(c.author) }}
                        className="grid h-5 w-5 place-items-center rounded-full text-[9px] font-semibold text-white"
                      >
                        {c.author.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="font-medium text-foreground">{c.author}</span>
                      <span className="text-muted-foreground">{format(new Date(c.createdAt), "MMM d, HH:mm")}</span>
                    </div>
                    <button
                      onClick={() => removeComment(c.id)}
                      className="rounded p-1 text-muted-foreground/60 opacity-0 transition hover:text-primary group-hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  {c.text && <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground/85">{c.text}</p>}
                  {c.images.length > 0 && (
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {c.images.map((src, i) => (
                        <img key={i} src={src} alt="" className="aspect-video w-full rounded-lg object-cover ring-1 ring-border" />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Add comment */}
            <div className="glass-card mt-3 rounded-xl p-3">
              <Textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onPaste={onCommentPaste}
                placeholder="Write a comment… (paste images directly)"
                rows={2}
                className="resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
              />
              {commentImages.length > 0 && (
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {commentImages.map((src, i) => (
                    <div key={i} className="group relative overflow-hidden rounded-lg ring-1 ring-border">
                      <img src={src} alt="" className="aspect-square w-full object-cover" />
                      <button
                        onClick={() => setCommentImages((p) => p.filter((_, ix) => ix !== i))}
                        className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-center justify-between">
                <button
                  onClick={() => commentFileRef.current?.click()}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                >
                  <ImagePlus className="h-3.5 w-3.5" /> Upload image
                </button>
                <input
                  ref={commentFileRef}
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { onCommentFiles(e.target.files); e.target.value = ""; }}
                />
                <Button size="sm" onClick={addComment} className="gap-1">
                  <Send className="h-3.5 w-3.5" /> Comment
                </Button>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground/70">单张图片不超过 10MB</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
