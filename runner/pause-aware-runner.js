// runner/pause-aware-runner.js
// Pause-aware job runner that supports workflow graphs coming from:
// - payload.workflow / payload.workflow_json
// - job.workflow / job.workflow_json
// - payload.params / payload.params_json
// - job.params / job.params_json
// Accepts arrays as shorthand for { nodes: [...], links: [] }.
// Adds strong debugging + handler resolution tracing.

import fetch from "node-fetch"; // Node < 18; remove and use global fetch on Node >= 18
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

/* =============================================================================
   Config + Debug
   ============================================================================= */
const BASE = process.env.YOLANDI_API; // e.g., https://yoursite.com/wp-json/yolandi/v1
const H = { "Content-Type": "application/json" /* + your auth/HMAC headers if any */ };
const NODES_DIR =
  "C:/wnmp/nginx/www/yolandi.org/wp-content/plugins/yolandi/nodes" || process.env.YOLANDI_NODES_DIR ||
  path.resolve(process.cwd(), "nodes"); // default per YOLANDI project notes

const DBG = !!Number(process.env.YOLANDI_DEBUG || process.env.DEBUG || 0);
const TRACE = !!Number(process.env.YOLANDI_TRACE || 0);

const now = () => new Date().toISOString().replace("T", " ").replace("Z", "");
const dlog = (...args) => DBG && console.log(`[${now()}]`, ...args);
const tlog = (...args) => TRACE && console.log(`[${now()}][trace]`, ...args);

/* =============================================================================
   Helpers
   ============================================================================= */
function redactDeep(val) {
  const SECRET_KEYS = /pass(word)?|token|secret|api[_-]?key|authorization|cookie|hmac|bearer/i;
  if (val == null) return val;
  if (typeof val === "string") return val.length > 4096 ? val.slice(0, 4096) + "…" : val;
  if (Array.isArray(val)) return val.map(redactDeep);
  if (typeof val === "object") {
    const out = Array.isArray(val) ? [] : {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = SECRET_KEYS.test(k) ? "***REDACTED***" : redactDeep(v);
    }
    return out;
  }
  return val;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function summarizePayload(p = {}) {
  const keys = Object.keys(p);
  const mode = p.mode || (p.code ? "code" : "module");
  const hints = {
    hasWorkflow: !!p.workflow,
    hasWorkflowJson: !!p.workflow_json,
    hasParams: !!p.params,
    hasParamsJson: !!p.params_json,
    hasCode: !!p.code,
    hasFile: !!p.file,
  };
  let wfHint = null;
  try {
    const { wf } = resolveWorkflow({ payload: p }, true);
    if (wf) wfHint = { nodes: wf.nodes?.length || 0, links: (wf.links || []).length || 0 };
  } catch {}
  return { keys, mode, ...hints, wfHint };
}

/* =============================================================================
   REST helpers
   ============================================================================= */
async function lease(runnerId, leaseSeconds = 90) {
  const body = JSON.stringify({ runner_id: runnerId, lease_seconds: leaseSeconds });
  const r = await fetch(`${BASE}/jobs/lease`, { method: "POST", headers: H, body });
  if (r.status === 204) return null;
  if (!r.ok) throw new Error(`lease ${r.status}`);
  const ct = r.headers.get("content-type") || "";
  const json = ct.includes("json") ? await r.json().catch(() => null) : null;
  if (DBG) dlog(`[lease] ${r.status} ${r.statusText}`, json ? `(job id ${json?.id})` : "(no json)");
  return json;
}

async function heartbeat(id, runnerId, leaseSeconds = 90) {
  const r = await fetch(`${BASE}/jobs/${id}/heartbeat`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ runner_id: runnerId, lease_seconds: leaseSeconds }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`heartbeat ${r.status}`);
  if (DBG && j?.control) dlog(`[heartbeat] job ${id} control=${j.control}`);
  return j;
}

