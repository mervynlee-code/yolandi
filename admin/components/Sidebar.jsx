// =========================
// FILE: admin/components/Sidebar.jsx
// =========================
import React, { useEffect, useState } from "react";
import { useActivityPlugins } from "../plugins/activityLoader.jsx";

export default function Sidebar({ activePanel, setActivePanel, paletteOpen, setPaletteOpen, manifest, log, auth }){
  const items = useActivityPlugins({ manifest, log, auth });
  const togglePalette = () => setPaletteOpen(!paletteOpen);

  return (
    <>
      <div id="ystudio-activity">
        {items.map((it) => (
          <button key={it.id} className={`activity-btn ${activePanel === it.id ? "active" : ""}`} title={it.title}
            onClick={() => { if (activePanel === it.id) togglePalette(); else { if (!paletteOpen) togglePalette(); setActivePanel(it.id); } }}>
            <i className={`fa ${it.icon}`}></i>
          </button>
        ))}
      </div>
      <div id="ystudio-sidebar">
        <div className="sidebar-header">
          <span className="label">{items.find(x=>x.id===activePanel)?.title || "Panel"}</span>
          <button className="icon-btn" onClick={togglePalette} title="Toggle Sidebar"><i className="fa fa-angles-left"></i></button>
        </div>
        <div className="palette-scroll">
          {items.find(x=>x.id===activePanel)?.render()}
        </div>
      </div>
    </>
  );
}