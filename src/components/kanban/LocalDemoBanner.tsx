import { Monitor } from "lucide-react";

export function LocalDemoBanner() {
  if (!import.meta.env.DEV) return null;

  return (
    <div className="flex items-center gap-2 rounded-xl border border-amber-300/60 bg-amber-50/90 px-3 py-2 text-xs text-amber-900">
      <Monitor className="h-3.5 w-3.5 shrink-0" />
      <span>
        <strong>本地演示模式</strong> — 数据仅保存在本机 <code className="rounded bg-amber-100 px-1">.data/</code>
        ，与线上 <code className="rounded bg-amber-100 px-1">joyage-kanban.onrender.com</code> 完全隔离。
      </span>
    </div>
  );
}
