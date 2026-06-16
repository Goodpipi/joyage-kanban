import { useEffect, useRef, useState } from "react";
import { Download, HardDrive, Upload } from "lucide-react";

import {
  getKanbanSnapshot,
  getKanbanStorageInfo,
  importKanbanSnapshotFn,
} from "@/lib/api/kanban.functions";
import type { KanbanSnapshot } from "@/lib/api/kanban-store.server";
import { Button } from "@/components/ui/button";

interface Props {
  onImported: () => void;
}

type StorageInfo = {
  mode: "database" | "disk" | "file";
  dataDir: string | null;
  dataFile: string;
  persistent: boolean;
};

export function KanbanBackupControls({ onImported }: Props) {
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getKanbanStorageInfo().then((info) => setStorage(info as StorageInfo));
  }, []);

  const exportBackup = async () => {
    setBusy(true);
    try {
      const snapshot = await getKanbanSnapshot();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `joyage-kanban-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  const importBackup = async (file: File) => {
    setBusy(true);
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as KanbanSnapshot;
      if (!Array.isArray(parsed.tasks)) throw new Error("invalid backup");
      await importKanbanSnapshotFn({ data: { tasks: parsed.tasks, updatedAt: parsed.updatedAt } });
      onImported();
    } catch {
      alert("备份文件无效，请确认选择的是之前导出的 JSON 文件。");
    } finally {
      setBusy(false);
    }
  };

  const statusText = () => {
    if (!storage) return "正在检查存储方式…";
    if (storage.mode === "database") {
      return "数据已写入 PostgreSQL 数据库，并同步备份到磁盘（如已配置）。重新部署不会丢失。";
    }
    if (storage.mode === "disk") {
      return `数据已写入 Render 持久磁盘（${storage.dataDir}），每次修改会自动保存并生成双份备份。`;
    }
    return "当前为临时存储，重新部署可能丢失数据。请立即导出备份，或在 Render 配置 DATA_DIR=/var/data。";
  };

  const statusClass =
    storage?.persistent === false ? "text-amber-700" : "text-emerald-700";

  return (
    <div className="glass-soft flex flex-col gap-2 rounded-xl px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className={`flex items-start gap-2 text-xs ${statusClass}`}>
        <HardDrive className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{statusText()}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void exportBackup()}
          className="gap-1.5"
        >
          <Download className="h-3.5 w-3.5" />
          导出备份
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="gap-1.5"
        >
          <Upload className="h-3.5 w-3.5" />
          导入备份
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importBackup(file);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
