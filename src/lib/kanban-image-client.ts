import { MAX_IMAGE_BYTES } from "@/lib/kanban-types";

const UPLOAD_URL = "/api/kanban/images/upload";

/** Upload a file to disk storage; returns /api/kanban/images/... (not base64). */
export async function uploadKanbanImageFile(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;
  if (file.size > MAX_IMAGE_BYTES) {
    alert(`图片 ${file.name} 超过 10MB，无法上传`);
    return null;
  }
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(UPLOAD_URL, { method: "POST", body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(typeof err.error === "string" ? err.error : "Upload failed");
    }
    const { url } = (await res.json()) as { url: string };
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
