import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  getKanbanStorageInfoDetails,
  importKanbanSnapshot,
  loadKanbanSnapshot,
  saveKanbanSnapshot,
} from "@/lib/api/kanban-store.server";

const tagIdSchema = z.enum(["dev", "other"]);
const columnIdSchema = z.enum(["todo", "in-progress", "testing", "done", "backlog"]);

const taskCommentSchema = z.object({
  id: z.string(),
  author: z.string(),
  text: z.string(),
  images: z.array(z.string()),
  createdAt: z.string(),
});

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  descriptionImages: z.array(z.string()).optional(),
  dueDate: z.string().optional(),
  assignee: z.string(),
  tags: z.array(tagIdSchema).optional(),
  comments: z.array(taskCommentSchema).optional(),
  column: columnIdSchema,
});

const snapshotSchema = z.object({
  tasks: z.array(taskSchema),
  updatedAt: z.string().optional(),
});

export const getKanbanSnapshot = createServerFn({ method: "POST" }).handler(async () => {
  return await loadKanbanSnapshot();
});

export const getKanbanStorageInfo = createServerFn({ method: "POST" }).handler(async () => {
  return getKanbanStorageInfoDetails();
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

export const importKanbanSnapshotFn = createServerFn({ method: "POST" })
  .validator(snapshotSchema)
  .handler(async ({ data }) => {
    return await importKanbanSnapshot(data.tasks);
  });