async function report(id, runnerId, status, payload = {}) {
  const safe = redactDeep(payload);
  if (DBG) dlog(`[report] job ${id} status=${status}`, safe);
  const res = await fetch(`${BASE}/jobs/${id}/report`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ runner_id: runnerId, status, ...payload }),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`report ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return {}; }
}

/* =============================================================================
   Pause helpers
   ============================================================================= */
async function waitWhilePaused(jobId, runnerId) {
  for (;;) {
    const hb = await heartbeat(jobId, runnerId, 90);
    if (hb?.control === "resume" || !hb?.control) break;
    await sleep(10_000);
  }
}
async function checkPause(jobId, runnerId) {
  const hb = await heartbeat(jobId, runnerId, 90);
  if (hb?.control === "pause") {
    dlog(`Job #${jobId} pause requested; idling…`);
    await waitWhilePaused(jobId, runnerId);
    dlog(`Job #${jobId} resumed.`);
  }
}

/* =============================================================================
   FS helpers for node discovery
   ============================================================================= */
async function fileExists(p) { try { await fs.stat(p); return true; } catch { return false; } }
async function listMjsRecursive(dir, acc = []) {
  let entries = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) await listMjsRecursive(abs, acc);
    else if (e.isFile() && e.name.endsWith(".mjs")) acc.push(abs);
  }
  return acc;
}

/* =============================================================================
   Handler resolution
   ============================================================================= */
const handlerCache = new Map();
const typeToPathCache = new Map();

function toSlug(s) {
  return String(s).replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

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
    path.join(NODES_DIR, dir, `${nameJoinSlash}.mjs`),
    path.join(NODES_DIR, dir, `${nameJoinSlashLower}.mjs`),
  ];

  for (const p of candidates) {
    if (await fileExists(p)) {
      tlog(`[resolve] ${type} → ${p}`);
      return p;
    }
    tlog(`[resolve miss] ${type} ! ${p}`);
  }
  return null;
}

async function importModuleAt(absPath) {
  const url = pathToFileURL(absPath).href + `?t=${Date.now()}`; // cache-bust
  return import(url);
}

async function discoverByScanning(type) {
  const files = await listMjsRecursive(NODES_DIR);
  tlog(`[scan] scanning ${files.length} .mjs under ${NODES_DIR}`);
  for (const f of files) {
    try {
      const mod = await importModuleAt(f);
      const t = mod?.meta?.type || mod?.type;
      if (typeof t === "string") typeToPathCache.set(t, f);
      if (t === type && typeof mod?.run === "function") {
        handlerCache.set(type, mod);
        tlog(`[scan hit] ${type} at ${f}`);
        return mod;
      }
    } catch (e) {
      tlog(`[scan err] ${f}: ${e?.message || e}`);
    }
  }
  return null;
}

async function resolveHandler(type) {
  if (handlerCache.has(type)) return handlerCache.get(type);
  if (typeToPathCache.has(type)) {
    const p = typeToPathCache.get(type);
    const mod = await importModuleAt(p);
    handlerCache.set(type, mod);
    return mod;
  }
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
  const mod = await discoverByScanning(type);
  if (mod) return mod;

  const near = [...typeToPathCache.keys()]
    .filter((k) => k.split(".")[0] === type.split(".")[0])
    .slice(0, 10);
  throw new Error(`Handler not found for type "${type}" under ${NODES_DIR}. Near: ${near.join(", ") || "(none)"}`);
}

/* =============================================================================
   Workflow detection + normalization
   ============================================================================= */
function normalizeLinksShape(wf) {
  const raw = wf.links || wf.edges || wf.connections || wf.wires || [];
  if (raw.length && raw[0]?.from && raw[0]?.to) { wf.links = raw; return wf; }
  wf.links = raw.map((l) => {
    if (l.from && l.to) return l;
    if (l.source && l.target) {
      return { from: { nid: l.source.nid, pid: l.source.pid }, to: { nid: l.target.nid, pid: l.target.pid } };
    }
    return {
      from: { nid: l.fromId ?? l.srcId ?? l.sourceId, pid: l.fromPort ?? l.srcPid ?? l.sourcePid },
      to: { nid: l.toId ?? l.dstId ?? l.targetId, pid: l.toPort ?? l.dstPid ?? l.targetPid },
    };
  });
  return wf;
}

