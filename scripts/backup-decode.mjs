import { readFileSync, writeFileSync } from "node:fs";
import { fromCrossJSON } from "seroval";

const rawPath = process.argv[2];
const outPath = process.argv[3];
if (!rawPath || !outPath) {
  console.error("Usage: node scripts/backup-decode.mjs <raw.json> <out.json>");
  process.exit(1);
}

const text = readFileSync(rawPath, "utf8").replace(/^\uFEFF/, "");
const raw = JSON.parse(text);
const decoded = fromCrossJSON(raw, { plugins: [] });
const snapshot = decoded?.result ?? decoded;

writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
console.log(`tasks: ${snapshot.tasks?.length ?? 0}`);
console.log(`updatedAt: ${snapshot.updatedAt ?? "n/a"}`);
console.log(`saved: ${outPath}`);
