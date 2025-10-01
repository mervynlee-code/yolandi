// =========================
// FILE: admin/app/GraphApp.jsx
// =========================
import React, { useEffect, useMemo, useRef, useState } from "react";
import NodeCanvas from "../components/NodeCanvas.jsx";
import Menubar from "../components/Menubar.jsx";
import Sidebar from "../components/Sidebar.jsx";
import RunnerPanel from "../components/RunnerPanel.jsx";
import AuthModal from "../components/AuthModal.jsx";
import FilePickerModal from "../components/FilePickerModal.jsx"; // ⬅️ NEW
import { ensureFA, getNodesManifestCompat } from "../lib/manifest.js";
import { apiEnqueueWorkflow, apiGetJob, apiControl, apiCancel } from "../lib/api.js";
import { buildRunnerCommands } from "../lib/runnerCommands.js";
import { logLineFactory, runnerLogFactory } from "../lib/logging.js";

export default function GraphApp() {
  const [manifest, setManifest] = useState([]);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [activePanel, setActivePanel] = useState("puppeteer");

  // Tabs (each = separate workflow graph)
  const [tabs, setTabs] = useState([{ id: "w1", title: "Workflow 1", dirty: false }]);
  const [activeTabId, setActiveTabId] = useState("w1");

  // Server Save/Save As modal
  const [fileModal, setFileModal] = useState({ open: false, json: null });

  const [showAuth, setShowAuth] = useState(false);
  const [auth, setAuth] = useState(() => {
    const token = localStorage.getItem("yolandi_token");
    const bypass = document.cookie.includes("yolandi_bypass=1");
    return { token, user: null, bypass, locked: !token && !bypass };
  });

  // Runner/Job state
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const [runnerCmdPS, setRunnerCmdPS] = useState("");
  const [runnerCmdSH, setRunnerCmdSH] = useState("");

  // Zoom state (only for display; actions call Canvas API)
  const [zoomPct, setZoomPct] = useState(100);

  // Refs & logging
  const canvasApiRef = useRef(null);
  const log = logLineFactory("#ystudio-terminal pre");
  const runnerLog = runnerLogFactory("#ystudio-runner pre");
  const lastStatusRef = useRef("");
  const prevActiveTabRef = useRef("w1");

  // Per-tab state (JSON + server path/name)
  // { [tabId]: { data: object|null, path: string|null, name: string|null } }
  const tabStateRef = useRef(Object.create(null));

  useEffect(() => { ensureFA(); }, []);

  useEffect(() => {
    (async () => {
      try {
        const nodes = await getNodesManifestCompat();
        setManifest(nodes);
      } catch (e) {
        log(`Failed to load nodes: ${e?.message || e}`, "ERROR");
      }
    })();
  }, []);

  // Runner commands (copy/paste helpers)
  useEffect(() => {
    const { ps, sh } = buildRunnerCommands({});
    setRunnerCmdPS(ps);
    setRunnerCmdSH(sh);
  }, []);

  // Poll job status
  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      try {
        const j = await apiGetJob(jobId);
        setJob(j);
        const s = j?.status || "queued";
        if (s !== lastStatusRef.current) {
          runnerLog(`Job #${jobId} → ${s}`);
          lastStatusRef.current = s;
        }
      } catch (e) {
        runnerLog(`Poll error: ${e.message}`);
      } finally {
        if (!stop) setTimeout(tick, 2000);
      }
    };
    tick();
    return () => { stop = true; };
  }, [jobId]);

  // Capture console.log/warn/error to bottom "Console" tab
  useEffect(() => {
    const orig = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    };
    const stringify = (xs) => xs.map(x => {
      try { return typeof x === "string" ? x : JSON.stringify(x); } catch { return String(x); }
    }).join(" ");
    console.log = (...a) => { log(stringify(a), "INFO"); orig.log(...a); };
    console.warn = (...a) => { log(stringify(a), "WARN"); orig.warn(...a); };
    console.error = (...a) => { log(stringify(a), "ERROR"); orig.error(...a); };
    return () => { console.log = orig.log; console.warn = orig.warn; console.error = orig.error; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wire global actions so Menubar (or other UI) can invoke Save / Save As / Node drop
  useEffect(() => {
    window.YOLANDI = window.YOLANDI || {};
    window.YOLANDI.log = log;
    window.YOLANDI.runnerLog = runnerLog;
    window.YOLANDI.actions = window.YOLANDI.actions || {};
    window.YOLANDI.actions.onNodeDrop = (meta, pos) => {
      if (auth.locked) { setShowAuth(true); return; }
      canvasApiRef.current?.addNodeByMeta(meta, pos);
    };
    window.YOLANDI.actions.onFileSave = onFileSave;       // ⬅️ NEW
    window.YOLANDI.actions.onFileSaveAs = onFileSaveAs;   // ⬅️ NEW
    window.YOLANDI.devBypass = () => {
      document.cookie = "yolandi_bypass=1; max-age=86400; path=/";
      setAuth(a => ({ ...a, bypass: true, locked: false }));
    };
  }, [auth.locked]);

  // Keyboard shortcuts: Ctrl+S = Save, Ctrl+Shift+S = Save As
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (e.shiftKey) onFileSaveAs();
        else onFileSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Keep zoom display in sync (poll Canvas API if exposed)
  useEffect(() => {
    let t = null;
    const tick = () => {
      const z = canvasApiRef.current?.getZoom?.();
      if (typeof z === "number" && isFinite(z)) setZoomPct(Math.round(z * 100));
      t = setTimeout(tick, 400);
    };
    tick();
    return () => t && clearTimeout(t);
  }, []);

  // Workflow helpers
  function exportWorkflow() {
    return canvasApiRef.current?.exportJSON() || { nodes: [], links: [] };
  }
  function importWorkflow(json) {
    canvasApiRef.current?.importJSON(json || { nodes: [], links: [] });
  }

  // Handle tab switching: persist current JSON, load next JSON
  useEffect(() => {
    const prevId = prevActiveTabRef.current;
    if (prevId && prevId !== activeTabId) {
      try {
        const json = exportWorkflow();
        tabStateRef.current[prevId] = { ...(tabStateRef.current[prevId] || {}), data: json };
      } catch (e) {
        log(`Save active tab before switch failed: ${e.message}`, "WARN");
      }
      const next = tabStateRef.current[activeTabId]?.data || { nodes: [], links: [] };
      importWorkflow(next);
    }
    prevActiveTabRef.current = activeTabId;
  }, [activeTabId]);

  // Mark tab dirty if Canvas emits change/dirty events (support several shapes)
  useEffect(() => {
    const api = canvasApiRef.current;
    const markDirty = () => setTabs(ts => ts.map(t => t.id === activeTabId ? { ...t, dirty: true } : t));
    let unsub = null;

    if (api?.onDirty?.subscribe) { unsub = api.onDirty.subscribe(markDirty); }
    else if (api?.onChange?.subscribe) { unsub = api.onChange.subscribe(markDirty); }
    else if (api?.on) { api.on("change", markDirty); unsub = () => api.off?.("change", markDirty); }

    return () => { if (typeof unsub === "function") unsub(); };
  }, [activeTabId]);

  // Runner controls wired to external pause-aware runner via REST
  async function onPlay() {
    try {
      const wf = exportWorkflow();
      const { id } = await apiEnqueueWorkflow(wf, { settings: {}, env: {} });
      setJobId(id);
      runnerLog(`Enqueued job #${id}`);
    } catch (e) {
      runnerLog(`Enqueue failed: ${e.message}`);
      alert(`Enqueue failed: ${e.message}`);
    }
  }
  async function onPause() { if (jobId) { try { await apiControl(jobId, "pause"); runnerLog(`Pause requested for #${jobId}`); } catch (e) { alert(e.message); } } }
  async function onResume() { if (jobId) { try { await apiControl(jobId, "resume"); runnerLog(`Resume requested for #${jobId}`); } catch (e) { alert(e.message); } } }
  async function onCancel() { if (jobId) { try { await apiCancel(jobId); runnerLog(`Cancel requested for #${jobId}`); } catch (e) { alert(e.message); } } }

  const isPaused = job?.status === "paused";
  const isTerminal = ["succeeded", "failed", "canceled"].includes(job?.status || "");
  const isRunning = !!jobId && !isPaused && !isTerminal;

  // === File System API (server) ===
  function buildRestUrl(route, params) {
    // route: 'yolandi/v1/fs/ls' or '/yolandi/v1/fs/ls'
    const clean = String(route).replace(/^\/+/, '');
    let root = (window?.wpApiSettings?.root || '').toString(); // WP often exposes absolute REST root here

    let u;
    if (root && /^https?:\/\//i.test(root)) {
      // Absolute root provided by WP (best case)
      u = new URL(root.replace(/\/+$/, '/') + clean);
    } else {
      // Fallback: same origin + /wp-json/
      u = new URL('/wp-json/' + clean, window.location.origin);
    }
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v != null) u.searchParams.set(k, v);
      }
    }
    return u.toString();
  }

  // Replace your fsLs with this
  async function fsLs(path = null) {
    const url = buildRestUrl('yolandi/v1/fs/ls', path ? { path } : undefined);
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      if (res.status === 404) throw new Error('fs/ls 404 (install yolandi/v1/fs/ls route)');
      throw new Error(`fs/ls HTTP ${res.status}`);
    }
    return res.json();
  }

  // Replace your fsSave with this
  async function fsSave({ path, name, json }) {
    const url = buildRestUrl('yolandi/v1/fs/save');
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, name, json }),
    });
    if (!res.ok) {
      if (res.status === 404) throw new Error('fs/save 404 (install yolandi/v1/fs/save route)');
      throw new Error(`fs/save HTTP ${res.status}`);
    }
    return res.json();
  }

  // === Save / Save As ===
  async function onFileSave() {
    const jsonObj = exportWorkflow();
    const jsonTxt = JSON.stringify(jsonObj, null, 2);

    // Use last path/name if present
    const t = tabs.find(x => x.id === activeTabId);
    const state = tabStateRef.current[activeTabId] || {};
    if (!state.path || !state.name) return onFileSaveAs(); // first time → Save As

    try {
      await fsSave({ path: state.path, name: state.name, json: jsonTxt });
      setTabs(ts => ts.map(x => x.id === activeTabId ? { ...x, dirty: false } : x));
      log(`Saved: ${state.path}/${state.name}`, "INFO");
    } catch (e) {
      log(`Save failed: ${e.message}`, "ERROR");
      alert("Save failed: " + e.message);
    }
  }

  function onFileSaveAs() {
    const jsonTxt = JSON.stringify(exportWorkflow(), null, 2);
    setFileModal({ open: true, json: jsonTxt });
  }

  async function onConfirmSaveAs({ dirPath, filename }) {
    try {
      await fsSave({ path: dirPath, name: filename, json: fileModal.json });
      // remember for this tab
      tabStateRef.current[activeTabId] = { ...(tabStateRef.current[activeTabId] || {}), path: dirPath, name: filename };
      // reflect in title if user saved a new name
      setTabs(ts => ts.map(x => x.id === activeTabId ? { ...x, title: filename.replace(/\.json$/i, ""), dirty: false } : x));
      setFileModal({ open: false, json: null });
      log(`Saved: ${dirPath}/${filename}`, "INFO");
    } catch (e) {
      log(`Save As failed: ${e.message}`, "ERROR");
      alert("Save As failed: " + e.message);
    }
  }

  // File menu "Export" (client-side download)
  function doExport() {
    const json = exportWorkflow() || {};
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `yolandi-workflow-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function doImportFile() { document.getElementById("ystudio-import").click(); }
  function onImportChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result));
        importWorkflow(json);
        setTabs(ts => ts.map(t => t.id === activeTabId ? { ...t, dirty: true } : t));
        log("Workflow imported", "INFO");
      } catch (err) { log("Import failed: " + (err?.message || err), "ERROR"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  // Zoom actions (call Canvas API if available)
  function zoomIn() { canvasApiRef.current?.zoomIn?.(); }
  function zoomOut() { canvasApiRef.current?.zoomOut?.(); }
  function zoomFit() { canvasApiRef.current?.zoomFit?.(); }

  return (
    <div id="ystudio" data-palette={paletteOpen ? "open" : "closed"}>
      <input id="ystudio-import" type="file" accept="application/json" onChange={onImportChange} style={{ display: "none" }} />

      <Menubar
        isRunning={isRunning}
        isPaused={isPaused}
        isTerminal={isTerminal}
        onPlayPause={() => (!jobId || isTerminal ? onPlay() : isPaused ? onResume() : onPause())}
        onStop={onCancel}
        onExport={doExport}
        onImport={doImportFile}
        log={log}
      />

      <div id="ystudio-main" style={{ paddingBottom: 28 }}>
        <Sidebar
          activePanel={activePanel}
          setActivePanel={setActivePanel}
          paletteOpen={paletteOpen}
          setPaletteOpen={setPaletteOpen}
          manifest={manifest}
          log={log}
          auth={auth}
        />

        <div id="ystudio-editor">
          <div className="tabs">
            {tabs.map((t) => (
              <div key={t.id} className={`tab ${t.id === activeTabId ? "active" : ""}`} onClick={() => setActiveTabId(t.id)}>
                <span className="name">{t.title}{t.dirty ? "*" : ""}</span>
                <button
                  className="close"
                  onClick={(e) => {
                    e.stopPropagation();
                    // persist current before closing if it's the active tab
                    if (t.id === activeTabId) {
                      const json = exportWorkflow();
                      tabStateRef.current[t.id] = { ...(tabStateRef.current[t.id] || {}), data: json };
                    }
                    setTabs((x) => x.filter((y) => y.id !== t.id));
                    // also drop its cached state
                    const state = tabStateRef.current;
                    if (state[t.id]) delete state[t.id];
                    // if we removed the last one, create a new blank tab
                    setTimeout(() => {
                      if (!document.querySelector(".tabs .tab")) {
                        const id = "w" + Math.random().toString(36).slice(2, 7);
                        setTabs([{ id, title: "Untitled", dirty: false }]);
                        setActiveTabId(id);
                        tabStateRef.current[id] = { data: { nodes: [], links: [] }, path: null, name: null };
                        importWorkflow({ nodes: [], links: [] });
                      }
                    }, 0);
                  }}
                >
                  <i className="fa fa-xmark"></i>
                </button>
              </div>
            ))}
            <button
              className="tab add"
              onClick={() => {
                const id = "w" + Math.random().toString(36).slice(2, 7);
                setTabs((t) => [...t, { id, title: "Untitled", dirty: true }]);
                tabStateRef.current[id] = { data: { nodes: [], links: [] }, path: null, name: null };
                setActiveTabId(id);
              }}
              title="New Workflow"
            >
              <i className="fa fa-plus"></i>
            </button>
          </div>

          <div id="ystudio-editor-host" style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div className="canvas-wrap" style={{ position: "relative", flex: "1 1 auto", minHeight: 0 }}>
              <NodeCanvas registerApi={(api) => (canvasApiRef.current = api)} />
              {/* Zoom controls — top-right */}
              <div style={{
                position: "absolute", top: 10, right: 10, display: "flex", gap: 8, zIndex: 20
              }}>
                <button className="btn" title="Zoom Out" onClick={zoomOut}><i className="fa fa-magnifying-glass-minus" /></button>
                <div className="btn" title="Zoom">{zoomPct}%</div>
                <button className="btn" title="Zoom In" onClick={zoomIn}><i className="fa fa-magnifying-glass-plus" /></button>
                <button className="btn" title="Fit" onClick={zoomFit}><i className="fa fa-compress" /></button>
              </div>
            </div>

            <RunnerPanel
              jobId={jobId}
              job={job}
              runnerCmdPS={runnerCmdPS}
              runnerCmdSH={runnerCmdSH}
              onPlay={onPlay}
              onPause={onPause}
              onResume={onResume}
              onCancel={onCancel}
            />
          </div>
        </div>
      </div>

      {showAuth && (
        <AuthModal onClose={() => setShowAuth(false)} onLoggedIn={() => setShowAuth(false)} />
      )}

      {/* Save As… modal for server-side write */}
      {fileModal.open && (
        <FilePickerModal
          initialPath={null}
          fsLs={fsLs}
          onClose={() => setFileModal({ open: false, json: null })}
          onConfirm={onConfirmSaveAs}
        />
      )}

      <div id="ystudio-statusbar" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 30 }}>
        <div className="left"><i className="fa fa-code-branch" /> main <span className="sep" /> <i className="fa fa-circle" /> Ready</div>
        <div className="right"><i className="fa fa-gauge-high" /> Job: {jobId ? (job?.status || "queued") : "idle"} <span className="sep" /> <i className="fa fa-rotate" /> Auto-save</div>
      </div>
    </div>
  );
}
