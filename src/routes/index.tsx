import { createFileRoute } from "@tanstack/react-router";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "任务看板 — JoyAge" },
      { name: "description", content: "JoyAge 任务看板：To Do、In Progress、Testing、Done 四列工作流，支持 Backlog、标签、评论与拖拽。" },
      { property: "og:title", content: "任务看板 — JoyAge" },
      { property: "og:description", content: "敏捷任务看板：规划、开发、测试、上线一气呵成。" },
    ],
  }),
  component: KanbanBoard,
});
