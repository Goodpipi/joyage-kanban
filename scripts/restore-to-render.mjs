import { readFileSync } from "node:fs";
import { toJSONAsync } from "seroval";

const BASE = process.env.KANBAN_URL ?? "https://joyage-kanban.onrender.com";
const backupPath = process.argv[2] ?? "backups/post-deploy-2026-06-16.json";

async function findServerFnId(bundleText, label) {
  const idx = bundleText.indexOf(label);
  if (idx < 0) return null;
  const slice = bundleText.slice(Math.max(0, idx - 120), idx + 120);
  const m = slice.match(/[a-f0-9]{64}/);
  return m?.[0] ?? null;
}

async function main() {
  const backup = JSON.parse(readFileSync(backupPath, "utf8"));
  const tasks = backup.tasks ?? backup;
  console.log(`restoring ${tasks.length} tasks from ${backupPath}`);

  const html = await fetch(BASE).then((r) => r.text());
  const assetMatch = html.match(/\/assets\/index-[^"]+\.js/g);
  const assets = [...new Set(assetMatch ?? [])];
  let restoreId = null;
  for (const asset of assets) {
    const js = await fetch(BASE + asset).then((r) => r.text());
    restoreId = await findServerFnId(js, "restoreKanbanSnapshotFn");
    if (restoreId) break;
  }
  if (!restoreId) {
    throw new Error("restoreKanbanSnapshotFn id not found in production bundle — deploy first");
  }

  const body = JSON.stringify(await toJSONAsync({ data: { tasks } }));
  const res = await fetch(`${BASE}/_serverFn/${restoreId}`, {
    method: "POST",
    headers: { "x-tsr-serverFn": "true", "Content-Type": "application/json" },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`restore failed ${res.status}: ${text.slice(0, 300)}`);

  const { fromCrossJSON } = await import("seroval");
  const decoded = fromCrossJSON(JSON.parse(text), { plugins: [] });
  const snapshot = decoded?.result ?? decoded;
  console.log("restored tasks:", snapshot.tasks?.length ?? "?");
  console.log("updatedAt:", snapshot.updatedAt ?? "?");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
