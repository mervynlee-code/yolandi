// runner/pause-aware-runner.js
import fetch from "node-fetch";                 // Node < 18: keep; Node >= 18: you can remove and use global fetch
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

/* =============================================================================
   Config
   ============================================================================= */
const BASE = process.env.YOLANDI_API; // e.g., https://yolandi.org/wp-json/yolandi/v1
const H = { "Content-Type": "application/json" /* + your HMAC header(s) */ };

// Where .mjs node handlers live (recursive)
const NODES_DIR =
  process.env.YOLANDI_NODES_DIR ||
  path.resolve(process.cwd(), "nodes"); // default: /wp-content/plugins/yolandi/nodes per project notes

/* =============================================================================
   REST helpers
   ============================================================================= */
async function lease(runnerId, leaseSeconds = 90) {
  const r = await fetch(`${BASE}/jobs/lease`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ runner_id: runnerId, lease_seconds: leaseSeconds }),
  });
  console.log(r)
  if (r.status === 204) return null;
  if (!r.ok) throw new Error(`lease ${r.status}`);
  return r.json();
}
async function heartbeat(id, runnerId, leaseSeconds = 90) {
  const r = await fetch(`${BASE}/jobs/${id}/heartbeat`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ runner_id: runnerId, lease_seconds: leaseSeconds }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`heartbeat ${r.status}`);
  return j; // may include { control: 'pause'|'resume' }
}
async function report(id, runnerId, status, payload = {}) {
  const r = await fetch(`${BASE}/jobs/${id}/report`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ runner_id: runnerId, status, ...payload }),
  });
  if (!r.ok) throw new Error(`report ${r.status}`);
  return r.json().catch(() => ({}));
}

/* =============================================================================
   Pause helpers
   ============================================================================= */
async function waitWhilePaused(jobId, runnerId) {
  // simple polling; server decides when to resume
  // keep the lease alive by passing leaseSeconds in heartbeat
  for (;;) {
    const hb = await heartbeat(jobId, runnerId, 90);
    if (hb?.control === "resume" || !hb?.control) break;
    await sleep(10_000);
  }
}
async function checkPause(jobId, runnerId) {
  const hb = await heartbeat(jobId, runnerId, 90);
  if (hb?.control === "pause") {
    console.log(`Job #${jobId} pause requested; idling…`);
    await waitWhilePaused(jobId, runnerId);
    console.log(`Job #${jobId} resumed.`);
  }
}

/* =============================================================================
   FS utils
   ============================================================================= */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fileExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}
async function listMjsRecursive(dir, acc = []) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      await listMjsRecursive(abs, acc);
    } else if (e.isFile() && e.name.endsWith(".mjs")) {
      acc.push(abs);
    }
  }
  return acc;
}

/* =============================================================================
   Handler resolution (dot-notation → .mjs module with meta.type & run)
   ============================================================================= */
const handlerCache = new Map();      // type → module namespace
const typeToPathCache = new Map();   // type → absolute path

