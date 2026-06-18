/**
 * DEV-ONLY emergency script — writes local JSON backup TO PRODUCTION.
 * Never run this during normal development. Local demo data must stay local.
 *
 * Required env vars:
 *   KANBAN_ALLOW_REMOTE_WRITE=1
 *   KANBAN_CONFIRM_PRODUCTION=joyage-kanban
 */
import { readFileSync } from "node:fs";
import { fromCrossJSON, toJSONAsync } from "seroval";

const BASE = process.env.KANBAN_URL ?? "https://joyage-kanban.onrender.com";

function assertRemoteWriteAllowed() {
  if (process.env.KANBAN_ALLOW_REMOTE_WRITE !== "1") {
    console.error(
      "BLOCKED: This script writes to production. Set KANBAN_ALLOW_REMOTE_WRITE=1 only when you intentionally restore production data.",
    );
    process.exit(1);
  }
  if (process.env.KANBAN_CONFIRM_PRODUCTION !== "joyage-kanban") {
    console.error(
      "BLOCKED: Set KANBAN_CONFIRM_PRODUCTION=joyage-kanban to confirm the target service.",
    );
    process.exit(1);
  }
  if (BASE.includes("localhost") || BASE.includes("127.0.0.1")) {
    console.error("BLOCKED: Target URL looks local — use production URL only for intentional restores.");
    process.exit(1);
  }
}

assertRemoteWriteAllowed();
const backupPath = process.argv[2] ?? "backups/post-deploy-2026-06-16.json";

const SAVE_FN_IDS = [
  "854f338f2f15a7eb9934536430ba65bfd3404b7cd0c6a4c8e5964450e9d780ee",
  "72a92c652775e51a6ee2506c8aaf53ab9d25a857c039908946907616608f64d8",
];

const RESTORE_FN_IDS = [
  "625bb25f6b9835318d6293741b4c018d92a6397ba541637caf361356b59446cb",
];

async function fetchBundleIds() {
  const html = await fetch(BASE, { signal: AbortSignal.timeout(120_000) }).then((r) => r.text());
  const assets = [...new Set(html.match(/\/assets\/index-[^"]+\.js/g) ?? [])];
  const ids = new Set();
  for (const asset of assets) {
    const js = await fetch(BASE + asset, { signal: AbortSignal.timeout(120_000) }).then((r) => r.text());
    for (const m of js.matchAll(/[a-f0-9]{64}/g)) ids.add(m[0]);
  }
  return [...ids];
}

async function callFn(fnId, payload) {
  const body = JSON.stringify(await toJSONAsync(payload));
  const res = await fetch(`${BASE}/_serverFn/${fnId}`, {
    method: "POST",
    headers: { "x-tsr-serverFn": "true", "Content-Type": "application/json" },
    signal: AbortSignal.timeout(120_000),
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fnId} failed ${res.status}: ${text.slice(0, 300)}`);
  return fromCrossJSON(JSON.parse(text), { plugins: [] });
}

async function main() {
  const backup = JSON.parse(readFileSync(backupPath, "utf8"));
  const tasks = backup.tasks ?? backup;
  console.log(`restoring ${tasks.length} tasks from ${backupPath}`);

  const bundleIds = await fetchBundleIds();
  const restoreCandidates = [
    ...RESTORE_FN_IDS,
    ...bundleIds.filter((id) => id.startsWith("625bb25")),
  ];
  const saveCandidates = [
    ...SAVE_FN_IDS,
    ...bundleIds,
  ];

  for (const id of restoreCandidates) {
    try {
      const decoded = await callFn(id, { data: { tasks } });
      const snapshot = decoded?.result ?? decoded;
      console.log("restore via", id.slice(0, 8), "tasks:", snapshot.tasks?.length);
      return;
    } catch (e) {
      console.warn("restore fn miss:", id.slice(0, 8), String(e).slice(0, 80));
    }
  }

  for (const id of saveCandidates) {
    try {
      const decoded = await callFn(id, { data: { tasks } });
      const snapshot = decoded?.result ?? decoded;
      console.log("save via", id.slice(0, 8), "tasks:", snapshot.tasks?.length);
      return;
    } catch {
      // try next
    }
  }

  throw new Error("could not restore — server unreachable or fn ids changed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
