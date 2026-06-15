import { uid, type Task } from "@/lib/kanban-types";

export const KANBAN_SEED: Task[] = [
  {
    id: uid(),
    title: "Design onboarding flow",
    description: "Welcome screens + tour highlights",
    assignee: "Alex",
    column: "todo",
    dueDate: new Date(Date.now() + 86400000 * 3).toISOString(),
  },
  {
    id: uid(),
    title: "Refactor auth module",
    description: "Split provider and hooks",
    assignee: "Mira",
    column: "in-progress",
  },
  {
    id: uid(),
    title: "QA: checkout regression",
    description: "Verify discount edge cases",
    assignee: "Sam",
    column: "testing",
  },
  {
    id: uid(),
    title: "Ship marketing site v2",
    description: "Hero + pricing redesign",
    assignee: "Jules",
    column: "done",
  },
  {
    id: uid(),
    title: "Explore AI summaries",
    description: "Spike on weekly digest",
    assignee: "Mira",
    column: "backlog",
  },
];
