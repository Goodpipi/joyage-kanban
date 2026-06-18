import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { Task } from "@/lib/kanban-types";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
export const IMAGES_DIR = path.join(DATA_DIR, "images");

const DATA_URL_RE = /data:image\/([a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/=]+)/g;
const IMAGE_REF_PREFIX = "/api/kanban/images/";
const SAFE_IMAGE_NAME = /^[\w-]+\.(png|jpe?g|webp|gif)$/i;

function mimeToExt(mime: string): string {
  const m = mime.toLowerCase();
  if (m === "png") return "png";
  if (m === "jpeg" || m === "jpg") return "jpg";
  if (m === "webp") return "webp";
  if (m === "gif") return "gif";
  return "webp";
}

function mimeFromExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  if (e === "gif") return "image/gif";
  return "image/jpeg";
}

export function isKanbanImageApiPath(pathname: string): boolean {
  return pathname.startsWith(IMAGE_REF_PREFIX);
}

export async function serveKanbanImage(pathname: string): Promise<Response | null> {
  if (!isKanbanImageApiPath(pathname)) return null;
  const name = path.basename(pathname);
  if (!SAFE_IMAGE_NAME.test(name)) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const buf = await fs.readFile(path.join(IMAGES_DIR, name));
    const ext = path.extname(name).slice(1);
    return new Response(buf, {
      headers: {
        "content-type": mimeFromExt(ext),
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

async function saveDataUrl(dataUrl: string): Promise<string> {
  const match = /^data:image\/([a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return dataUrl;

  const ext = mimeToExt(match[1]);
  const filename = `${crypto.randomUUID()}.${ext}`;
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  await fs.writeFile(path.join(IMAGES_DIR, filename), Buffer.from(match[2], "base64"));
  return `${IMAGE_REF_PREFIX}${filename}`;
}

async function externalizeImageValue(value: string): Promise<string> {
  if (!value.startsWith("data:image")) return value;
  return saveDataUrl(value);
}

/** Move embedded data URLs in tasks to files; JSON keeps only /api/kanban/images/... refs. */
export async function externalizeTaskImages(tasks: Task[]): Promise<{ tasks: Task[]; changed: boolean }> {
  let changed = false;
  const next = await Promise.all(
    tasks.map(async (task) => {
      let taskChanged = false;
      let descriptionImages = task.descriptionImages;
      if (descriptionImages?.length) {
        const mapped = await Promise.all(descriptionImages.map((src) => externalizeImageValue(src)));
        if (mapped.some((src, i) => src !== descriptionImages![i])) {
          descriptionImages = mapped;
          taskChanged = true;
        }
      }

      let comments = task.comments;
      if (comments?.length) {
        const mappedComments = await Promise.all(
          comments.map(async (c) => {
            if (!c.images.length) return c;
            const mappedImages = await Promise.all(c.images.map((src) => externalizeImageValue(src)));
            if (mappedImages.every((src, i) => src === c.images[i])) return c;
            taskChanged = true;
            return { ...c, images: mappedImages };
          }),
        );
        comments = mappedComments;
      }

      if (!taskChanged) return task;
      changed = true;
      return { ...task, descriptionImages, comments };
    }),
  );
  return { tasks: next, changed };
}

/** One-pass in-file migration without JSON.parse — shrinks large kanban.json on disk. */
export async function migrateEmbeddedImagesInJsonFile(filePath: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    return false;
  }
  if (!raw.includes("data:image")) return false;

  const seen = new Map<string, string>();
  const matches = [...raw.matchAll(DATA_URL_RE)];

  for (const m of matches) {
    const full = m[0];
    if (seen.has(full)) continue;
    const ext = mimeToExt(m[1]);
    const filename = `${crypto.randomUUID()}.${ext}`;
    seen.set(full, `${IMAGE_REF_PREFIX}${filename}`);
  }

  if (seen.size === 0) return false;

  await fs.mkdir(IMAGES_DIR, { recursive: true });
  await Promise.all(
    [...seen.entries()].map(async ([full, ref]) => {
      const match = /^data:image\/([a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(full);
      if (!match) return;
      await fs.writeFile(path.join(IMAGES_DIR, path.basename(ref)), Buffer.from(match[2], "base64"));
    }),
  );

  let migrated = raw;
  for (const [full, ref] of seen) {
    migrated = migrated.split(full).join(ref);
  }

  await fs.writeFile(filePath, migrated, "utf-8");
  console.info(`[kanban] migrated ${seen.size} embedded images in ${path.basename(filePath)}`);
  return true;
}
