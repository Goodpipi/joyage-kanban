import { useDroppable } from "@dnd-kit/core";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  visible: boolean;
}

export function BacklogDropZone({ visible }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: "backlog" });

  if (!visible) return null;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "glass-panel mb-3 flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-3 text-sm font-medium transition",
        isOver
          ? "border-primary bg-primary-soft text-primary"
          : "border-primary/30 text-muted-foreground",
      )}
    >
      <Inbox className="h-4 w-4" />
      拖放到此处移入 Backlog
    </div>
  );
}
