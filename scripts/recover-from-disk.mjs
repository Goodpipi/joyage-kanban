import { fromCrossJSON, toJSONAsync } from "seroval";

const BASE = process.env.KANBAN_URL ?? "https://joyage-kanban.onrender.com";

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

async function callFn(fnId, payload = {}) {
  const body = JSON.stringify(await toJSONAsync(payload));
  const res = await fetch(`${BASE}/_serverFn/${fnId}`, {
    method: "POST",
    headers: { "x-tsr-serverFn": "true", "Content-Type": "application/json" },
    signal: AbortSignal.timeout(120_000),
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fnId} failed ${res.status}: ${text.slice(0, 400)}`);
  return fromCrossJSON(JSON.parse(text), { plugins: [] });
}

async function findFnId(label) {
  const ids = await fetchBundleIds();
  const html = await fetch(BASE, { signal: AbortSignal.timeout(120_000) }).then((r) => r.text());
  const assets = [...new Set(html.match(/\/assets\/index-[^"]+\.js/g) ?? [])];
  for (const asset of assets) {
    const js = await fetch(BASE + asset, { signal: AbortSignal.timeout(120_000) }).then((r) => r.text());
    if (!js.includes(label)) continue;
    const idx = js.indexOf(label);
    const slice = js.slice(idx, idx + 200);
    const m = slice.match(/[a-f0-9]{64}/);
    if (m) return m[0];
  }
  return ids.find((id) => id.startsWith("scan")) ?? null;
}

async function main() {
  console.log("Scanning", BASE);

  const scanId = await findFnId("scanKanbanDiskFn");
  const recoverId = await findFnId("recoverKanbanFromDiskFn");

  if (!scanId || !recoverId) {
    throw new Error("scan/recover API not deployed yet — push and wait for Render deploy first");
  }

  const scan = await callFn(scanId);
  const scanned = scan?.result ?? scan;
  console.log("\nDisk snapshots found:");
  for (const row of scanned) {
    console.log(`  ${row.taskCount} tasks | ${row.updatedAt} | ${row.source} | ${row.bytes} bytes`);
  }

  const best = scanned[0];
  if (!best || best.taskCount === 0) {
    throw new Error("No snapshots with tasks found on server disk");
  }

  console.log(`\nRecovering best snapshot (${best.taskCount} tasks from ${best.source})...`);
  const recovered = await callFn(recoverId);
  const result = recovered?.result ?? recovered;
  const snapshot = result.restored ?? result;
  console.log("Restored:", snapshot.tasks?.length, "tasks");
  console.log("Picked from:", result.pickedFrom);
  if (snapshot.tasks?.length) {
    console.log("\nTask list:");
    for (const t of snapshot.tasks) {
      console.log(`  ${t.code ?? "?"} | ${t.column} | ${t.title} | ${t.assignee}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
