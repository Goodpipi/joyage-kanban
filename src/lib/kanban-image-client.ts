import { uploadKanbanImageFn } from "@/lib/api/kanban.functions";
import { fileToDataUrl } from "@/lib/kanban-types";

/** Upload a file to disk storage; returns /api/kanban/images/... (not base64). */
export async function uploadKanbanImageFile(file: File): Promise<string | null> {
  const dataUrl = await fileToDataUrl(file);
  if (!dataUrl) return null;
  try {
    const { url } = await uploadKanbanImageFn({ dataUrl });
    return url;
  } catch (error) {
    console.warn("[kanban] image upload failed", error);
    alert("图片上传失败，请稍后重试");
    return null;
  }
}

export async function uploadImagesFromClipboard(e: React.ClipboardEvent): Promise<string[]> {
  const items = e.clipboardData?.items;
  if (!items) return [];
  const out: string[] = [];
  for (const it of Array.from(items)) {
    if (it.kind !== "file") continue;
    const f = it.getAsFile();
    if (!f) continue;
    const url = await uploadKanbanImageFile(f);
    if (url) out.push(url);
  }
  return out;
}