function resolveWorkflow(job, silent = false) {
  const payload = job?.payload || {};
  const candidates = [
    { v: payload.workflow, src: "payload.workflow" },
    { v: payload.workflow_json, src: "payload.workflow_json" },
    { v: job.workflow, src: "job.workflow" },
    { v: job.workflow_json, src: "job.workflow_json" },
    { v: payload.params, src: "payload.params" },
    { v: payload.params_json, src: "payload.params_json" },
    { v: job.params, src: "job.params" },
    { v: job.params_json, src: "job.params_json" },
  ];

  for (const { v, src } of candidates) {
    if (v == null) continue;

    let wf = v;
    if (typeof wf === "string") {
      try { wf = JSON.parse(wf); }
      catch (e) { if (!silent) throw new Error(`Invalid JSON in ${src}: ${e.message}`); else continue; }
    }

    if (Array.isArray(wf)) wf = { version: 1, nodes: wf, links: [] };

    if (wf && typeof wf === "object" && Array.isArray(wf.nodes)) {
      return { wf: normalizeLinksShape(wf), source: src };
    }
  }
  return { wf: null, source: null };
}

/* =============================================================================
   Graph executor (single shared context)
   ============================================================================= */
function buildGraph(wf) {
  const nodes = new Map();
  for (const n of wf.nodes || []) nodes.set(n.id, n);

  const incoming = new Map();
  const outgoing = new Map();
  const indegree = new Map();

  for (const n of nodes.values()) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
    indegree.set(n.id, 0);
  }

  for (const l of wf.links || []) {
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
  for (const o of objs) if (o && typeof o === "object") Object.assign(base, o);
  return base;
}

