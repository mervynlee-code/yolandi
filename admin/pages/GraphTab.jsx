// admin/pages/GraphTab.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/* =============================================================================
   VS-Code shell + Custom NodeCanvas (HTML/CSS/SVG)
   - Drag from palette → drop on canvas → draggable nodes
   - Fields from meta.props (Text/Number/Checkbox/Select)
   - Ports (inputs left, outputs right)
   - Connections (click-drag from output → input)
   - Export/Import via window.YOLANDI.exportWorkflow / importWorkflow
   ============================================================================= */

/* ---------- tiny utils ---------- */
const uid = () => Math.random().toString(36).slice(2, 9);
function ensureFA() {
  if (document.getElementById("fa-cdn")) return;
  const link = document.createElement("link");
  link.id = "fa-cdn";
  link.rel = "stylesheet";
  link.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css";
  document.head.appendChild(link);
}

/* ---------- WP REST fallback for nodes manifest ---------- */
function wpRestInfo() {
  const root =
    (window.wpApiSettings && window.wpApiSettings.root) ||
    (window.wp && window.wp.apiSettings && window.wp.apiSettings.root) ||
    "/wp-json/";
  const nonce =
    (window.wpApiSettings && window.wpApiSettings.nonce) ||
    (window.wp && window.wp.apiSettings && window.wp.apiSettings.nonce) ||
    null;
  return { root: root.replace(/\/$/, ""), nonce };
}
async function getNodesManifestCompat() {
  try {
    const API = await import(/* @vite-ignore */ "../core/api");
    const fn = API.getNodesManifest || (API.default && API.default.getNodesManifest);
    if (typeof fn === "function") {
      const out = await fn();
      return Array.isArray(out) ? out : [];
    }
  } catch {}
  const { root, nonce } = wpRestInfo();
  const res = await fetch(`${root}/yolandi/v1/nodes`, {
    credentials: "same-origin",
    headers: nonce ? { "X-WP-Nonce": nonce } : {},
  });
  if (!res.ok) throw new Error(`Nodes fetch failed: ${res.status}`);
  const j = await res.json();
  return Array.isArray(j) ? j : [];
}

/* ---------- global scaffolding ---------- */
(function initGlobal() {
  window.YOLANDI = window.YOLANDI || {};
  window.YOLANDI.actions = window.YOLANDI.actions || {};
  if (!window.YOLANDI.registerActivityItem) {
    window.YOLANDI.registerActivityItem = (item) =>
      window.dispatchEvent(new CustomEvent("yolandi:add-activity-item", { detail: item }));
  }
})();

/* =============================================================================
   NodeCanvas – minimal node editor (DOM/SVG)
   ============================================================================= */
