import crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

import type { Task } from "@/lib/kanban-types";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
export const IMAGES_DIR = path.join(DATA_DIR, "images");

const IMAGE_REF_PREFIX = "/api/kanban/images/";
const SAFE_IMAGE_NAME = /^[\w-]+\.(png|jpe?g|webp|gif)$/i;
const DATA_URL_TOKEN_RE = /^data:image\/([a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/=]+)$/;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

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
  if (name === "upload") return null;
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

function persistDataUrlSync(seen: Map<string, string>, dataUrl: string): string {
  const cached = seen.get(dataUrl);
  if (cached) return cached;

  const match = DATA_URL_TOKEN_RE.exec(dataUrl);
  if (!match) return dataUrl;

  const bytes = Buffer.byteLength(match[2], "base64");
  if (bytes > MAX_IMAGE_BYTES) {
    throw new Error(`Image exceeds ${MAX_IMAGE_BYTES / (1024 * 1024)}MB limit`);
  }

  const ext = mimeToExt(match[1]);
  const filename = `${crypto.randomUUID()}.${ext}`;
  const ref = `${IMAGE_REF_PREFIX}${filename}`;
  fsSync.mkdirSync(IMAGES_DIR, { recursive: true });
  fsSync.writeFileSync(path.join(IMAGES_DIR, filename), Buffer.from(match[2], "base64"));
  seen.set(dataUrl, ref);
  return ref;
}

async function fileContainsDataUrls(filePath: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(filePath, "r");
    const { size } = await handle.stat();
    const buf = Buffer.alloc(128 * 1024);
    for (let pos = 0; pos < size; pos += buf.length) {
      const { bytesRead } = await handle.read(buf, 0, buf.length, pos);
      if (bytesRead <= 0) break;
      if (buf.subarray(0, bytesRead).includes("data:image")) return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** Stream through JSON on disk — never loads the whole file into memory. */
export async function migrateEmbeddedImagesInJsonFile(filePath: string): Promise<boolean> {
  if (!(await fileContainsDataUrls(filePath))) return false;

  const tmpPath = `${filePath}.migrate-tmp`;
  const seen = new Map<string, string>();
  let changed = false;

  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(filePath, { encoding: "utf8", highWaterMark: 256 * 1024 });
    const output = createWriteStream(tmpPath, { encoding: "utf8" });
    let carry = "";

    const processCarry = () => {
      while (true) {
        const start = carry.indexOf("data:image/");
        if (start < 0) {
          if (carry.length > 120) {
            output.write(carry.slice(0, -80));
            carry = carry.slice(-80);
          }
          return;
        }

        if (start > 0) {
          output.write(carry.slice(0, start));
          carry = carry.slice(start);
        }

        const close = carry.indexOf('"', "data:image/".length);
        if (close < 0) return;

        const token = carry.slice(0, close);
        carry = carry.slice(close);
        const ref = persistDataUrlSync(seen, token);
        if (ref !== token) changed = true;
        output.write(ref);
      }
    };

    input.on("data", (chunk: string) => {
      carry += chunk;
      processCarry();
    });
    input.on("end", () => {
      if (carry) output.write(carry);
      output.end();
    });
    input.on("error", reject);
    output.on("error", reject);
    output.on("finish", () => resolve());
  });

  if (!changed) {
    await fs.unlink(tmpPath).catch(() => {});
    return false;
  }

  await fs.rename(tmpPath, filePath);
  console.info(`[kanban] stream-migrated ${seen.size} images in ${path.basename(filePath)}`);
  return true;
}

async function saveDataUrl(dataUrl: string): Promise<string> {
  const seen = new Map<string, string>();
  return persistDataUrlSync(seen, dataUrl);
}

/** Save one uploaded image; returns /api/kanban/images/... ref. */
export async function uploadImageFromDataUrl(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith("data:image/")) {
    throw new Error("Invalid image data");
  }
  return saveDataUrl(dataUrl);
}

async function externalizeImageValue(value: string): Promise<string> {
  if (!value.startsWith("data:image")) return value;
  return saveDataUrl(value);
}

/** POST /api/kanban/images/upload — multipart file upload (no base64 in JSON). */
export async function handleKanbanImageUpload(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname !== `${IMAGE_REF_PREFIX}upload` || request.method !== "POST") return null;

  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Missing file" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return Response.json({ error: "Not an image" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return Response.json({ error: "File exceeds 10MB limit" }, { status: 400 });
  }

  const ext = mimeToExt(file.type.slice("image/".length));
  const filename = `${crypto.randomUUID()}.${ext}`;
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  await fs.writeFile(path.join(IMAGES_DIR, filename), Buffer.from(await file.arrayBuffer()));

  const url = `${IMAGE_REF_PREFIX}${filename}`;
  return Response.json({ url });
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
