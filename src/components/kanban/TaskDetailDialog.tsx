import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, ImagePlus, Plus, Send, Tag as TagIcon, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  CUSTOM_TAG_PALETTE,
  PRIORITY_OPTIONS,
  avatarColor,
  resolveTagOptions,
  uid,
  type CustomTag,
  type Priority,
  type Task,
  type TagId,
  type TaskComment,
} from "@/lib/kanban-types";
import { uploadImagesFromClipboard, uploadKanbanImageFile } from "@/lib/kanban-image-client";
import { ClickableImageThumbnail, ImagePreviewDialog } from "@/components/kanban/ImagePreviewDialog";
import { cn } from "@/lib/utils";

interface Props {
  task: Task | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChange: (t: Task) => void;
  currentUser: string;
  customTags?: CustomTag[];
  onAddCustomTag?: (tag: CustomTag) => void;
}

export function TaskDetailDialog({ task, open, onOpenChange, onChange, currentUser, customTags = [], onAddCustomTag }: Props) {
  const [draft, setDraft] = useState<Task | null>(task);
  const [commentText, setCommentText] = useState("");
  const [commentImages, setCommentImages] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ images: string[]; index: number } | null>(null);
  const [newTagLabel, setNewTagLabel] = useState("");
  const descFileRef = useRef<HTMLInputElement>(null);
  const commentFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(task);
    setCommentText("");
    setCommentImages([]);
    setPreview(null);
  }, [task?.id, open]);

  if (!draft) return null;

  const update = (patch: Partial<Task>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    onChange(next);
  };

  const toggleTag = (id: TagId) => {
    const current = draft.tags || [];
    update({
      tags: current.includes(id) ? current.filter((t) => t !== id) : [...current, id],
    });
  };

  const addCustomTag = () => {
    const label = newTagLabel.trim();
    if (!label) return;
    const id = `custom-${uid()}`;
    const className = CUSTOM_TAG_PALETTE[customTags.length % CUSTOM_TAG_PALETTE.length];
    const tag: CustomTag = { id, label, className };
    onAddCustomTag?.(tag);
    update({ tags: [...(draft.tags || []), id] });
    setNewTagLabel("");
  };

  const allTags = resolveTagOptions(customTags);

  const onDescPaste = async (e: React.ClipboardEvent) => {
    const imgs = await uploadImagesFromClipboard(e);
    if (imgs.length) update({ descriptionImages: [...(draft.descriptionImages || []), ...imgs] });
  };

  const onDescFiles = async (files: FileList | null) => {
    if (!files) return;
    const urls: string[] = [];
    for (const f of Array.from(files)) {
      const u = await uploadKanbanImageFile(f);
      if (u) urls.push(u);
    }
    if (urls.length) update({ descriptionImages: [...(draft.descriptionImages || []), ...urls] });
  };

  const onCommentPaste = async (e: React.ClipboardEvent) => {
    const imgs = await uploadImagesFromClipboard(e);
    if (imgs.length) setCommentImages((p) => [...p, ...imgs]);
  };

  const onCommentFiles = async (files: FileList | null) => {
    if (!files) return;
    const urls: string[] = [];
    for (const f of Array.from(files)) {
      const u = await uploadKanbanImageFile(f);
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

  const openPreview = (images: string[], index: number) => setPreview({ images, index });

  return (
    <>
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
          <p className="mt-1 font-mono text-xs font-semibold tracking-wide text-primary">{draft.code}</p>

          {/* Meta row */}
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
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
            <div className="sm:col-span-1">
              <label className="text-xs font-medium text-muted-foreground">优先级</label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {PRIORITY_OPTIONS.map((p) => {
                  const active = draft.priority === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => update({ priority: active ? undefined : p.id as Priority })}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-medium transition",
                        active ? p.className : "glass-soft text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Tags */}
          <div className="mt-4">
            <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <TagIcon className="h-3 w-3" /> Tags
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {allTags.map((t) => {
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
            <div className="mt-2 flex gap-2">
              <Input
                value={newTagLabel}
                onChange={(e) => setNewTagLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomTag(); } }}
                placeholder="新建自定义标签…"
                className="glass-soft h-8 border-0 text-xs"
              />
              <Button type="button" size="sm" variant="outline" onClick={addCustomTag} className="h-8 gap-1 px-2">
                <Plus className="h-3.5 w-3.5" /> 添加
              </Button>
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
                  <div key={i} className="group relative">
                    <ClickableImageThumbnail
                      src={src}
                      className="aspect-video w-full object-cover"
                      onPreview={() => openPreview(draft.descriptionImages!, i)}
                    />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeDescImage(i); }}
                      className="absolute right-1 top-1 z-10 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
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
                        <ClickableImageThumbnail
                          key={i}
                          src={src}
                          className="aspect-video w-full object-cover"
                          onPreview={() => openPreview(c.images, i)}
                        />
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
                    <div key={i} className="group relative">
                      <ClickableImageThumbnail
                        src={src}
                        className="aspect-square w-full object-cover"
                        onPreview={() => openPreview(commentImages, i)}
                      />
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setCommentImages((p) => p.filter((_, ix) => ix !== i)); }}
                        className="absolute right-1 top-1 z-10 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
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
    <ImagePreviewDialog
      images={preview?.images ?? []}
      index={preview?.index ?? null}
      onIndexChange={(index) => {
        if (index === null) setPreview(null);
        else if (preview) setPreview({ ...preview, index });
      }}
    />
    </>
  );
}