function toSlug(s) {
  return String(s)
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/**
 * Try canonical paths first:
 *   type "Puppeteer.OpenAI"
 *      dir      = "puppeteer"
 *      leaf(s)  = ["OpenAI"] (could be nested like A.B.C)
 *   candidates:
 *     /nodes/puppeteer/OpenAI.mjs
 *     /nodes/puppeteer/openai.mjs
 *     /nodes/puppeteer/open-ai.mjs
 *     /nodes/puppeteer/A/B/C.mjs (for multi-part)
 *     /nodes/puppeteer/a/b/c.mjs
 *     /nodes/puppeteer/a-b-c.mjs
 */
async function findByCanonicalPaths(type) {
  const parts = String(type).split(".");
  if (parts.length < 2) return null;

  const dir = parts[0].toLowerCase();
  const rest = parts.slice(1);

  const nameJoinDot = rest.join(".");
  const nameJoinSlash = rest.join("/");
  const nameJoinSlashLower = rest.map((p) => p.toLowerCase()).join("/");
  const slug = toSlug(rest.join("-"));

  const candidates = [
    path.join(NODES_DIR, dir, `${nameJoinDot}.mjs`),
    path.join(NODES_DIR, dir, `${nameJoinDot.toLowerCase()}.mjs`),
    path.join(NODES_DIR, dir, `${slug}.mjs`),
    path.join(NODES_DIR, dir, `${rest.slice(-1)[0]}.mjs`),
    path.join(NODES_DIR, dir, `${rest.slice(-1)[0].toLowerCase()}.mjs`),
    path.join(NODES_DIR, dir, nameJoinSlash + ".mjs"),
    path.join(NODES_DIR, dir, nameJoinSlashLower + ".mjs"),
  ];

  for (const p of candidates) {
    if (await fileExists(p)) return p;
  }
  return null;
}

async function importModuleAt(absPath) {
  const url = pathToFileURL(absPath).href + `?t=${Date.now()}`; // bust cache per run
  return import(url);
}

async function discoverByScanning(type) {
  const files = await listMjsRecursive(NODES_DIR);
  // quick path: if we saw it recently
  for (const f of files) {
    try {
      const mod = await importModuleAt(f);
      const t = mod?.meta?.type || mod?.type;
      if (typeof t === "string") typeToPathCache.set(t, f);
      if (t === type && typeof mod?.run === "function") {
        handlerCache.set(type, mod);
        return mod;
      }
    } catch {
      // ignore broken/foreign modules
    }
  }
  return null;
}

async function resolveHandler(type) {
  if (handlerCache.has(type)) return handlerCache.get(type);

  // if we already mapped type → path, import directly
  if (typeToPathCache.has(type)) {
    const p = typeToPathCache.get(type);
    const mod = await importModuleAt(p);
    handlerCache.set(type, mod);
    return mod;
  }

  // Try canonical file paths first
  const p = await findByCanonicalPaths(type);
  if (p) {
    const mod = await importModuleAt(p);
    const t = mod?.meta?.type || mod?.type;
    if (t === type && typeof mod?.run === "function") {
      typeToPathCache.set(type, p);
      handlerCache.set(type, mod);
      return mod;
    }
  }

  // Fall back to scanning /nodes
  const mod = await discoverByScanning(type);
  if (mod) return mod;

  throw new Error(`Handler not found for type "${type}" under ${NODES_DIR}`);
}

/* =============================================================================
   Workflow executor (pause-aware, serial topo order)
   ============================================================================= */
function buildGraph(workflow) {
  const nodes = new Map();
  for (const n of workflow.nodes || []) nodes.set(n.id, n);

  const incoming = new Map(); // nid → links[]
  const outgoing = new Map(); // nid → links[]
  const indegree = new Map(); // nid → number

  for (const n of nodes.values()) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
    indegree.set(n.id, 0);
  }

  for (const l of workflow.links || []) {
    const fromId = l.from?.nid;
    const toId = l.to?.nid;
    if (!nodes.has(fromId) || !nodes.has(toId)) continue;
    outgoing.get(fromId).push(l);
    incoming.get(toId).push(l);
    indegree.set(toId, (indegree.get(toId) || 0) + 1);
  }

  return { nodes, incoming, outgoing, indegree };
}

function mergePackets(...objs) {
  const base = {};
  for (const o of objs) {
    if (o && typeof o === "object") Object.assign(base, o);
  }
  return base;
}

