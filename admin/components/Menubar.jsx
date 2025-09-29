// =========================
// FILE: admin/components/Menubar.jsx
// =========================
import React, { useRef } from "react";

export default function Menubar({ isRunning, isPaused, isTerminal, onPlayPause, onStop, onExport, onImport, log }){
  const fileOpen = useRef(false);
  const nodesOpen = useRef(false);
  return (
    <div id="ystudio-menubar">
      <div className="left">
        <span className="title">YOLANDI Studio</span>
        <div className={`menu ${fileOpen.current ? "open" : ""}`} onMouseLeave={()=>{fileOpen.current=false;}}>
          <button onMouseEnter={()=>{fileOpen.current=true;}} onClick={()=>{fileOpen.current=!fileOpen.current;}}>File</button>
          {fileOpen.current && (
            <div className="menu-popover">
              <div className="menu-item" onClick={onExport}>Export JSON…</div>
              <div className="menu-item" onClick={onImport}>Import JSON…</div>
            </div>
          )}
        </div>
        <div className={`menu ${nodesOpen.current ? "open" : ""}`} onMouseLeave={()=>{nodesOpen.current=false;}}>
          <button onMouseEnter={()=>{nodesOpen.current=true;}} onClick={()=>{nodesOpen.current=!nodesOpen.current;}}>Nodes</button>
          {nodesOpen.current && (
            <div className="menu-popover">
              <div className="menu-item" onClick={()=>log("Open Monaco…","INFO")}>New (open Monaco from template)</div>
              <div className="menu-item" onClick={()=>log("Save Node to /nodes","INFO")}>Save</div>
              <div className="menu-item" onClick={()=>log("Save Node As…","INFO")}>Save as…</div>
            </div>
          )}
        </div>
      </div>
      <div className="right">
        <button className={`nav-icon ${isRunning ? "active" : ""}`} title={!isRunning?"Run Workflow": isPaused?"Resume Job":"Pause Job"} onClick={onPlayPause}>
          <i className={`fa fa-${!isRunning?"play": isPaused?"play":"pause"}`} />
        </button>
        <button className="nav-icon" title="Cancel Job" onClick={onStop} disabled={!isRunning}><i className="fa fa-stop" /></button>
        <i className="fa-regular fa-bell"></i>
        <i className="fa-solid fa-gear"></i>
      </div>
    </div>
  );
}