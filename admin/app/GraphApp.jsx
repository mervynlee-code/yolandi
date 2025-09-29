// =========================
// FILE: admin/app/GraphApp.jsx
// =========================
import React, { useEffect, useMemo, useRef, useState } from "react";
import NodeCanvas from "../components/NodeCanvas.jsx";
import Menubar from "../components/Menubar.jsx";
import Sidebar from "../components/Sidebar.jsx";
import RunnerPanel from "../components/RunnerPanel.jsx";
import AuthModal from "../components/AuthModal.jsx";
import { ensureFA, getNodesManifestCompat } from "../lib/manifest.js";
import { apiEnqueueWorkflow, apiGetJob, apiControl, apiCancel } from "../lib/api.js";
import { buildRunnerCommands } from "../lib/runnerCommands.js";
import { logLineFactory, runnerLogFactory } from "../lib/logging.js";

export default function GraphApp() {
  const [manifest, setManifest] = useState([]);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [activePanel, setActivePanel] = useState("puppeteer");
  const [tabs, setTabs] = useState([{ id: "w1", title: "Workflow 1", dirty: false }]);
  const [activeTabId, setActiveTabId] = useState("w1");
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

  // Refs & logging
  const canvasApiRef = useRef(null);
  const log = logLineFactory("#ystudio-terminal pre");
  const runnerLog = runnerLogFactory("#ystudio-runner pre");
  const lastStatusRef = useRef("");

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

  // Expose basic actions
  useEffect(() => {
    window.YOLANDI = window.YOLANDI || {};
    window.YOLANDI.log = log;
    window.YOLANDI.runnerLog = runnerLog;
    window.YOLANDI.actions = window.YOLANDI.actions || {};
    window.YOLANDI.actions.onNodeDrop = (meta, pos) => {
      if (auth.locked) { setShowAuth(true); return; }
      canvasApiRef.current?.addNodeByMeta(meta, pos);
    };
    window.YOLANDI.devBypass = () => {
      document.cookie = "yolandi_bypass=1; max-age=86400; path=/";
      setAuth(a => ({ ...a, bypass: true, locked: false }));
    };
  }, [auth.locked]);

  // Workflow helpers
  function exportWorkflow() { return canvasApiRef.current?.exportJSON() || { nodes: [], links: [] }; }

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

  // File menu actions
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
      try { canvasApiRef.current?.importJSON(JSON.parse(String(reader.result))); log("Workflow imported", "INFO"); }
      catch (err) { log("Import failed: " + (err?.message || err), "ERROR"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

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
                <button className="close" onClick={(e) => (e.stopPropagation(), setTabs((x)=>x.filter(y=>y.id!==t.id)))}>
                  <i className="fa fa-xmark"></i>
                </button>
              </div>
            ))}
            <button className="tab add" onClick={() => setTabs((t)=>[...t,{id:`w${Math.random().toString(36).slice(2,7)}`,title:"Untitled",dirty:true}])} title="New Workflow">
              <i className="fa fa-plus"></i>
            </button>
          </div>

          <div id="ystudio-editor-host" style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div className="canvas-wrap" style={{ position: "relative", flex: "1 1 auto", minHeight: 0 }}>
              <NodeCanvas registerApi={(api)=> (canvasApiRef.current = api)} />
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

      <div id="ystudio-statusbar" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 30 }}>
        <div className="left"><i className="fa fa-code-branch" /> main <span className="sep" /> <i className="fa fa-circle" /> Ready</div>
        <div className="right"><i className="fa fa-gauge-high" /> Job: {jobId ? (job?.status || "queued") : "idle"} <span className="sep" /> <i className="fa fa-rotate" /> Auto-save</div>
      </div>
    </div>
  );
}