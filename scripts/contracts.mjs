#!/usr/bin/env node
// The vendored API contracts: `sync` copies them from their providers,
// `check` says whether the copy here still matches (exit 1 if not).
//
//   npm run contracts:sync
//   npm run contracts:check
//
// Which contracts, and from where: contracts/vendor/contracts.json. Each one
// is fetched from
//   https://raw.githubusercontent.com/teapot-chess/<repo>/<ref>/priv/contracts/<name>/
// starting with its index.json, which lists every other file. The copy is
// byte-for-byte; nothing is reformatted. CONTRACTS_REF picks another branch
// than main (a provider's PR, say). Plain fetch, Node 18+, no dependencies.

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = join(ROOT, "contracts", "vendor");
const REF = process.env.CONTRACTS_REF || "main";

const mode = process.argv[2];
if (mode !== "sync" && mode !== "check") {
  console.error("usage: node scripts/contracts.mjs sync|check");
  process.exit(2);
}

const sourceUrl = (c) => `https://raw.githubusercontent.com/teapot-chess/${c.repo}/${REF}/priv/contracts/${c.name}/`;
const localDir = (c) => join(VENDOR, c.repo.toLowerCase(), c.name);

async function fetchBytes(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { "cache-control": "no-cache" } });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      lastError = new Error(`${url}: HTTP ${response.status}`);
      if (response.status === 404) break;
    } catch (error) {
      lastError = new Error(`${url}: ${error.message}`);
    }
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
  throw lastError;
}

// Every file under a directory, as forward-slash paths relative to it.
async function listLocal(dir) {
  const out = [];
  async function walk(d) {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else out.push(relative(dir, full).split(sep).join("/"));
    }
  }
  await walk(dir);
  return out.sort();
}

async function readLocal(path) {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

// What a changed file changed, in a few lines: the first lines that differ.
function lineDiff(before, after, max = 6) {
  const a = before.toString("utf8").split("\n");
  const b = after.toString("utf8").split("\n");
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n && out.length < max; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push(`      ${i + 1}- ${a[i].trim()}`);
    if (b[i] !== undefined) out.push(`      ${i + 1}+ ${b[i].trim()}`);
  }
  return out;
}

async function fetchContract(c) {
  const base = sourceUrl(c);
  const indexBytes = await fetchBytes(base + "index.json");
  const index = JSON.parse(indexBytes.toString("utf8"));
  if (!Array.isArray(index.files)) throw new Error(`${base}index.json has no "files" list`);
  for (const f of index.files) {
    if (typeof f !== "string" || f.startsWith("/") || f.split("/").includes("..")) throw new Error(`${base}index.json lists a path it should not: ${f}`);
  }
  const files = new Map([["index.json", indexBytes]]);
  // A handful at a time: raw.githubusercontent.com does not love a stampede.
  const queue = [...index.files];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (queue.length) {
        const f = queue.shift();
        files.set(f, await fetchBytes(base + f));
      }
    }),
  );
  return files;
}

const contracts = JSON.parse(await readFile(join(VENDOR, "contracts.json"), "utf8"));
let drift = false;

for (const c of contracts) {
  const dir = localDir(c);
  const label = `${c.repo}/${c.name}`;
  const remote = await fetchContract(c);
  const local = await listLocal(dir);

  const added = [...remote.keys()].filter((f) => !local.includes(f)).sort();
  const removed = local.filter((f) => !remote.has(f));
  const changed = [];
  for (const f of local) {
    if (!remote.has(f)) continue;
    const mine = await readLocal(join(dir, f));
    if (!mine || !mine.equals(remote.get(f))) changed.push(f);
  }

  if (mode === "sync") {
    for (const f of removed) await rm(join(dir, f));
    for (const [f, bytes] of remote) {
      await mkdir(dirname(join(dir, f)), { recursive: true });
      await writeFile(join(dir, f), bytes);
    }
    const total = added.length + removed.length + changed.length;
    console.log(
      total === 0
        ? `${label}: already current (${remote.size} files).`
        : `${label}: ${added.length} added, ${removed.length} removed, ${changed.length} changed (${remote.size} files).`,
    );
    for (const f of added) console.log(`  + ${f}`);
    for (const f of removed) console.log(`  - ${f}`);
    for (const f of changed) console.log(`  ~ ${f}`);
    continue;
  }

  if (added.length + removed.length + changed.length === 0) {
    console.log(`${label}: matches ${sourceUrl(c)} (${remote.size} files).`);
    continue;
  }

  drift = true;
  console.log(`${label}: DIFFERS from ${sourceUrl(c)}`);
  for (const f of added) console.log(`  + ${f}   (new upstream, not vendored)`);
  for (const f of removed) console.log(`  - ${f}   (vendored, gone upstream)`);
  for (const f of changed) {
    console.log(`  ~ ${f}`);
    for (const line of lineDiff((await readLocal(join(dir, f))) ?? Buffer.alloc(0), remote.get(f))) console.log(line);
  }
}

if (drift) {
  console.log("\nThe provider changed its contract. Run `npm run contracts:sync`, then `npm test`:");
  console.log("whatever the tests then say is what the app has to catch up with.");
  process.exit(1);
}
