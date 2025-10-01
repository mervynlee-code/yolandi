import React, { useEffect, useRef, useState } from "react";

/**
 * Props (as already used by GraphApp):
 * - isRunning, isPaused, isTerminal
 * - onPlayPause(), onStop()
 * - onExport(), onImport()
 * - log(msg, level?)
 */
export default function Menubar({
  isRunning,
  isPaused,
  isTerminal,
  onPlayPause,
  onStop,
  onExport,
  onImport,
  log,
}) {
  const [openMenu, setOpenMenu] = useState(null); // "file" | "nodes" | "help" | null
  const rootRef = useRef(null);
  const hoverTimer = useRef(null);

  // Close on outside click / ESC
  useEffect(() => {
    const onDocClick = (e) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) setOpenMenu(null);
    };
    const onEsc = (e) => { if (e.key === "Escape") setOpenMenu(null); };
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onEsc);
    };
  }, []);

  // Helpers for hover menus (with a tiny delay so they feel sticky)
  const openOnHover = (id) => () => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setOpenMenu(id), 80);
  };
  const closeOnLeave = () => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setOpenMenu(null), 150);
  };
  const toggleOnClick = (id) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpenMenu((m) => (m === id ? null : id));
  };

  // File actions wired through global actions if present
  const doSave = () => {
    if (window?.YOLANDI?.actions?.onFileSave) {
      window.YOLANDI.actions.onFileSave();
      setOpenMenu(null);
    } else {
      log?.("Save not available (GraphApp actions missing)", "WARN");
    }
  };
  const doSaveAs = () => {
    if (window?.YOLANDI?.actions?.onFileSaveAs) {
      window.YOLANDI.actions.onFileSaveAs();
      setOpenMenu(null);
    } else {
      log?.("Save As not available (GraphApp actions missing)", "WARN");
    }
  };

  return (
    <div
      ref={rootRef}
      className="ystudio-menubar"
      style={{
        position: "relative",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 10px",
        borderBottom: "1px solid #222",
        background: "#121212",
      }}
    >
      {/* ===== Left: Menus ===== */}
      <Menu
        id="file"
        label={<><i className="fa fa-file" />&nbsp;File</>}
        open={openMenu === "file"}
        onHoverOpen={openOnHover("file")}
        onHoverClose={closeOnLeave}
        onClickToggle={toggleOnClick("file")}
      >
        <MenuItem icon="fa-save" label="Save" onClick={doSave} />
        <MenuItem icon="fa-file-export" label="Save as…" onClick={doSaveAs} />
        <Separator />
        <MenuItem icon="fa-download" label="Export (.json)" onClick={() => { setOpenMenu(null); onExport?.(); }} />
        <MenuItem icon="fa-upload" label="Import (.json)" onClick={() => { setOpenMenu(null); onImport?.(); }} />
      </Menu>

      <Menu
        id="nodes"
        label={<><i className="fa fa-diagram-project" />&nbsp;Nodes</>}
        open={openMenu === "nodes"}
        onHoverOpen={openOnHover("nodes")}
        onHoverClose={closeOnLeave}
        onClickToggle={toggleOnClick("nodes")}
      >
        <div className="menu-note">Drop nodes from the sidebar palette.</div>
      </Menu>

      <Menu
        id="help"
        label={<><i className="fa fa-circle-question" />&nbsp;Help</>}
        open={openMenu === "help"}
        onHoverOpen={openOnHover("help")}
        onHoverClose={closeOnLeave}
        onClickToggle={toggleOnClick("help")}
      >
        <div className="menu-note">Ctrl+S: Save &nbsp;•&nbsp; Ctrl+Shift+S: Save as…</div>
      </Menu>

      {/* ===== Right: Runner controls ===== */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        <button className="btn" title={isPaused ? "Resume" : isRunning ? "Pause" : "Run"} onClick={onPlayPause}>
          {isPaused ? <i className="fa fa-play" /> : isRunning ? <i className="fa fa-pause" /> : <i className="fa fa-play" />}
        </button>
        <button className="btn" title="Stop" onClick={onStop}><i className="fa fa-stop" /></button>
      </div>

      {/* Self-contained styles for menus/buttons */}
      <style>{`
        .btn {
          background:#2b2b2b;border:1px solid #3a3a3a;border-radius:6px;
          padding:6px 10px;color:#ddd;cursor:pointer;line-height:1;
        }
        .btn:hover { background:#333; }
        .menu-root {
          position: relative;
        }
        .menu-button {
          border: none; background: transparent; color:#ddd; cursor: pointer;
          border-radius: 6px; padding:6px 10px; display:flex; align-items:center; gap:6px;
        }
        .menu-button:hover, .menu-root[aria-expanded="true"] .menu-button {
          background:#1e1e1e;
        }
        .menu-popover {
          position: absolute; top: calc(100% + 4px); left: 0;
          background:#1b1b1b; border:1px solid #333; border-radius:8px;
          min-width: 220px; padding: 6px; z-index: 200;
          box-shadow: 0 6px 24px rgba(0,0,0,0.35);
        }
        .menu-item {
          display:flex; align-items:center; gap:8px;
          width:100%; border:none; background:transparent; color:#ddd;
          padding:8px 10px; border-radius:6px; cursor:pointer; text-align:left;
        }
        .menu-item:hover { background:#2b2b2b; }
        .menu-sep { height:1px; background:#2a2a2a; margin:6px 4px; }
        .menu-note { padding:8px 10px; font-size:12px; opacity:0.8; }
      `}</style>
    </div>
  );
}

function Menu({ id, label, open, onHoverOpen, onHoverClose, onClickToggle, children }) {
  return (
    <div
      className="menu-root"
      aria-expanded={open ? "true" : "false"}
      onMouseEnter={onHoverOpen}
      onMouseLeave={onHoverClose}
    >
      <button type="button" className="menu-button" onClick={onClickToggle}>
        {label} <i className="fa fa-caret-down" />
      </button>
      {open && (
        <div className="menu-popover" role="menu" aria-labelledby={id}>
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick }) {
  return (
    <button type="button" className="menu-item" onClick={onClick}>
      {icon ? <i className={`fa ${icon}`} /> : null}
      <span>{label}</span>
    </button>
  );
}
function Separator() {
  return <div className="menu-sep" aria-hidden="true" />;
}
