import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { loadKanbanSnapshot, replaceKanbanSnapshot, saveKanbanSnapshot } from "@/lib/api/kanban-store.server";

const tagIdSchema = z.enum(["dev", "other"]);
const columnIdSchema = z.enum(["todo", "in-progress", "testing", "done", "backlog", "archived"]);
const activeColumnSchema = z.enum(["todo", "in-progress", "testing", "done", "backlog"]);

const taskCommentSchema = z.object({
  id: z.string(),
  author: z.string(),
  text: z.string(),
  images: z.array(z.string()),
  createdAt: z.string(),
});

const taskSchema = z.object({
  id: z.string(),
  code: z.string().optional(),
  title: z.string(),
  description: z.string(),
  descriptionImages: z.array(z.string()).optional(),
  dueDate: z.string().optional(),
  assignee: z.string(),
  tags: z.array(tagIdSchema).optional(),
  comments: z.array(taskCommentSchema).optional(),
  column: columnIdSchema,
  archivedFrom: activeColumnSchema.optional(),
});

export const getKanbanSnapshot = createServerFn({ method: "POST" }).handler(async () => {
  return await loadKanbanSnapshot();
});

export const saveKanbanSnapshotFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      tasks: z.array(taskSchema),
      expectedUpdatedAt: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    return await saveKanbanSnapshot(data.tasks, data.expectedUpdatedAt);
  });

export const restoreKanbanSnapshotFn = createServerFn({ method: "POST" })
  .validator(z.object({ tasks: z.array(taskSchema) }))
  .handler(async ({ data }) => {
    return await replaceKanbanSnapshot(data.tasks);
  });