async function execWorkflow(job, runnerId, sharedCtx) {
  // Resolve the workflow from the job
  const { wf, source } = resolveWorkflow(job);
  if (!wf || !Array.isArray(wf.nodes)) {
    const summary = summarizePayload(job.payload || {});
    await report(job.id, runnerId, "failed", {
      reason: "workflow_missing_or_invalid",
      summary,
    });
    throw new Error("Missing workflow graph: expected nodes[] in payload.workflow / workflow_json / params / params_json");
  }

  if (DBG) {
    const peek = (wf.nodes || []).slice(0, 3).map(n => ({ id: n.id, title: n.title, type: n.type }));
    dlog(`[graph] src=${source} nodes=${wf.nodes?.length || 0} links=${wf.links?.length || 0}`, peek);
  }

  // Mutate shared ctx once so every node sees the same reference
  const payload = job.payload || {};
  sharedCtx.job = job;
  sharedCtx.runnerId = runnerId;
  sharedCtx.env = Object.assign({}, process.env, payload.env || {});
  sharedCtx.settings = payload.settings || {};
  sharedCtx.bag = sharedCtx.bag || {};

  // convenience helpers bound to this job
  sharedCtx.waitWhilePaused = () => waitWhilePaused(job.id, runnerId);
  sharedCtx.checkPause      = () => checkPause(job.id, runnerId);
  sharedCtx.heartbeat       = (leaseSeconds = 90) => heartbeat(job.id, runnerId, leaseSeconds);
  sharedCtx.report          = (status, extra = {}) => report(job.id, runnerId, status, extra);
  sharedCtx.log             = async (level, message, extra = {}) => report(job.id, runnerId, "progress", { level, message, ...extra });

  const { nodes, incoming, outgoing, indegree } = buildGraph(wf);

  // Topo queue
  const q = [];
  const inPackets = new Map();
  const inByPort = new Map();
  const receivedFrom = new Map();

  for (const [nid, deg] of indegree.entries()) {
    if (deg === 0) q.push(nid);
    inPackets.set(nid, []);
    inByPort.set(nid, Object.create(null));
  }
  for (const nid of nodes.keys()) receivedFrom.set(nid, 0);

  let lastPacket = {};

  while (q.length) {
    const nid = q.shift();
    const node = nodes.get(nid);
    const inboundPackets = inPackets.get(nid) || [];
    const inboundByPort = inByPort.get(nid) || {};

    await sharedCtx.checkPause();

    await sharedCtx.report("progress", {
      artifacts: {
        event: "node_start",
        nodeId: nid,
        nodeType: node.type,
        title: node.title,
      },
    });

    let mod = null;
    try {
      mod = await resolveHandler(node.type);
    } catch (e) {
      await sharedCtx.report("failed", {
        event: "handler_missing",
        nodeId: nid,
        nodeType: node.type,
        error: { message: String(e?.message || e) },
      });
      throw e;
    }

    if (typeof mod?.run !== "function") {
      const msg = `Handler for ${node.type} does not export a 'run' function`;
      await sharedCtx.report("failed", { event: "handler_invalid", nodeId: nid, nodeType: node.type, error: { message: msg } });
      throw new Error(msg);
    }

    const mergedIn = mergePackets(...inboundPackets);
    let result = null;

    try {
      if (TRACE) tlog(`[node] ${node.type} (${node.title || nid}) in:`, redactDeep({ packet: mergedIn, fields: node.fields || {} }));

      // Preferred calling convention
      try {
        result = await mod.run({ packet: mergedIn, fields: node.fields || {} }, sharedCtx);
      } catch (ePrimary) {
        // Fallback for legacy nodes: run(ctx, fields)
        result = await mod.run(sharedCtx, node.fields || {});
      }

      if (TRACE) tlog(`[node] ${node.type} out:`, redactDeep(result));
    } catch (err) {
      await sharedCtx.report("failed", {
        event: "node_error",
        nodeId: nid,
        nodeType: node.type,
        error: { message: String(err?.message || err) },
      });
      throw err;
    }

    const packetDelta = result?.packet ?? result?.packetDelta ?? {};
    const mergedOut = mergePackets(mergedIn, packetDelta);
    lastPacket = mergedOut;

    const outs = outgoing.get(nid) || [];
    const outputsMap = (result && typeof result === "object" && result.outputs) || null;

    for (const link of outs) {
      const toId = link.to?.nid;
      const toPid = link.to?.pid;
      const fromPid = link.from?.pid;

      let outPacket = mergedOut;
      if (outputsMap) {
        const byId = outputsMap[fromPid];
        let byName = null;
        try {
          const name = node.outputs?.find((o) => o.id === fromPid)?.name;
          byName = name ? outputsMap[name] : null;
        } catch {}
        outPacket = byId ?? byName ?? mergedOut;
      }

      if (!inPackets.has(toId)) inPackets.set(toId, []);
      if (!inByPort.has(toId)) inByPort.set(toId, Object.create(null));
      inPackets.get(toId).push(outPacket);
      inByPort.get(toId)[toPid] = outPacket;

      receivedFrom.set(toId, (receivedFrom.get(toId) || 0) + 1);
      const need = incoming.get(toId)?.length || 0;
      if (receivedFrom.get(toId) === need) q.push(toId);
    }

    await sharedCtx.report("progress", {
      artifacts: {
        event: "node_done",
        nodeId: nid,
        nodeType: node.type,
        title: node.title,
      },
    });
  }

  // Best-effort cleanup (nodes can also register sharedCtx.onCleanup)
  await gracefulCleanup(sharedCtx.bag, sharedCtx);

  return { packet: lastPacket, ctx: sharedCtx };
}

async function gracefulCleanup(bag, sharedCtx) {
  try {
    if (bag?.page && typeof bag.page.close === "function") await bag.page.close().catch(() => {});
    if (bag?.context && typeof bag.context.close === "function") await bag.context.close().catch(() => {});
    if (bag?.browser && typeof bag.browser.close === "function") await bag.browser.close().catch(() => {});
    await runCleanup(sharedCtx);
  } catch {}
}

