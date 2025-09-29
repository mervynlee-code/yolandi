// admin/pages/GraphTab.jsx
import React, { useEffect, useRef, useState } from "react";
import { apiWithTimeout } from "../core/api";

/* ---------------- ensure theme css ---------------- */
async function ensureBaklavaThemeCss(log) {
  const injected = new Set(
    Array.from(document.styleSheets)
      .map((ss) => ss.href || ss.ownerNode?.getAttribute?.("href") || "")
      .filter(Boolean)
  );
  const inject = (href) =>
    new Promise((res, rej) => {
      if (!href) return rej(new Error("no href"));
      if (injected.has(href)) return res(true);
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = () => res(true);
      link.onerror = () => rej(new Error("css load failed: " + href));
      document.head.appendChild(link);
    });

  const tryUrlImport = async (spec) => {
    try {
      const mod = await import(/* @vite-ignore */ `${spec}?url`);
      if (mod?.default) {
        await inject(mod.default);
        log("theme loaded via import", spec);
        return true;
      }
    } catch {}
    return false;
  };

  const pluginBase =
    window?.YOLANDI_BOOT?.pluginUrl?.replace(/\/$/, "") ||
    (() => {
      const scripts = Array.from(document.getElementsByTagName("script"));
      for (const s of scripts) {
        const src = s.getAttribute("src") || "";
        const m = src.match(/^(.*\/wp-content\/plugins\/yolandi)\//);
        if (m) return m[1];
      }
      return "/wp-content/plugins/yolandi";
    })();

  const candidates = [
    "@baklavajs/themes/dist/syrup-dark.css",
    "@baklavajs/themes/dist/classic.css",
  ];

  for (const c of candidates) if (await tryUrlImport(c)) return;

  for (const c of candidates) {
    const direct = `${pluginBase}/node_modules/${c}`;
    try {
      await inject(direct);
      log("theme loaded via direct url", direct);
      return;
    } catch {}
  }

  log("theme not found; applying minimal inline styles");
  const style = document.createElement("style");
  style.textContent = `
    .baklava-editor,.bk-editor{background:#0f172a;color:#e5e7eb;min-height:100%;position:relative}
    .bk-toolbar{background:#0b1220;border-bottom:1px solid #1f2937;padding:6px}
    .bk-btn{background:#111827;border:1px solid #374151;color:#e5e7eb;padding:4px 6px;border-radius:6px}
    .baklava-node,.bk-node{background:#1f2937;border:1px solid #4b5563;border-radius:10px;color:#e5e7eb;min-width:220px}
    .baklava-node .title,.bk-node__title{font-weight:600;color:#fff;padding:6px 8px}
    .bk-interface,.baklava-port{padding:6px 8px}
    .baklava-connection-path,.bk-connection path{stroke:#93c5fd;stroke-width:2px}
    .bk-editor, .bk-editor * { pointer-events: auto; }
    .bk-palette .bk-palette-item { cursor: grab; }
    .bk-palette .bk-palette-item:active { cursor: grabbing; }

    /* Log panel basics */
    #yolandi-graph-log-wrap { display:none; }
    #yolandi-graph-log { background:#0b0f17; color:#d7e3ff; padding:10px; border:1px solid #334155; border-radius:8px; max-height:320px; overflow:auto; }

    /* Modal */
    .y-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999}
    .y-modal{background:#0b0f17;color:#e5edff;border:1px solid #334155;border-radius:10px;max-width:920px;width:92vw;box-shadow:0 10px 30px rgba(0,0,0,.5)}
    .y-modal header{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #334155}
    .y-modal h3{margin:0;font-size:16px}
    .y-modal .body{padding:12px}
    .y-modal textarea{width:100%;min-height:320px;background:#0a0e14;color:#d7e3ff;border:1px solid #475569;border-radius:8px;padding:10px}
    .y-modal .row{display:flex;gap:8px;margin-top:10px}
    .y-modal input[type=text]{flex:1;background:#0a0e14;color:#d7e3ff;border:1px solid #475569;border-radius:6px;padding:8px}
    .y-modal .actions{display:flex;gap:8px;padding:10px 14px;border-top:1px solid #334155;justify-content:flex-end}
  `;
  document.head.appendChild(style);
}

/* ---------------- runtime cfg ---------------- */
const YCFG = window?.YOLANDI_CONFIG || {};
const REST_ROOT = (YCFG.restRoot || "").replace(/\/$/, "");
const DEFAULT_SHOW_PALETTE =
  (YCFG.ui && typeof YCFG.ui.showPalette !== "undefined")
    ? !!YCFG.ui.showPalette
    : true;
const WORKFLOW_SCRIPT_SLUG = YCFG.workflowSlug || "workflow";

/* ---------------- helpers: NONCE + fetch ---------------- */
function withNonce(opts = {}) {
  const headers = new Headers(opts.headers || {});
  if (YCFG.wpRestNonce && !headers.has("X-WP-Nonce")) {
    headers.set("X-WP-Nonce", YCFG.wpRestNonce);
  }
  headers.set("Accept", "application/json");
  return {
    credentials: "same-origin",
    ...opts,
    headers,
  };
}
async function postJSON(url, body) {
  const isForm = body instanceof FormData;
  const opts = withNonce({
    method: "POST",
    body: isForm ? body : JSON.stringify(body || {}),
  });
  if (!isForm) opts.headers.set("Content-Type", "application/json");
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data;
  return data;
}
async function getJSON(url) {
  const res = await fetch(url, withNonce({ method: "GET" }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data;
  return data;
}

/* ---------------- palette + log helpers ---------------- */
function findPaletteEl() {
  return (
    document.querySelector(".baklava-node-palette") ||
    document.querySelector(".bk-palette")
  );
}

function ensureLogWrap() {
  const $ = window.jQuery;
  const palette = findPaletteEl();
  if (!palette) return null;

  let wrap = document.getElementById("yolandi-graph-log-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "yolandi-graph-log-wrap";
    const pre = document.createElement("pre");
    pre.id = "yolandi-graph-log";
    pre.style.whiteSpace = "pre-wrap";
    wrap.appendChild(pre);
    palette.insertAdjacentElement("afterend", wrap);
  }
  return { wrap, pre: wrap.querySelector("#yolandi-graph-log"), palette, $ };
}

function showLog() {
  const obj = ensureLogWrap();
  if (!obj) return;
  const { wrap, palette, $ } = obj;
  if ($) $(palette).slideUp(180, () => $(wrap).slideDown(180));
  else { palette.style.display = "none"; wrap.style.display = "block"; }
}
function hideLog() {
  const obj = ensureLogWrap();
  if (!obj) return;
  const { wrap, palette, $ } = obj;
  if ($) $(wrap).slideUp(180, () => $(palette).slideDown(180));
  else { wrap.style.display = "none"; palette.style.display = ""; }
}
function appendToLog(line) {
  const obj = ensureLogWrap();
  if (!obj) return;
  const { pre } = obj;
  const ts = new Date().toLocaleTimeString();
  pre.textContent += `[${ts}] ${line}\n`;
  pre.scrollTop = pre.scrollHeight;
}

/* ---------------- modal helpers ---------------- */
function openModal({ title, text = "", name = "", showName = false, confirmText = "OK", onConfirm, onClose }) {
  const root = document.createElement("div");
  root.className = "y-modal-backdrop";
  root.innerHTML = `
    <div class="y-modal" role="dialog" aria-modal="true">
      <header><h3>${title}</h3><button class="button button-small" id="y-close">✕</button></header>
      <div class="body">
        ${showName ? `<div class="row"><input type="text" id="y-name" placeholder="Macro name" value="${name.replace(/"/g,'&quot;')}" /></div>` : ``}
        <div class="row"><textarea id="y-text">${String(text).replace(/</g,"&lt;")}</textarea></div>
      </div>
      <div class="actions">
        <button class="button button-secondary" id="y-cancel">Cancel</button>
        <button class="button" id="y-confirm">${confirmText}</button>
      </div>
    </div>
  `;
  const close = () => { root.remove(); onClose && onClose(); };
  root.querySelector("#y-close").onclick = close;
  root.querySelector("#y-cancel").onclick = close;
  root.querySelector("#y-confirm").onclick = async () => {
    const val = root.querySelector("#y-text").value;
    const nm  = showName ? root.querySelector("#y-name").value.trim() : null;
    try { await onConfirm?.(val, nm); } finally { close(); }
  };
  document.body.appendChild(root);
  return root;
}

/* ---------------- component ---------------- */
export default function GraphTab() {
  const mountRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  // runner/poll state
  const pollRef = useRef(null);
  const currentJobRef = useRef(null);
  const pausedRef = useRef(false);
  const pausedState = { value: false };

  // macros list
  const macroNamesRef = useRef([]);

  useEffect(() => {
    let alive = true;
    let cleanup = () => {};
    const log = (...a) => console.log("[YOLANDI Graph]", ...a);

    (async () => {
      try {
        log("start");
        log("fetching /nodes…");
        const nodesList = await apiWithTimeout("/nodes", 15000);
        log("nodes received", Array.isArray(nodesList) ? nodesList.length : nodesList);
        if (!Array.isArray(nodesList)) throw new Error("Nodes endpoint did not return an array");
        if (!alive) return;

        // macros list (optional endpoint)
        try {
          const list = await getJSON(`${REST_ROOT}/macros`);
          if (Array.isArray(list)) macroNamesRef.current = list.map(x => String(x.name || x)).filter(Boolean);
        } catch {}

        log("importing vue/renderer/baklava…");
        const vue = await import("vue");
        const rv = await import("@baklavajs/renderer-vue");
        const bk = await import("baklavajs");

        await ensureBaklavaThemeCss(log);

        // host
        let tries = 0;
        while (alive && !mountRef.current && tries < 10) {
          await new Promise((r) => requestAnimationFrame(r));
          tries++;
        }
        if (!alive) return;
        const root = mountRef.current;
        if (!root) {
          setError("Graph host not found");
          setStatus("error");
          return;
        }
        const host = document.createElement("div");
        Object.assign(host.style, {
          height: "640px",
          border: "1px solid #ccd0d4",
          background: "#0f172a",
          display: "flex",
          flexDirection: "column",
        });
        root.innerHTML = "";
        root.appendChild(host);
        log("host attached");

        const BaklavaEditor =
          rv.BaklavaEditor || rv.default?.BaklavaEditor || rv.default;
        if (!BaklavaEditor) throw new Error("BaklavaEditor component not found");

        // Vue app
        const AppVue = {
          components: { BaklavaEditor },
          setup() {
            const { h, onMounted, nextTick } = vue;

            // Get renderer context from plugin
            const vm = rv.useBaklava?.();
            if (!vm) throw new Error("renderer plugin not available (useBaklava missing)");
            if (!vm.editor) throw new Error("renderer editor not available from plugin");

            // ---- Register node types (from server) ----
            const mkUI = (spec = {}) => {
              const { kind = "string", name, value, options, min, max } = spec;
              try {
                switch (kind) {
                  case "text":
                  case "string":   return new rv.TextInputInterface(name, value ?? "");
                  case "textarea": return new rv.TextareaInputInterface(name, value ?? "");
                  case "label":    return new rv.TextInterface(name, String(value ?? ""));
                  case "integer":  return new rv.IntegerInterface(
                    name,
                    Number.isInteger(value) ? value : 0,
                    typeof min === "number" ? min : undefined,
                    typeof max === "number" ? max : undefined
                  );
                  case "number":   return new rv.NumberInterface(
                    name,
                    Number(value ?? 0),
                    typeof min === "number" ? min : undefined,
                    typeof max === "number" ? max : undefined
                  );
                  case "slider":   return new rv.SliderInterface(
                    name,
                    Number(value ?? 0),
                    Number.isFinite(min) ? min : 0,
                    Number.isFinite(max) ? max : 100
                  );
                  case "boolean":
                  case "checkbox": return new rv.CheckboxInterface(name, Boolean(value));
                  case "select":   return new rv.SelectInterface(
                    name,
                    value,
                    Array.isArray(options) ? options : []
                  );
                  case "button":   return new rv.ButtonInterface(
                    name,
                    typeof value === "function" ? value : () => {}
                  );
                  default:         return new bk.NodeInterface(name, value);
                }
              } catch {
                return new bk.NodeInterface(name, value);
              }
            };

            const defs = [];
            for (const n of nodesList) {
              const meta = n?.meta || {};
              const type = String(meta.type || n.path || "").replace(/\.mjs$/i, "") || "CustomNode";
              const title = meta.title || type;
              const category = meta.category || "YOLANDI";
              const props = meta.props && typeof meta.props === "object" ? meta.props : {};
              const extraIns = Array.isArray(meta.inputs) ? meta.inputs : [];
              const extraOuts = Array.isArray(meta.outputs) ? meta.outputs : [];

              const Def = bk.defineNode({
                type,
                inputs: {
                  in: () => new bk.NodeInterface("in"),
                  ...Object.fromEntries(
                    Object.entries(props).map(([k, s]) => [k, () => mkUI({ name: k, ...(s || {}) })])
                  ),
                  ...Object.fromEntries(extraIns.map((name) => [name, () => new bk.NodeInterface(String(name))])),
                },
                outputs: {
                  out: () => new bk.NodeInterface("out"),
                  ...Object.fromEntries(extraOuts.map((name) => [name, () => new bk.NodeInterface(String(name))])),
                },
              });

              try {
                vm.editor.registerNodeType(Def, { title, category });
              } catch {
                vm.editor.registerNodeType(Def);
              }
              defs.push({ type, Def });
            }

            // ---- Meta Workflow node: run a saved macro inside parent (UI only selection) ----
            try {
              const MacroNode = bk.defineNode({
                type: "MetaWorkflow",
                inputs: {
                  in: () => new bk.NodeInterface("in"),
                  macro: () => new rv.SelectInterface("macro", "", macroNamesRef.current || []),
                },
                outputs: {
                  out: () => new bk.NodeInterface("out"),
                },
              });
              vm.editor.registerNodeType(MacroNode, { title: "Meta Workflow", category: "YOLANDI" });
            } catch {}

            console.log("[YOLANDI Graph] registered types:", defs.map((d) => d.type));

            // ---- Seed defaults into the ACTIVE graph
            onMounted(async () => {
              await nextTick();

              // Palette default visibility
              const palette = findPaletteEl();
              if (palette) {
                if (DEFAULT_SHOW_PALETTE) palette.style.display = "";
                else palette.style.display = "none";
              }

              let graph = vm.displayedGraph;
              if (!graph) {
                graph = new bk.Graph();
                if (typeof vm.registerGraph === "function" && typeof vm.switchGraph === "function") {
                  vm.registerGraph("main", graph);
                  vm.switchGraph("main");
                } else if (typeof vm.switchGraph === "function") {
                  vm.switchGraph(graph);
                }
              }

              const place = (Def, x, y) => {
                try {
                  if (!Def || !graph) return null;
                  const node = new Def();
                  node.position = { x, y };
                  graph.addNode(node);
                  return node;
                } catch (e) {
                  console.warn("[YOLANDI Graph] place failed", e);
                  return null;
                }
              };

              place(defs[0]?.Def, 140, 120);
              place(defs[1]?.Def, 380, 160);
              place(defs[2]?.Def, 620, 200);

              try { vm.fitToContent?.(); vm.viewModel?.fitToContent?.(); } catch {}

              setTimeout(() => {
                const count =
                  document.querySelector(".bk-editor")?.querySelectorAll?.(".bk-node").length || 0;
                console.log("[YOLANDI Graph] DOM node elements visible:", count);
              }, 60);
            });

            /* ---------------- Toolbar actions ---------------- */
            function togglePalette() {
              const palette = findPaletteEl();
              if (!palette) return;
              const $ = window.jQuery;
              const visible = palette.style.display !== "none";
              if (visible) {
                if ($) $(palette).slideUp(160); else (palette.style.display = "none");
              } else {
                if ($) $(palette).slideDown(160); else (palette.style.display = "");
              }
            }

            function toggleLog() {
              const wrap = document.getElementById("yolandi-graph-log-wrap");
              if (wrap && wrap.style.display !== "none") hideLog(); else showLog();
            }

            async function handlePlay() {
              try {
                // export current graph JSON and enqueue workflow job
                const graphJSON = vm.editor.save();
                appendToLog("Enqueueing workflow with current graph…");
                const payload = {
                  script_slug: WORKFLOW_SCRIPT_SLUG,
                  script_version: 1,
                  params: { graph: graphJSON },
                };
                const res = await postJSON(`${REST_ROOT}/jobs/enqueue`, payload);
                const id = res?.id || res?.job_id || res?.jobId;
                currentJobRef.current = id || null;
                pausedRef.current = false;
                pausedState.value = false;
                appendToLog(`Job enqueued${id ? " #" + id : ""}.`);
                if (id) startPolling(id);
              } catch (e) {
                appendToLog("Enqueue failed: " + (e?.message || e?.code || JSON.stringify(e)));
                showLog();
              }
            }

            async function handlePauseResume() {
              const id = currentJobRef.current;
              if (!id) {
                appendToLog("No active job to control.");
                showLog();
                return;
              }
              try {
                if (!pausedState.value) {
                  appendToLog(`Pausing job #${id}…`);
                  await postJSON(`${REST_ROOT}/jobs/${id}/pause`, {});
                  pausedState.value = true;
                  appendToLog(`Pause requested.`);
                } else {
                  appendToLog(`Resuming job #${id}…`);
                  await postJSON(`${REST_ROOT}/jobs/${id}/resume`, {});
                  pausedState.value = false;
                  appendToLog(`Resume requested.`);
                }
              } catch (e) {
                appendToLog(`Control error: ${e?.message || e?.code || "unknown"}`);
                showLog();
              }
            }

            function startPolling(id) {
              if (pollRef.current) clearInterval(pollRef.current);
              appendToLog(`Polling job #${id}…`);
              showLog();

              pollRef.current = setInterval(async () => {
                try {
                  const data = await getJSON(`${REST_ROOT}/jobs/${id}`);
                  const st  = data?.status || data?.state || "";
                  const ctl = data?.control || null;
                  if (ctl === "pause") pausedState.value = true;
                  if (ctl === "resume") pausedState.value = false;

                  appendToLog(`Job ${id} status: ${st || "unknown"}${ctl ? ` (control: ${ctl})` : ""}`);

                  if (!st || /^(succeeded|failed|finished|done|error|cancelled)$/i.test(st)) {
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                    appendToLog(`Job ${id} ended with status: ${st || "unknown"}`);
                  }
                } catch (e) {
                  appendToLog(`Poll error: ${e?.message || e?.code || "unknown"}`);
                }
              }, 1500);
            }

            // Import / Export / Save Macro modals
            function openExportModal() {
              try {
                const data = JSON.stringify(vm.editor.save(), null, 2);
                openModal({
                  title: "Export Workflow JSON",
                  text: data,
                  confirmText: "Copy to Clipboard",
                  onConfirm: async (val) => {
                    await navigator.clipboard?.writeText(val);
                    appendToLog("Export copied to clipboard.");
                    showLog();
                  },
                });
              } catch (e) {
                alert("Unable to export: " + (e?.message || e));
              }
            }

            function openImportModal() {
              openModal({
                title: "Import Workflow JSON",
                text: "",
                confirmText: "Import",
                onConfirm: async (val) => {
                  try {
                    const json = JSON.parse(val);
                    vm.editor.load(json);
                    appendToLog("Graph imported.");
                  } catch {
                    alert("Invalid JSON");
                  }
                },
              });
            }

            function openSaveMacroModal() {
              try {
                const data = JSON.stringify(vm.editor.save(), null, 2);
                openModal({
                  title: "Save as Macro",
                  text: data,
                  showName: true,
                  confirmText: "Save Macro",
                  onConfirm: async (json, name) => {
                    if (!name) { alert("Please enter a macro name"); return; }
                    let parsed;
                    try { parsed = JSON.parse(json); } catch { alert("Invalid JSON"); return; }
                    await postJSON(`${REST_ROOT}/macros`, { name, graph: parsed });
                    appendToLog(`Macro "${name}" saved.`);
                    try {
                      const list = await getJSON(`${REST_ROOT}/macros`);
                      if (Array.isArray(list)) macroNamesRef.current = list.map(x => String(x.name || x)).filter(Boolean);
                    } catch {}
                    showLog();
                  },
                });
              } catch (e) {
                alert("Unable to save: " + (e?.message || e));
              }
            }

            // render
            return () => {
              const h = vue.h;
              const toolbar = h(
                "div",
                {
                  style: {
                    padding: "8px",
                    borderBottom: "1px solid #1f2937",
                    background: "#0b1220",
                    display: "flex",
                    gap: "8px",
                    position: "sticky",
                    top: 0,
                    zIndex: 2,
                  },
                },
                [
                  h("button", { class: "button", onClick: () => handlePlay() }, "▶ Play"),
                  h(
                    "button",
                    { class: "button button-secondary", onClick: () => handlePauseResume() },
                    pausedState.value ? "⏵ Resume" : "⏸ Pause"
                  ),
                  h("button", { class: "button", onClick: () => togglePalette() }, "🧩 Palette"),
                  h("button", { class: "button", onClick: () => toggleLog() }, "📝 Log"),
                  h("button", { class: "button button-secondary", onClick: () => openExportModal() }, "Export JSON"),
                  h("button", { class: "button", onClick: () => openImportModal() }, "Import JSON"),
                  h("button", { class: "button", onClick: () => openSaveMacroModal() }, "💾 Save Macro"),
                ]
              );

              return h(
                "div",
                { style: { height: "100%", display: "flex", flexDirection: "column" } },
                [toolbar, h(BaklavaEditor, { viewModel: vm })]
              );
            };
          },
        };

        const app = (await import("vue")).createApp(AppVue);
        if (typeof (await import("@baklavajs/renderer-vue")).providePlugin === "function") {
          (await import("@baklavajs/renderer-vue")).providePlugin(app);
        }
        app.mount(host);
        cleanup = () => app.unmount();

        if (!alive) cleanup();
        log("mounted");
        setStatus("ready");
      } catch (e) {
        if (!alive) return;
        console.error("[YOLANDI Graph] error", e);
        setError(String(e?.message || e));
        setStatus("error");
      }
    })();

    return () => {
      alive = false;
      cleanup();
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  return (
    <div style={{ position: "relative", minHeight: 640 }}>
      <div ref={mountRef} />
      {status === "loading" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            background: "rgba(255,255,255,0.6)",
          }}
        >
          <p>Loading Graph editor…</p>
        </div>
      )}
      {status === "error" && (
        <div className="y-card" style={{ marginTop: 8 }}>
          <h3>BaklavaJS not available</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{error}</pre>
        </div>
      )}
    </div>
  );
}
