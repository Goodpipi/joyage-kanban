export type ColumnId = "todo" | "in-progress" | "testing" | "done";
export type TagId = "dev" | "other";
export type TaskColumn = ColumnId | "backlog" | "archived";
export type ActiveColumn = ColumnId | "backlog";

export interface TaskComment {
  id: string;
  author: string;
  text: string;
  images: string[]; // /api/kanban/images/... or legacy data URLs
  createdAt: string;
}

export interface Task {
  id: string;
  code: string;
  title: string;
  description: string;
  descriptionImages?: string[]; // /api/kanban/images/... or legacy data URLs
  dueDate?: string; // ISO
  assignee: string;
  tags?: TagId[];
  comments?: TaskComment[];
  column: TaskColumn;
  archivedFrom?: ActiveColumn;
}

export const COLUMNS: { id: ColumnId; title: string; hint: string }[] = [
  { id: "todo", title: "To Do", hint: "Up next" },
  { id: "in-progress", title: "In Progress", hint: "Doing now" },
  { id: "testing", title: "Testing", hint: "Verifying" },
  { id: "done", title: "Done", hint: "Shipped" },
];

export const TAG_OPTIONS: { id: TagId; label: string; className: string }[] = [
  { id: "dev", label: "开发任务", className: "bg-sky-100 text-sky-700 ring-1 ring-sky-200" },
  { id: "other", label: "其他任务", className: "bg-primary-soft text-primary ring-1 ring-primary/20" },
];

export const uid = () => Math.random().toString(36).slice(2, 10);

const TASK_CODE_RE = /^JG-(\d+)$/i;

export function nextTaskCode(tasks: Pick<Task, "code">[]): string {
  let maxNum = 0;
  for (const t of tasks) {
    const m = t.code?.match(TASK_CODE_RE);
    if (m) maxNum = Math.max(maxNum, Number.parseInt(m[1], 10));
  }
  return `JG-${String(maxNum + 1).padStart(4, "0")}`;
}

export function ensureTaskCodes(tasks: Array<Omit<Task, "code"> & { code?: string }>): { tasks: Task[]; changed: boolean } {
  const used = new Set<string>();
  let maxNum = 0;

  for (const t of tasks) {
    const m = t.code?.match(TASK_CODE_RE);
    if (m) maxNum = Math.max(maxNum, Number.parseInt(m[1], 10));
  }

  let next = maxNum + 1;
  let changed = false;

  const normalized = tasks.map((t) => {
    const m = t.code?.match(TASK_CODE_RE);
    if (m) {
      const code = `JG-${m[1].padStart(4, "0")}`;
      if (used.has(code)) {
        changed = true;
      } else {
        used.add(code);
        if (code !== t.code) changed = true;
        return { ...t, code };
      }
    }
    changed = true;
    let code: string;
    do {
      code = `JG-${String(next++).padStart(4, "0")}`;
    } while (used.has(code));
    used.add(code);
    return { ...t, code };
  });

  return { tasks: normalized, changed };
}

function asActiveColumn(column: TaskColumn): ActiveColumn | undefined {
  return column === "archived" ? undefined : column;
}

/** Merge incoming client save with server state (multi-tab / multi-user). */
export function mergeKanbanTask(server: Task, incoming: Task): Task {
  if (incoming.column === "archived") {
    const archivedFrom =
      incoming.archivedFrom ??
      (server.column !== "archived" ? asActiveColumn(server.column) : server.archivedFrom);
    return { ...incoming, archivedFrom };
  }

  if (server.column === "archived" && server.archivedFrom) {
    // Stale client still has the pre-archive column — keep archived on server.
    if (incoming.column === server.archivedFrom) return server;
    const { archivedFrom: _drop, ...restored } = incoming;
    return restored as Task;
  }

  return incoming;
}

export function mergeKanbanTasks(server: Task[], incoming: Task[]): Task[] {
  if (incoming.length === 0) return server;
  const serverMap = new Map(server.map((t) => [t.id, t]));
  return incoming.map((inc) => {
    const cur = serverMap.get(inc.id);
    return cur ? mergeKanbanTask(cur, inc) : inc;
  });
}

// Macaron palette for assignee avatars (pastel, harmonious with primary #DF8BA4)
const AVATAR_PALETTE = [
  "linear-gradient(135deg,#FFB5C2,#FF8FA8)", // pink
  "linear-gradient(135deg,#FFD6A5,#FFB870)", // peach
  "linear-gradient(135deg,#FDFFB6,#F2E36B)", // butter
  "linear-gradient(135deg,#CAFFBF,#8BE48B)", // mint
  "linear-gradient(135deg,#9BF6FF,#6CCFE0)", // sky
  "linear-gradient(135deg,#A0C4FF,#7AA7F5)", // periwinkle
  "linear-gradient(135deg,#BDB2FF,#9A8CF0)", // lavender
  "linear-gradient(135deg,#FFC6FF,#F09EE6)", // rose
  "linear-gradient(135deg,#D4F4DD,#9DD9B0)", // sage
  "linear-gradient(135deg,#FFE5B4,#F5C57A)", // apricot
];

export function avatarColor(name: string): string {
  const key = (name || "?").trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function fileToDataUrl(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;
  if (file.size > MAX_IMAGE_BYTES) {
    alert(`图片 ${file.name} 超过 10MB，无法上传`);
    return null;
  }
  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export async function collectImagesFromClipboard(e: React.ClipboardEvent): Promise<string[]> {
  const items = e.clipboardData?.items;
  if (!items) return [];
  const out: string[] = [];
  for (const it of Array.from(items)) {
    if (it.kind === "file") {
      const f = it.getAsFile();
      if (f) {
        const url = await fileToDataUrl(f);
        if (url) out.push(url);
      }
    }
  }
  return out;
}