/* =============================================================================
   Module/code executor (legacy)
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
      throw new Error(`Export "${exportName}" not found or not a function. Exports: ${keys.join(", ") || "(none)"}`);
    }
    const oldEnv = process.env;
    try { process.env = env; return await fn(ctx, ...args); }
    finally { process.env = oldEnv; }
  };

  if (mode === "module") {
    if (!payload.file) throw new Error(`payload.file is required for mode "module"`);
    const abs = payload.file.startsWith("file://")
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
   Shared ctx factory + cleanup
   ============================================================================= */
function createSharedCtx(job) {
  const cleanup = [];
  return {
    job,
    jobId: job?.id,
    startedAt: Date.now(),
    env: process.env,
    cleanup,
    onCleanup(fn) { if (typeof fn === "function") cleanup.push(fn); }
  };
}

async function runCleanup(ctx) {
  if (!ctx?.cleanup?.length) return;
  // LIFO is safer for dependent cleanups
  for (let i = ctx.cleanup.length - 1; i >= 0; i--) {
    const fn = ctx.cleanup[i];
    try { await fn?.(); } catch {}
  }
  ctx.cleanup.length = 0;
}

/* =============================================================================
   Main loop
   ============================================================================= */
async function runJob(job, runnerId) {
  const id = job.id;
  dlog(`Running #${id} (${job.script_slug}@${job.script_version})`);

  const hbLoop = setInterval(() => {
    heartbeat(id, runnerId, 90)
      .then((hb) => { if (hb?.control === "pause") dlog(`Job #${id} → server requested PAUSE`); })
      .catch((e) => console.error("heartbeat err", e.message));
  }, 15_000);

  const startedAt = Date.now();
  const sharedCtx = createSharedCtx(job);

  try {
    const first = await heartbeat(id, runnerId, 90);
    if (first?.control === "pause") {
      dlog(`Job #${id} initial pause; idling…`);
      await waitWhilePaused(id, runnerId);
      dlog(`Job #${id} resumed.`);
    }

    if (DBG) {
      dlog(`[job] leased id=${job.id}`, {
        has_job_workflow: !!job.workflow,
        has_job_workflow_json: !!job.workflow_json,
        has_job_params: !!job.params,
        has_job_params_json: !!job.params_json,
        payload_keys: Object.keys(job.payload || {}),
      });
      dlog(`[payload]`, redactDeep(summarizePayload(job.payload || {})));
    }

    const detected = resolveWorkflow(job, true);
    const mode =
      job.payload?.mode ||
      (detected.wf ? "workflow" : (job.payload?.code ? "code" : "module"));

    if (DBG && detected.wf) {
      dlog(`[workflow] using ${detected.source} (nodes=${detected.wf.nodes?.length || 0}, links=${detected.wf.links?.length || 0})`);
    }

    if (mode === "workflow") {
      await execWorkflow(job, runnerId, sharedCtx);
    } else {
      await execModuleOrCode(job, runnerId);
    }

    await report(id, runnerId, "succeeded", { run_ms: Date.now() - startedAt });
  } catch (err) {
    console.error(err);
    await report(id, runnerId, "failed", { error: { message: String(err?.message || err) } });
  } finally {
    clearInterval(hbLoop);
    await runCleanup(sharedCtx);
  }
}

async function main() {
  const runnerId = process.env.YOLANDI_RUNNER_ID || `runner-${Math.random().toString(36).slice(2)}`;
  if (!BASE) {
    console.error("YOLANDI_API env var is required (e.g., https://yoursite.com/wp-json/yolandi/v1)");
    process.exit(1);
  }
  console.log(`[YOLANDI Runner] nodes dir = ${NODES_DIR}`);
  let idle = 0;

  for (;;) {
    const job = await lease(runnerId).catch((e) => (console.error("lease err", e), null));
    if (!job) {
      idle++;
      if (DBG && idle % 15 === 0) dlog(`[idle] no jobs yet (${idle} ticks)`);
      await sleep(2000);
      continue;
    }
    idle = 0;
    await runJob(job, runnerId);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
