// =========================
// FILE: admin/components/RunnerPanel.jsx
// =========================
import React, { useEffect, useRef } from "react";

export default function RunnerPanel({ jobId, job, runnerCmdPS, runnerCmdSH, onPlay, onPause, onResume, onCancel }){
  const panelRef = useRef(null); const panelDragRef = useRef(null);
  useEffect(()=>{
    const bar=panelDragRef.current, panel=panelRef.current; if(!bar||!panel) return; let startY=0,startH=0;
    const down=(e)=>{ startY=e.clientY; startH=panel.getBoundingClientRect().height; document.addEventListener("mousemove",move); document.addEventListener("mouseup",up); };
    const move=(e)=>{ const dy=startY-e.clientY; const target=Math.max(120,startH+dy); panel.style.setProperty("--panel-height",`${target}px`); };
    const up=()=>{ document.removeEventListener("mousemove",move); document.removeEventListener("mouseup",up); };
    bar.addEventListener("mousedown",down); return ()=>bar.removeEventListener("mousedown",down);
  },[]);

  const isPaused = job?.status === "paused"; const isTerminal = ["succeeded","failed","canceled"].includes(job?.status||"");

  return (
    <div id="ystudio-panel" ref={panelRef} style={{ "--panel-height":"220px", height:"var(--panel-height)", minHeight:120, overflow:"hidden", flex:"0 0 auto" }}>
      <div id="ystudio-panel-tabs">
        <div className={`tab ${true ? "active" : ""}`}><i className="fa fa-gauge-high" /> Runner</div>
        <div className="spacer" />
        <div className="controls" />
      </div>
      <div id="ystudio-panel-body" style={{ height:"calc(var(--panel-height) - 32px)", overflow:"auto" }}>
        <div id="ystudio-runner">
          <div className="runner-help" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
            <div><div style={{ fontWeight:600, marginBottom:4 }}>Launch Runner (Windows PowerShell)</div><textarea readOnly value={runnerCmdPS} onFocus={(e)=>e.target.select()} rows={3} style={{ width:"100%" }} /></div>
            <div><div style={{ fontWeight:600, marginBottom:4 }}>Launch Runner (Linux/macOS)</div><textarea readOnly value={runnerCmdSH} onFocus={(e)=>e.target.select()} rows={3} style={{ width:"100%" }} /></div>
          </div>
          <div className="runner-status" style={{ display:"flex", gap:16, alignItems:"center", margin:"4px 0 8px" }}>
            <span><b>Job:</b> {jobId ? `#${jobId}` : "—"}</span>
            <span><b>Status:</b> {job?.status || (jobId ? "queued" : "—")}</span>
            <span><b>Runner:</b> {job?.runner_id || "—"}</span>
            {job?.error?.message && <span style={{ color:"crimson" }}><b>Error:</b> {job.error.message}</span>}
            <span className="spacer" style={{ flex:1 }} />
            <button className="btn" onClick={onPlay} title="Enqueue Workflow"><i className="fa fa-play" /> Run</button>
            <button className="btn" onClick={isPaused ? onResume : onPause} disabled={!jobId || isTerminal} title={isPaused ? "Resume" : "Pause"}>
              <i className={`fa fa-${isPaused ? "play" : "pause"}`} /> {isPaused ? "Resume" : "Pause"}
            </button>
            <button className="btn" onClick={onCancel} disabled={!jobId || isTerminal} title="Cancel"><i className="fa fa-stop" /> Stop</button>
          </div>
          <pre style={{ margin:0, whiteSpace:"pre-wrap", wordBreak:"break-word" }} />
        </div>
      </div>
      <div id="ystudio-panel-drag" ref={panelDragRef} title="Resize panel" />
    </div>
  );
}