async function execWorkflow(job, runnerId) {
  const payload = job.payload || {};
  const wf = payload.workflow;
  if (!wf || !Array.isArray(wf.nodes)) {
    throw new Error("payload.workflow is required and must contain nodes[]");
  }
  const env = Object.assign({}, process.env, payload.env || {});
  const settings = payload.settings || {};

  // Shared bag across handlers (e.g., puppeteer browser/page/context, OpenAI client, etc.)
  const bag = {};

  // Per-node inbound accumulation
  const inPackets = new Map(); // nid → array of packets from upstream
  const inByPort = new Map();  // nid → { [portId]: packet }

  const ctxBase = {
    job,
    runnerId,
    env,
    settings,
    bag,
    waitWhilePaused: () => waitWhilePaused(job.id, runnerId),
    checkPause: () => checkPause(job.id, runnerId),
    heartbeat: (leaseSeconds = 90) => heartbeat(job.id, runnerId, leaseSeconds),
    report: (status, extra = {}) => report(job.id, runnerId, status, extra),
    log: async (level, message, extra = {}) =>
      report(job.id, runnerId, "progress", { level, message, ...extra }),
  };

  const { nodes, incoming, outgoing, indegree } = buildGraph(wf);

  // Queue starts with all indegree==0 nodes
  const q = [];
  for (const [nid, deg] of indegree.entries()) {
    if (deg === 0) q.push(nid);
    inPackets.set(nid, []);
    inByPort.set(nid, Object.create(null));
  }

  // Track how many upstreams have emitted into a node
  const receivedFrom = new Map(); // nid → count
  for (const nid of nodes.keys()) receivedFrom.set(nid, 0);

  // Serial execution (simple & deterministic)
  while (q.length) {
    const nid = q.shift();
    const node = nodes.get(nid);
    const inboundPackets = inPackets.get(nid) || [];
    const inboundByPort = inByPort.get(nid) || {};

    // Pause check before each node
    await ctxBase.checkPause();

    await ctxBase.report("progress", {
      nodeId: nid,
      nodeType: node.type,
      title: node.title,
      status: "start",
    });

    // Resolve handler
    const mod = await resolveHandler(node.type);
    if (typeof mod?.run !== "function") {
      throw new Error(`Handler for ${node.type} does not export a 'run' function`);
    }

    // Node context
    const mergedPacket = mergePackets(...inboundPackets);
    const nodeCtx = {
      ...ctxBase,
      node,
      fields: node.fields || {},
      packet: mergedPacket,
      inPackets: inboundPackets,
      inByPort: inboundByPort,
    };

    // Execute node
    let result = null;
    try {
      result = await mod.run(nodeCtx);
    } catch (err) {
      await ctxBase.report("failed", {
        nodeId: nid,
        nodeType: node.type,
        error: { message: String(err?.message || err) },
      });
      throw err;
    }

    // Normalize result
    const packetDelta = result?.packet ?? result?.packetDelta ?? {};
    const mergedOut = mergePackets(mergedPacket, packetDelta);

    // Emit to downstream
    const outs = outgoing.get(nid) || [];
    const outputsMap = (result && typeof result === "object" && result.outputs) || null;

    for (const link of outs) {
      const toId = link.to?.nid;
      const toPid = link.to?.pid;
      const fromPid = link.from?.pid;

      let outPacket = mergedOut;
      if (outputsMap) {
        // allow matching by output port id or name
        outPacket =
          outputsMap[fromPid] ??
          outputsMap[node.outputs?.find((o) => o.id === fromPid)?.name] ??
          mergedOut;
      }

      // Accumulate into downstream node
      if (!inPackets.has(toId)) inPackets.set(toId, []);
      if (!inByPort.has(toId)) inByPort.set(toId, Object.create(null));
      inPackets.get(toId).push(outPacket);
      inByPort.get(toId)[toPid] = outPacket;

      // Book-keeping for readiness
      receivedFrom.set(toId, (receivedFrom.get(toId) || 0) + 1);
      const need = incoming.get(toId)?.length || 0;
      if (receivedFrom.get(toId) === need) q.push(toId);
    }

    await ctxBase.report("progress", {
      nodeId: nid,
      nodeType: node.type,
      title: node.title,
      status: "done",
    });
  }

  // Optional cleanup if handlers left resources in bag
  await gracefulCleanup(bag);
}

async function gracefulCleanup(bag) {
  try {
    // common Puppeteer handles
    if (bag.page && typeof bag.page.close === "function") {
      await bag.page.close().catch(() => {});
    }
    if (bag.context && typeof bag.context.close === "function") {
      await bag.context.close().catch(() => {});
    }
    if (bag.browser && typeof bag.browser.close === "function") {
      await bag.browser.close().catch(() => {});
    }
  } catch {}
}