function NodeCanvas({ registerApi }) {
  const CANVAS_W = undefined; // fills parent
  const CANVAS_H = undefined;
  const NODE_W = 260;
  const HEAD_H = 28;
  const ROW_H = 22;
  const PORT_R = 6;

  const wrapRef = useRef(null);
  const [nodes, setNodes] = useState([]); // {id, x,y, title, meta, fields, inputs[], outputs[]}
  const [links, setLinks] = useState([]); // {id, from:{nid,pid}, to:{nid,pid}}
  const [drag, setDrag] = useState(null); // {nid, dx, dy}
  const [wip, setWip] = useState(null);   // drag-wire: {from:{nid,pid}, x,y}

  /* ----- API exposed to parent ----- */
  useEffect(() => {
    const api = {
      addNodeByMeta(meta, pos) {
        const id = "n" + uid();
        const title = meta?.title || meta?.type || "Node";
        const props = meta?.props || {};
        const fields = {};
        for (const [k, spec] of Object.entries(props)) fields[k] = spec?.default ?? "";
        // allow meta.io = {inputs:[...], outputs:[...]} ; else default 1/1
        const inputs = (meta?.io?.inputs || ["in"]).map((name, i) => ({ id: "i" + i, name }));
        const outputs = (meta?.io?.outputs || ["out"]).map((name, i) => ({ id: "o" + i, name }));
        setNodes((N) => [
          ...N,
          {
            id,
            x: Math.round(pos.x - NODE_W / 2),
            y: Math.round(pos.y - 16),
            title,
            meta,
            fields,
            inputs,
            outputs,
            w: NODE_W,
          },
        ]);
      },
      exportJSON() {
        return {
          nodes: nodes.map((n) => ({
            id: n.id,
            title: n.title,
            type: n.meta?.type || null,
            x: n.x,
            y: n.y,
            fields: n.fields,
            inputs: n.inputs.map((p) => ({ id: p.id, name: p.name })),
            outputs: n.outputs.map((p) => ({ id: p.id, name: p.name })),
          })),
          links: links.map((l) => l),
          version: 1,
        };
      },
      importJSON(doc) {
        if (!doc || !Array.isArray(doc.nodes)) return;
        setNodes(
          doc.nodes.map((n) => ({
            id: n.id,
            x: n.x,
            y: n.y,
            title: n.title || "Node",
            meta: { type: n.type || "Imported" },
            fields: n.fields || {},
            inputs: n.inputs || [{ id: "i0", name: "in" }],
            outputs: n.outputs || [{ id: "o0", name: "out" }],
            w: NODE_W,
          }))
        );
        setLinks(Array.isArray(doc.links) ? doc.links : []);
      },
      center() {
        wrapRef.current?.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      },
    };
    registerApi?.(api);
    window.YOLANDI.exportWorkflow = () => api.exportJSON();
    window.YOLANDI.importWorkflow = (doc) => api.importJSON(doc);
  }, [nodes, links, registerApi]);

  /* ----- helpers ----- */
  const portIndex = (node, type, pid) => {
    const list = type === "in" ? node.inputs : node.outputs;
    return Math.max(0, list.findIndex((p) => p.id === pid));
  };
  const portXY = (node, type, pid) => {
    const idx = portIndex(node, type, pid);
    const y =
      node.y + HEAD_H + 8 + idx * ROW_H + ROW_H / 2;
    const x = type === "in" ? node.x + 8 : node.x + node.w - 8;
    return { x, y };
  };
  const nodeById = (nid) => nodes.find((n) => n.id === nid);

  /* ----- dragging nodes ----- */
  function onHeadDown(e, nid) {
    const node = nodeById(nid);
    if (!node) return;
    const dx = e.clientX - node.x;
    const dy = e.clientY - node.y;
    setDrag({ nid, dx, dy });
    e.stopPropagation();
  }
  useEffect(() => {
    const onMove = (e) => {
      if (!drag) return;
      setNodes((N) =>
        N.map((n) =>
          n.id === drag.nid
            ? { ...n, x: Math.round(e.clientX - drag.dx), y: Math.round(e.clientY - drag.dy) }
            : n
        )
      );
    };
    const onUp = () => setDrag(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag]);

  /* ----- wiring (connections) ----- */
  function startWire(fromNid, outPid, ev) {
    const node = nodeById(fromNid);
    const { x, y } = portXY(node, "out", outPid);
    setWip({ from: { nid: fromNid, pid: outPid }, x, y });
    ev.stopPropagation();
  }
  function moveWire(ev) {
    if (!wip) return;
    setWip((W) => ({ ...W, x: ev.clientX, y: ev.clientY }));
  }
  function endWire(ev) {
    if (!wip) return setWip(null);
    // If mouseup happens on an input port, handlers below will finalize.
    setWip(null);
  }
  function acceptWire(toNid, inPid, ev) {
    if (!wip) return;
    const id = "l" + uid();
    const link = { id, from: wip.from, to: { nid: toNid, pid: inPid } };
    // one-link-per-input: remove existing links targeting this input
    setLinks((L) => [...L.filter((x) => !(x.to.nid === toNid && x.to.pid === inPid)), link]);
    setWip(null);
    ev.stopPropagation();
  }

  /* ----- SVG paths for links ----- */
  const wires = useMemo(() => {
    const paths = [];
    for (const L of links) {
      const A = nodeById(L.from.nid);
      const B = nodeById(L.to.nid);
      if (!A || !B) continue;
      const p1 = portXY(A, "out", L.from.pid);
      const p2 = portXY(B, "in", L.to.pid);
      const dx = Math.max(40, Math.abs(p2.x - p1.x) * 0.6);
      paths.push({ id: L.id, d: `M ${p1.x},${p1.y} C ${p1.x + dx},${p1.y} ${p2.x - dx},${p2.y} ${p2.x},${p2.y}` });
    }
    if (wip) {
      const A = nodeById(wip.from.nid);
      if (A) {
        const p1 = portXY(A, "out", wip.from.pid);
        const p2 = { x: wip.x, y: wip.y };
        const dx = Math.max(40, Math.abs(p2.x - p1.x) * 0.6);
        paths.push({ id: "_wip", d: `M ${p1.x},${p1.y} C ${p1.x + dx},${p1.y} ${p2.x - dx},${p2.y} ${p2.x},${p2.y}` });
      }
    }
    return paths;
  }, [links, wip, nodes]);

  return (
    <div
      ref={wrapRef}
      id="yc-canvas"
      onMouseMove={moveWire}
      onMouseUp={endWire}
    >
      {/* wires */}
      <svg className="yc-wires">
        {wires.map((p) => (
          <path key={p.id} d={p.d} className={p.id === "_wip" ? "yc-wire wip" : "yc-wire"} />
        ))}
      </svg>

      {/* nodes */}
      {nodes.map((n) => (
        <div
          key={n.id}
          className="yc-node"
          style={{ left: n.x, top: n.y, width: n.w }}
        >
          <div className="yc-head" onMouseDown={(e) => onHeadDown(e, n.id)} title={n.title}>
            <i className="fa fa-grip-lines" />
            <span>{n.title}</span>
          </div>

          <div className="yc-ports">
            <div className="col in">
              {n.inputs.map((p) => (
                <div key={p.id} className="yc-port in" onMouseUp={(e) => acceptWire(n.id, p.id, e)}>
                  <span className="dot" />
                  <span className="name">{p.name}</span>
                </div>
              ))}
            </div>
            <div className="col out">
              {n.outputs.map((p) => (
                <div key={p.id} className="yc-port out" onMouseDown={(e) => startWire(n.id, p.id, e)}>
                  <span className="name">{p.name}</span>
                  <span className="dot" />
                </div>
              ))}
            </div>
          </div>

          <div className="yc-body">
            {Object.entries(n.fields).map(([key, val]) => {
              const spec = n.meta?.props?.[key] || { type: "string" };
              const t = (spec.type || "string").toLowerCase();
              const onChange = (v) =>
                setNodes((N) => N.map((x) => (x.id === n.id ? { ...x, fields: { ...x.fields, [key]: v } } : x)));
              if (t === "number") {
                return (
                  <label key={key} className="row">
                    <span className="lab">{key}</span>
                    <input
                      type="number"
                      value={val ?? ""}
                      onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
                    />
                  </label>
                );
              }
              if (t === "checkbox" || t === "bool" || t === "boolean") {
                return (
                  <label key={key} className="row check">
                    <input type="checkbox" checked={!!val} onChange={(e) => onChange(e.target.checked)} />
                    <span className="lab">{key}</span>
                  </label>
                );
              }
              if (t === "select") {
                return (
                  <label key={key} className="row">
                    <span className="lab">{key}</span>
                    <select value={val ?? ""} onChange={(e) => onChange(e.target.value)}>
                      {(spec.options || []).map((opt) => (
                        <option key={String(opt)} value={opt}>
                          {String(opt)}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              }
              return (
                <label key={key} className="row">
                  <span className="lab">{key}</span>
                  <input type="text" value={val ?? ""} onChange={(e) => onChange(e.target.value)} />
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* =============================================================================
   Main Shell
   ============================================================================= */
export default function GraphTab() {
  const [manifest, setManifest] = useState([]);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [activePanel, setActivePanel] = useState("puppeteer");
  const [tabs, setTabs] = useState([{ id: "w1", title: "Workflow 1", dirty: false }]);
  const [activeTabId, setActiveTabId] = useState("w1");
  const [activityItems, setActivityItems] = useState([
    { id: "puppeteer", icon: "fa-spider", title: "Puppeteer" },
    { id: "loop", icon: "fa-arrows-rotate", title: "Loop" },
  ]);

  const panelRef = useRef(null);
  const panelDragRef = useRef(null);
  const canvasApiRef = useRef(null);

  useEffect(() => {
    ensureFA();
  }, []);

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

  useEffect(() => {
    const onAdd = (e) => setActivityItems((prev) => [...prev, e.detail]);
    window.addEventListener("yolandi:add-activity-item", onAdd);
    return () => window.removeEventListener("yolandi:add-activity-item", onAdd);
  }, []);

  function log(msg, level = "DEBUG") {
    const pre = document.querySelector("#ystudio-terminal pre");
    if (!pre) return;
    const t = new Date().toLocaleTimeString();
    pre.textContent += `${pre.textContent ? "\n" : ""}[${t}] ${level} — ${msg}`;
    pre.parentElement.scrollTop = pre.parentElement.scrollHeight;
  }
  window.YOLANDI.log = log;

  /* ----- resizable panel ----- */
  useEffect(() => {
    const bar = panelDragRef.current;
    const panel = panelRef.current;
    if (!bar || !panel) return;
    let startY = 0;
    let startH = 0;
    const down = (e) => {
      startY = e.clientY;
      startH = panel.getBoundingClientRect().height;
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    };
    const move = (e) => {
      const dy = startY - e.clientY;
      const target = Math.max(120, startH + dy);
      panel.style.setProperty("--panel-height", `${target}px`);
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    bar.addEventListener("mousedown", down);
    return () => bar.removeEventListener("mousedown", down);
  }, []);

  function togglePalette() {
    const root = document.getElementById("ystudio");
    const next = !paletteOpen;
    root?.setAttribute("data-palette", next ? "open" : "closed");
    setPaletteOpen(next);
  }

  /* ----- group manifest and filter by active panel ----- */
  const grouped = useMemo(() => {
    const g = {};
    for (const n of manifest) {
      const folder = n?.meta?.category || n?.meta?.type || "Misc";
      if (!g[folder]) g[folder] = [];
      g[folder].push(n);
    }
    const want = activePanel.toLowerCase();
    const out = {};
    for (const [folder, arr] of Object.entries(g)) {
      const f = folder.toLowerCase();
      if (want === "puppeteer" && f.includes("puppeteer")) out[folder] = arr;
      else if (want === "loop" && (f.includes("loop") || f.includes("iterate"))) out[folder] = arr;
    }
    return Object.keys(out).length ? out : g;
  }, [manifest, activePanel]);

  /* ----- expose actions for drop ----- */
  window.YOLANDI.actions.onNodeDrop = (meta, pos) => {
    canvasApiRef.current?.addNodeByMeta(meta, pos);
  };
  window.YOLANDI.actions.newWorkflow = () => openNewTab();
  window.YOLANDI.actions.saveWorkflow = () =>
    log("Save workflow → use window.YOLANDI.exportWorkflow()", "INFO");
  window.YOLANDI.actions.saveAsWorkflow = () =>
    log("Save As workflow → use window.YOLANDI.exportWorkflow()", "INFO");

  function openNewTab() {
    const id = "w" + uid();
    setTabs((t) => [...t, { id, title: "Untitled Workflow", dirty: true }]);
    setActiveTabId(id);
  }
  function closeTab(id) {
    setTabs((t) => t.filter((x) => x.id !== id));
    if (activeTabId === id && tabs.length > 1) {
      const idx = tabs.findIndex((t) => t.id === id);
      const next = tabs[idx + 1] || tabs[idx - 1];
      if (next) setActiveTabId(next.id);
    }
  }

  return (
    <div id="ystudio" data-palette={paletteOpen ? "open" : "closed"}>
      {/* Menubar */}
      <div id="ystudio-menubar">
        <div className="left">
          <span className="title">YOLANDI Studio</span>
          <DropMenu
            label="File"
            items={[
              { label: "New Workflow", onClick: openNewTab },
              { label: "Save", onClick: () => window.YOLANDI.actions.saveWorkflow?.() },
              { label: "Save as…", onClick: () => window.YOLANDI.actions.saveAsWorkflow?.() },
            ]}
          />
          <DropMenu
            label="Nodes"
            items={[
              { label: "New (open Monaco from template)", onClick: () => log("Open Monaco…", "INFO") },
              { label: "Save", onClick: () => log("Save Node to /nodes", "INFO") },
              { label: "Save as…", onClick: () => log("Save Node As…", "INFO") },
            ]}
          />
        </div>
        <div className="right">
          <i className="fa-regular fa-bell"></i>
          <i className="fa-solid fa-gear"></i>
        </div>
      </div>

      <div id="ystudio-main">
        {/* Activity bar */}
        <div id="ystudio-activity">
          {activityItems.map((it) => (
            <button
              key={it.id}
              className={`activity-btn ${activePanel === it.id ? "active" : ""}`}
              title={it.title}
              onClick={() => {
                if (activePanel === it.id) togglePalette();
                else {
                  if (!paletteOpen) togglePalette();
                  setActivePanel(it.id);
                }
              }}
            >
              <i className={`fa ${it.icon}`}></i>
            </button>
          ))}
        </div>

        {/* Sidebar / Node Palette */}
        <div id="ystudio-sidebar">
          <div className="sidebar-header">
            <span className="label">{activePanel === "loop" ? "Loop Nodes" : "Puppeteer Nodes"}</span>
            <button className="icon-btn" onClick={togglePalette} title="Toggle Sidebar">
              <i className="fa fa-angles-left"></i>
            </button>
          </div>

          <div className="palette-scroll">
            <NodeTree
              grouped={grouped}
              onDragStart={(e, node) => {
                const meta = node.meta || {};
                e.dataTransfer.setData("application/x-yolandi-node", JSON.stringify(meta));
                e.dataTransfer.effectAllowed = "copy";
                log(`Dragging node: ${meta.title || meta.type || node.path}`);
              }}
            />
          </div>
        </div>

        {/* Editor */}
        <div id="ystudio-editor">
          {/* Tabs */}
          <div className="tabs">
            {tabs.map((t) => (
              <div
                key={t.id}
                className={`tab ${t.id === activeTabId ? "active" : ""}`}
                onClick={() => setActiveTabId(t.id)}
              >
                <span className="name">{t.title}{t.dirty ? "*" : ""}</span>
                <button className="close" onClick={(e) => (e.stopPropagation(), closeTab(t.id))}>
                  <i className="fa fa-xmark"></i>
                </button>
              </div>
            ))}
            <button className="tab add" onClick={openNewTab} title="New Workflow">
              <i className="fa fa-plus"></i>
            </button>
          </div>

          {/* Canvas */}
          <div
            id="ystudio-editor-host"
            onDragOver={(e) => {
              if (e.dataTransfer?.types?.includes("application/x-yolandi-node")) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={(e) => {
              const dt = e.dataTransfer?.getData("application/x-yolandi-node");
              if (!dt) return;
              e.preventDefault();
              const meta = JSON.parse(dt);
              const rect = e.currentTarget.getBoundingClientRect();
              const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
              window.YOLANDI.actions.onNodeDrop?.(meta, pos);
            }}
          >
            <NodeCanvas registerApi={(api) => (canvasApiRef.current = api)} />
          </div>

          {/* Bottom panel */}
          <div id="ystudio-panel" ref={panelRef} style={{ "--panel-height": "220px" }}>
            <div id="ystudio-panel-tabs">
              <div className="tab active"><i className="fa fa-terminal" /> Console</div>
              <div className="spacer" />
              <div className="controls">
                <button onClick={() => (document.querySelector("#ystudio-terminal pre").textContent = "")} title="Clear">
                  <i className="fa fa-broom"></i>
                </button>
                <button onClick={() => log("Ping")} title="Test log">
                  <i className="fa fa-message"></i>
                </button>
                <button
                  onClick={() => log(JSON.stringify(window.YOLANDI.exportWorkflow?.() || {}, null, 2), "DATA")}
                  title="Dump JSON"
                >
                  <i className="fa fa-file-code"></i>
                </button>
              </div>
            </div>
            <div id="ystudio-terminal"><pre /></div>
            <div id="ystudio-panel-drag" ref={panelDragRef} title="Resize panel" />
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div id="ystudio-statusbar">
        <div className="left">
          <i className="fa fa-code-branch" /> main <span className="sep" />
          <i className="fa fa-circle" /> Ready
        </div>
        <div className="right">
          <i className="fa fa-gauge-high" /> Runner: idle <span className="sep" />
          <i className="fa fa-rotate" /> Auto-save
        </div>
      </div>
    </div>
  );
}

/* ---------- subcomponents ---------- */
function DropMenu({ label, items }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`menu ${open ? "open" : ""}`} onMouseLeave={() => setOpen(false)}>
      <button onMouseEnter={() => setOpen(true)} onClick={() => setOpen((v) => !v)}>
        {label}
      </button>
      {open && (
        <div className="menu-popover">
          {items.map((it, i) => (
            <div key={i} className="menu-item" onClick={() => (setOpen(false), it.onClick && it.onClick())}>
              {it.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NodeTree({ grouped, onDragStart }) {
  const [open, setOpen] = useState(() => new Set(Object.keys(grouped)));
  const toggle = (k) => {
    const n = new Set(open);
    n.has(k) ? n.delete(k) : n.add(k);
    setOpen(n);
  };
  return (
    <div className="node-tree">
      {Object.keys(grouped).sort().map((folder) => (
        <div key={folder} className="folder">
          <div className="folder-head" onClick={() => toggle(folder)}>
            <i className={`fa fa-caret-${open.has(folder) ? "down" : "right"}`} />
            <span>{folder}</span>
          </div>
          {open.has(folder) && (
            <div className="folder-body">
              {grouped[folder].map((n) => {
                const name = n?.meta?.title || n?.meta?.type || n?.path || "Node";
                return (
                  <div
                    key={name + n.path}
                    className="node-item"
                    draggable
                    title={name}
                    onDragStart={(e) => onDragStart(e, n)}
                  >
                    <i className="fa fa-cube" />
                    <span>{name}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
