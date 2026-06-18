import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";

import { restoreKanbanSnapshotFn } from "@/lib/api/kanban.functions";
import type { Task } from "@/lib/kanban-types";

interface Props {
  tasks: Task[];
  onImported: () => void;
}

export function KanbanDataControls({ tasks, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ tasks, exportedAt: new Date().toISOString() }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `joyage-kanban-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg("已导出当前看板 JSON");
  };

  const importJson = async (file: File) => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { tasks?: Task[] } | Task[];
      const imported = Array.isArray(parsed) ? parsed : parsed.tasks;
      if (!Array.isArray(imported) || imported.length === 0) {
        throw new Error("文件里没有任务数据");
      }
      await restoreKanbanSnapshotFn({ data: { tasks: imported } });
      setMsg(`已导入 ${imported.length} 条任务`);
      onImported();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "导入失败");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={exportJson}
        className="flex items-center gap-1 rounded-full border border-primary/20 bg-white/70 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary-soft"
      >
        <Download className="h-3.5 w-3.5" /> 导出备份
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-1 rounded-full border border-primary/20 bg-white/70 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary-soft disabled:opacity-50"
      >
        <Upload className="h-3.5 w-3.5" /> 导入恢复
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importJson(f);
        }}
      />
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}