/* =============================================================================
   Legacy: module/code payloads
   ============================================================================= */
async function execModuleOrCode(job, runnerId) {
  const payload = job.payload || {};
  const mode = payload.mode || (payload.code ? "code" : "module");
  const exportName = payload.export || "default";
  const args = Array.isArray(payload.args) ? payload.args : [];
  const env = Object.assign({}, process.env, payload.env || {});

  const ctx = {
    job,
    runnerId,
    env,
    waitWhilePaused: () => waitWhilePaused(job.id, runnerId),
    checkPause: () => checkPause(job.id, runnerId),
    heartbeat: (leaseSeconds = 90) => heartbeat(job.id, runnerId, leaseSeconds),
    report: (status, extra = {}) => report(job.id, runnerId, status, extra),
  };

  const runExport = async (ns) => {
    const fn = exportName === "default" ? ns.default : ns[exportName];
    if (typeof fn !== "function") {
      const keys = Object.keys(ns);
      throw new Error(
        `Export "${exportName}" not found or not a function. Exports: ${keys.join(", ") || "(none)"}`
      );
    }
    const oldEnv = process.env;
    try {
      process.env = env;
      return await fn(ctx, ...args);
    } finally {
      process.env = oldEnv;
    }
  };

  if (mode === "module") {
    if (!payload.file) throw new Error(`payload.file is required for mode "module"`);
    const abs =
      payload.file.startsWith("file://")
        ? payload.file
        : pathToFileURL(path.isAbsolute(payload.file) ? payload.file : path.resolve(payload.file)).href;
    const mod = await import(abs + `?t=${Date.now()}`);
    return await runExport(mod);
  }
  if (mode === "code") {
    if (!payload.code) throw new Error(`payload.code is required for mode "code"`);
    const base64 = Buffer.from(String(payload.code), "utf8").toString("base64");
    const dataUrl = `data:text/javascript;base64,${base64}`;
    const mod = await import(dataUrl + `#job-${job.id}-${Date.now()}`);
    return await runExport(mod);
  }
  throw new Error(`Unknown payload.mode: ${mode}`);
}

/* =============================================================================
   Job runner & main loop
   ============================================================================= */
async function runJob(job, runnerId) {
  const id = job.id;
  console.log(`Running #${id} (${job.script_slug}@${job.script_version})`);

  const hbLoop = setInterval(() => {
    heartbeat(id, runnerId, 90)
      .then((hb) => {
        if (hb?.control === "pause") {
          console.log(`Job #${id} → server requested PAUSE`);
        }
      })
      .catch((e) => console.error("heartbeat err", e.message));
  }, 15_000);

  const startedAt = Date.now();
  try {
    // initial pause gate
    const first = await heartbeat(id, runnerId, 90);
    if (first?.control === "pause") {
      console.log(`Job #${id} initial pause; idling…`);
      await waitWhilePaused(id, runnerId);
      console.log(`Job #${id} resumed.`);
    }

    const mode = job.payload?.mode || "workflow";
    if (mode === "workflow") {
      await execWorkflow(job, runnerId);
    } else {
      await execModuleOrCode(job, runnerId);
    }

    await report(id, runnerId, "succeeded", { run_ms: Date.now() - startedAt });
  } catch (err) {
    console.error(err);
    await report(id, runnerId, "failed", { error: { message: String(err?.message || err) } });
  } finally {
    clearInterval(hbLoop);
  }
}

async function main() {
  const runnerId = process.env.YOLANDI_RUNNER_ID || `runner-${Math.random().toString(36).slice(2)}`;
  if (!BASE) {
    console.error("YOLANDI_API env var is required (e.g., https://yolandi.org/wp-json/yolandi/v1)");
    process.exit(1);
  }
  console.log(`[YOLANDI Runner] nodes dir = ${NODES_DIR}`);
  for (;;) {
    const job = await lease(runnerId).catch((e) => (console.error("lease err", e), null));
    if (!job) {
      await sleep(2000);
      continue;
    }
    console.log(job)
    await runJob(job, runnerId);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
