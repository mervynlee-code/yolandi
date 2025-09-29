// admin/pages/GraphTab.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/* =============================================================================
   YOLANDI Studio — VS Code–style UI + Custom Node Canvas
   - Node canvas (DOM/SVG): pan/zoom, marquee select, draggable nodes, live wires
   - Top nav: File/Nodes menus + Play/Pause runner
   - Bottom panel: Console + Runner Log tabs
   - Left activity bar: Puppeteer, Loop, Shop (marketplace overlay)
   - Auth gate (YOLANDI.org) blocks node-drop until login/register
   - File menu: Export/Import JSON
   ============================================================================= */

const uid = () => Math.random().toString(36).slice(2, 9);

/* ---------- Font Awesome ---------- */
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

/* ---------- global scaffold ---------- */
(function initGlobal() {
  window.YOLANDI = window.YOLANDI || {};
  window.YOLANDI.actions = window.YOLANDI.actions || {};
  if (!window.YOLANDI.registerActivityItem) {
    window.YOLANDI.registerActivityItem = (item) =>
      window.dispatchEvent(new CustomEvent("yolandi:add-activity-item", { detail: item }));
  }
})();

/* =============================================================================
   NodeCanvas – DOM/SVG node editor with pan/zoom, marquee, wires
   ============================================================================= */
function NodeCanvas({ registerApi }) {
  // ---- DOM-based port center helpers ----
  function portElKey(type, nid, pid) {
    return `${type}:${nid}:${pid}`;
  }
  function getPortCenterScreen(type, nid, pid) {
    const el =
      document.querySelector(`[data-port-key="${portElKey(type, nid, pid)}"] .dot`) ||
      document.querySelector(`[data-port-key="${portElKey(type, nid, pid)}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function getPortCenterWorld(type, nid, pid) {
    const scr = getPortCenterScreen(type, nid, pid);
    if (!scr) return null;
    return toWorld(scr.x, scr.y);
  }

  const NODE_W = 280;
  const HEAD_H = 28;
  const ROW_H = 22;

  const wrapRef = useRef(null);
  const contentRef = useRef(null);

  const [nodes, setNodes] = useState([]);  // {id,x,y,w,title,meta,fields,inputs[],outputs[],selected}
  const [links, setLinks] = useState([]);  // {id, from:{nid,pid}, to:{nid,pid}}
  const [view, setView] = useState({ x: 0, y: 0, k: 1 }); // pan/zoom
  const [mode, setMode] = useState("select"); // "select" | "pan"
  const [drag, setDrag] = useState(null);     // node drag: {ids[], offsets:[{id,dx,dy}]}
  const [wip, setWip] = useState(null);       // wire drag: {from:{nid,pid}, x,y} (screen)
  const [marq, setMarq] = useState(null);     // marquee: {sx,sy,ex,ey, sxScr, syScr, exScr, eyScr}

  const kMin = 0.3, kMax = 2.0;

  /* ----- coordinate helpers ----- */
  const toWorld = (clientX, clientY) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const x = (clientX - rect.left - view.x) / view.k;
    const y = (clientY - rect.top - view.y) / view.k;
    return { x, y };
  };
  const toScreen = (worldX, worldY) => {
    const rect = wrapRef.current.getBoundingClientRect();
    return {
      x: rect.left + view.x + worldX * view.k,
      y: rect.top + view.y + worldY * view.k,
    };
  };

  const nodeById = (nid) => nodes.find((n) => n.id === nid);
  const portIndex = (node, type, pid) => {
    const list = type === "in" ? node.inputs : node.outputs;
    return Math.max(0, list.findIndex((p) => p.id === pid));
  };
  const portXY = (node, type, pid) => {
    const idx = portIndex(node, type, pid);
    const y = node.y + HEAD_H + 8 + idx * ROW_H + ROW_H / 2;
    const x = type === "in" ? node.x + 10 : node.x + node.w - 10;
    return { x, y }; // world coords
  };

  /* ----- API exposed to parent ----- */
  useEffect(() => {
    const api = {
      addNodeByMeta(meta, posScr) {
        // posScr is in client coords
        const { x, y } = toWorld(posScr.x, posScr.y);
        const id = "n" + uid();
        const title = meta?.title || meta?.type || "Node";
        const props = meta?.props || {};
        const fields = {};
        for (const [k, spec] of Object.entries(props)) fields[k] = spec?.default ?? "";

        const inputs = (meta?.io?.inputs || ["in"]).map((name, i) => ({ id: "i" + i, name }));
        const outputs = (meta?.io?.outputs || ["out"]).map((name, i) => ({ id: "o" + i, name }));

        setNodes((N) => [
          ...N,
          {
            id,
            x: Math.round(x - NODE_W / 2),
            y: Math.round(y - 16),
            w: NODE_W,
            title,
            meta,
            fields,
            inputs,
            outputs,
            selected: false,
          },
        ]);
      },
      exportJSON() {
        return {
          version: 1,
          view,
          nodes: nodes.map((n) => ({
            id: n.id,
            title: n.title,
            type: n.meta?.type || null,
            x: n.x, y: n.y, w: n.w,
            fields: n.fields,
            inputs: n.inputs, outputs: n.outputs,
          })),
          links,
        };
      },
      importJSON(doc) {
        if (!doc || !Array.isArray(doc.nodes)) return;
        setView(doc.view || { x: 0, y: 0, k: 1 });
        setNodes(
          doc.nodes.map((n) => ({
            id: n.id, title: n.title || "Node",
            meta: { type: n.type || "Imported" },
            x: n.x, y: n.y, w: n.w || NODE_W,
            fields: n.fields || {},
            inputs: n.inputs || [{ id: "i0", name: "in" }],
            outputs: n.outputs || [{ id: "o0", name: "out" }],
            selected: false,
          }))
        );
        setLinks(Array.isArray(doc.links) ? doc.links : []);
      },
      setMode,
      zoomIn() { zoomAt(1.1); },
      zoomOut() { zoomAt(1 / 1.1); },
      zoomFit() { fitToContent(); },
      center() { setView((v) => ({ ...v, x: 0, y: 0 })); },
      _debug: { nodes, links },
    };
    registerApi?.(api);
    window.YOLANDI.exportWorkflow = () => api.exportJSON();
    window.YOLANDI.importWorkflow = (doc) => api.importJSON(doc);
  }, [nodes, links, view, registerApi]);

  /* ----- zoom util (around mouse or center) ----- */
  function zoomAt(factor, pivotScreen = null) {
    setView((v) => {
      const k = Math.min(kMax, Math.max(kMin, v.k * factor));
      if (!pivotScreen) return { ...v, k };
      const rect = wrapRef.current.getBoundingClientRect();
      const px = (pivotScreen.x - rect.left - v.x) / v.k;
      const py = (pivotScreen.y - rect.top - v.y) / v.k;
      const nx = pivotScreen.x - rect.left - px * k;
      const ny = pivotScreen.y - rect.top - py * k;
      return { x: nx, y: ny, k };
    });
  }

  /* ----- wheel zoom (Ctrl+wheel) + trackpad pan in pan-mode ----- */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        zoomAt(dir, { x: e.clientX, y: e.clientY });
      } else if (mode === "pan") {
        e.preventDefault();
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [mode]);

  /* ----- canvas mouse down: pan or marquee ----- */
  function onCanvasMouseDown(e) {
    if ((e.target.closest && e.target.closest(".yc-node")) || (e.target.closest && e.target.closest(".yc-port"))) {
      return;
    }
    if (mode === "pan" || e.button === 1) {
      const start = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      const move = (ev) => setView({ x: start.vx + (ev.clientX - start.sx), y: start.vy + (ev.clientY - start.sy), k: view.k });
      const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return;
    }

    // --- marquee selection with live preview (no stale state) ---
    const startW = toWorld(e.clientX, e.clientY);
    let box = { sx: startW.x, sy: startW.y, ex: startW.x, ey: startW.y, sxScr: e.clientX, syScr: e.clientY, exScr: e.clientX, eyScr: e.clientY };
    setMarq(box);

    const move = (ev) => {
      const w = toWorld(ev.clientX, ev.clientY);
      box = { ...box, ex: w.x, ey: w.y, exScr: ev.clientX, eyScr: ev.clientY };
      setMarq(box); // draw rectangle

      // live highlight
      const x1 = Math.min(box.sx, box.ex), y1 = Math.min(box.sy, box.ey);
      const x2 = Math.max(box.sx, box.ex), y2 = Math.max(box.sy, box.ey);
      setNodes((N) =>
        N.map((n) => {
          const H = HEAD_H + 8 + Math.max(n.inputs.length, n.outputs.length) * ROW_H + 12 + Object.keys(n.fields).length * (ROW_H + 4);
          const nx1 = n.x, ny1 = n.y, nx2 = n.x + n.w, ny2 = n.y + H;
          const hit = !(nx2 < x1 || nx1 > x2 || ny2 < y1 || ny1 > y2);
          return { ...n, selected: hit };
        })
      );
    };

    const up = () => {
      setMarq(null);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  /* ----- drag node(s) from header or body ----- */
  function onHeadDown(e, nid) {
    if (e.button !== 0) return;
    startDragFromNode(e, nid);
  }
  function onNodeDown(e, nid) {
    if (e.button !== 0) return;
    const tag = e.target.tagName;
    if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(tag)) return;
    if (e.target.closest(".yc-port")) return;
    startDragFromNode(e, nid);
  }
  function startDragFromNode(e, nid) {
    const n = nodeById(nid); if (!n) return;
    const ids = nodes.filter((x) => x.selected).map((x) => x.id);
    const moving = ids.length ? ids : [nid];
    const startWorld = toWorld(e.clientX, e.clientY);
    const offsets = moving.map((id) => {
      const node = nodeById(id);
      return { id, dx: startWorld.x - node.x, dy: startWorld.y - node.y };
    });
    setDrag({ ids: moving, offsets });
    e.stopPropagation();
  }
  useEffect(() => {
    const onMove = (e) => {
      if (!drag) return;
      const w = toWorld(e.clientX, e.clientY);
      setNodes((N) =>
        N.map((n) => {
          const m = drag.offsets.find((o) => o.id === n.id);
          return m ? { ...n, x: Math.round(w.x - m.dx), y: Math.round(w.y - m.dy) } : n;
        })
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
    const scr = getPortCenterScreen("out", fromNid, outPid);
    if (!scr) return;
    setWip({ from: { nid: fromNid, pid: outPid }, x: scr.x, y: scr.y });
    ev.stopPropagation();
  }
  function moveWire(ev) {
    if (!wip) return;
    setWip((W) => ({ ...W, x: ev.clientX, y: ev.clientY }));
  }
  function nearestInputPortWorld(xw, yw) {
    const ports = Array.from(document.querySelectorAll(".yc-port.in"));
    let best = null, bestD2 = 16 * 16;
    for (const el of ports) {
      const k = el.getAttribute("data-port-key");
      const [, nid, pid] = k.split(":");
      const c = getPortCenterWorld("in", nid, pid);
      if (!c) continue;
      const dx = c.x - xw, dy = c.y - yw, d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = { nid, pid }; }
    }
    return best;
  }
  function acceptWire(toNid, inPid, ev) {
    if (!wip) return;
    if (!toNid || !inPid) {
      const p2 = toWorld(ev.clientX, ev.clientY);
      const near = nearestInputPortWorld(p2.x, p2.y);
      if (near) { toNid = near.nid; inPid = near.pid; }
    }
    if (!toNid || !inPid) { setWip(null); return; }
    const id = "l" + uid();
    const link = { id, from: wip.from, to: { nid: toNid, pid: inPid } };
    setLinks((L) => [...L.filter((x) => !(x.to.nid === toNid && x.to.pid === inPid)), link]);
    setWip(null);
    ev.stopPropagation();
  }
  function endWire() { if (wip) setWip(null); }

  /* ----- wire paths (world coords; drawn inside transformed layer) ----- */
  const wirePaths = useMemo(() => {
    const paths = [];
    for (const L of links) {
      const p1 = getPortCenterWorld("out", L.from.nid, L.from.pid);
      const p2 = getPortCenterWorld("in", L.to.nid, L.to.pid);
      if (!p1 || !p2) continue;
      const dx = Math.max(40, Math.abs(p2.x - p1.x) * 0.6);
      paths.push({ id: L.id, d: `M ${p1.x},${p1.y} C ${p1.x + dx},${p1.y} ${p2.x - dx},${p2.y} ${p2.x},${p2.y}` });
    }
    if (wip) {
      const p1 = getPortCenterWorld("out", wip.from.nid, wip.from.pid);
      const p2 = toWorld(wip.x, wip.y);
      if (p1 && p2) {
        const dx = Math.max(40, Math.abs(p2.x - p1.x) * 0.6);
        paths.push({ id: "_wip", d: `M ${p1.x},${p1.y} C ${p1.x + dx},${p1.y} ${p2.x - dx},${p2.y} ${p2.x},${p2.y}` });
      }
    }
    return paths;
  }, [links, wip, nodes, view]);

  /* ----- fit to content ----- */
  function fitToContent() {
    if (!nodes.length) { setView({ x: 0, y: 0, k: 1 }); return; }
    const pad = 60;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const H = HEAD_H + 8 + Math.max(n.inputs.length, n.outputs.length) * ROW_H + 12 + Object.keys(n.fields).length * (ROW_H + 4);
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x + n.w);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y + H);
    }
    const rect = wrapRef.current.getBoundingClientRect();
    const w = rect.width - pad * 2;
    const h = rect.height - pad * 2;
    const k = Math.min(kMax, Math.max(kMin, Math.min(w / (maxX - minX), h / (maxY - minY))));
    const x = pad - minX * k + (rect.width - (maxX - minX) * k - pad * 2) / 2;
    const y = pad - minY * k + (rect.height - (maxY - minY) * k - pad * 2) / 2;
    setView({ x, y, k });
  }

  /* ----- toolbar actions ----- */
  const zoomIn = () => zoomAt(1.1);
  const zoomOut = () => zoomAt(1 / 1.1);
  const zoomFit = () => fitToContent();
  const toggleMode = () => setMode((m) => (m === "pan" ? "select" : "pan"));

  /* ----- render ----- */
  return (
    <div
      id="yc-canvas"
      ref={wrapRef}
      style={{ position: "absolute", inset: 0 }}
      onMouseMove={moveWire}
      onMouseUp={endWire}
      onMouseDown={onCanvasMouseDown}
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
        window.YOLANDI.actions.onNodeDrop?.(meta, { x: e.clientX, y: e.clientY });
      }}
    >
      {/* toolbar (top-right) */}
      <div className="yc-toolbar" style={{ position: "absolute", right: 12, top: 8, zIndex: 20, display: "flex", gap: 6, alignItems: "center" }}>
        <button title={mode === "pan" ? "Pan (active)" : "Pan"} className={mode === "pan" ? "active" : ""} onClick={toggleMode}><i className="fa fa-hand"></i></button>
        <button title="Select" className={mode === "select" ? "active" : ""} onClick={() => setMode("select")}><i className="fa fa-square-dashed"></i></button>
        <span className="sep" />
        <button title="Zoom Out" onClick={zoomOut}><i className="fa fa-magnifying-glass-minus"></i></button>
        <button title="Fit" onClick={zoomFit}><i className="fa fa-rectangle-list"></i></button>
        <button title="Zoom In" onClick={zoomIn}><i className="fa fa-magnifying-glass-plus"></i></button>
        <span className="zoom"> {(view.k * 100) | 0}%</span>
      </div>

      {/* transformed content */}
      <div
        ref={contentRef}
        className="yc-content"
        style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", transformOrigin: "0 0", transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
      >
        {/* wires */}
        <svg
          className="yc-wires"
          width="20000"
          height="12000"
          style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none", zIndex: 0 }}
        >
          {wirePaths.map((p) => (
            <path
              key={p.id}
              d={p.d}
              className={p.id === "_wip" ? "yc-wire wip" : "yc-wire"}
              stroke={p.id === "_wip" ? "rgba(96,165,250,.7)" : "rgba(96,165,250,.95)"}
              strokeWidth={2}
              fill="none"
              style={{ vectorEffect: "non-scaling-stroke" }}
            />
          ))}
        </svg>

        {/* nodes */}
        {nodes.map((n) => (
          <div
            key={n.id}
            className={`yc-node ${n.selected ? "selected" : ""}`}
            style={{ left: n.x, top: n.y, width: n.w, position: "absolute", zIndex: 1 }}
            onMouseDown={(e) => onNodeDown(e, n.id)}
          >
            <div className="yc-head" onMouseDown={(e) => onHeadDown(e, n.id)} title={n.title}>
              <i className="fa fa-grip-lines" /><span>{n.title}</span>
            </div>

            <div className="yc-ports">
              <div className="col in">
                {n.inputs.map((p) => (
                  <div
                    key={p.id}
                    className="yc-port in"
                    data-port-key={`in:${n.id}:${p.id}`}
                    onMouseUp={(e) => acceptWire(n.id, p.id, e)}
                  >
                    <span className="dot" /><span className="name">{p.name}</span>
                  </div>
                ))}
              </div>
              <div className="col out">
                {n.outputs.map((p) => (
                  <div
                    key={p.id}
                    className="yc-port out"
                    data-port-key={`out:${n.id}:${p.id}`}
                    onMouseDown={(e) => startWire(n.id, p.id, e)}
                  >
                    <span className="name">{p.name}</span><span className="dot" />
                  </div>
                ))}
              </div>
            </div>

            <div className="yc-body">
              {Object.entries(n.fields).map(([key, val]) => {
                const spec = n.meta?.props?.[key] || { type: "string" };
                const t = (spec.type || "string").toLowerCase();
                const onChange = (v) => setNodes((N) => N.map((x) => (x.id === n.id ? { ...x, fields: { ...x.fields, [key]: v } } : x)));
                if (t === "number") {
                  return <label key={key} className="row"><span className="lab">{key}</span><input type="number" value={val ?? ""} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} /></label>;
                }
                if (t === "checkbox" || t === "bool" || t === "boolean") {
                  return <label key={key} className="row check"><input type="checkbox" checked={!!val} onChange={(e) => onChange(e.target.checked)} /><span className="lab">{key}</span></label>;
                }
                if (t === "select") {
                  return <label key={key} className="row"><span className="lab">{key}</span><select value={val ?? ""} onChange={(e) => onChange(e.target.value)}>{(spec.options || []).map((opt) => <option key={String(opt)} value={opt}>{String(opt)}</option>)}</select></label>;
                }
                return <label key={key} className="row"><span className="lab">{key}</span><input type="text" value={val ?? ""} onChange={(e) => onChange(e.target.value)} /></label>;
              })}
            </div>
          </div>
        ))}
      </div>

      {/* marquee (screen space) */}
      {marq && (
        <div
          className="yc-marquee"
          style={{
            position: "fixed",
            border: "1px dashed rgba(96,165,250,.9)",
            background: "rgba(96,165,250,.12)",
            pointerEvents: "none",
            zIndex: 10,
            left: Math.min(marq.sxScr, marq.exScr),
            top: Math.min(marq.syScr, marq.eyScr),
            width: Math.abs(marq.exScr - marq.sxScr),
            height: Math.abs(marq.eyScr - marq.syScr),
          }}
        />
      )}
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
    { id: "shop", icon: "fa-store", title: "Shop" },
  ]);

  const [showAuth, setShowAuth] = useState(false);
  const [auth, setAuth] = useState(() => {
    const token = localStorage.getItem("yolandi_token");
    const bypass = document.cookie.includes("yolandi_bypass=1");
    return { token, user: null, bypass, locked: !token && !bypass };
  });

  const [runner, setRunner] = useState({ running: false, stopping: false });
  const [panelTab, setPanelTab] = useState("console"); // 'console' | 'runner'

  const panelRef = useRef(null);
  const panelDragRef = useRef(null);
  const canvasApiRef = useRef(null);
  const fileInputRef = useRef(null);

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
  function runnerLog(msg) {
    const el = document.querySelector("#ystudio-runner pre");
    if (!el) return;
    const t = new Date().toLocaleTimeString();
    el.textContent += `${el.textContent ? "\n" : ""}[${t}] ${msg}`;
    el.parentElement.scrollTop = el.parentElement.scrollHeight;
  }
  window.YOLANDI.log = log;
  window.YOLANDI.runnerLog = runnerLog;

  /* ----- resizable bottom panel ----- */
  useEffect(() => {
    const bar = panelDragRef.current;
    const panel = panelRef.current;
    if (!bar || !panel) return;
    let startY = 0, startH = 0;
    const down = (e) => {
      startY = e.clientY; startH = panel.getBoundingClientRect().height;
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

  /* ----- AUTH: REST calls to yolandi.org ----- */
  async function authLogin({ username, password }) {
    const url = "https://yolandi.org/wp-json/yolandi-shop/v1/auth/login";
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const j = await res.json();
      if (j?.token) {
        localStorage.setItem("yolandi_token", j.token);
        setAuth({ token: j.token, user: j.user, bypass: false, locked: false });
        return true;
      }
    } catch {}
    return false;
  }
  async function authRegister({ email, username, password }) {
    const url = "https://yolandi.org/wp-json/yolandi-shop/v1/auth/register";
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, username, password }) });
      const j = await res.json();
      if (j?.token) {
        localStorage.setItem("yolandi_token", j.token);
        setAuth({ token: j.token, user: j.user, bypass: false, locked: false });
        return true;
      }
    } catch {}
    return false;
  }
  // DEV bypass cookie (temporary)
  window.YOLANDI.devBypass = () => {
    document.cookie = "yolandi_bypass=1; max-age=86400; path=/";
    setAuth((a) => ({ ...a, bypass: true, locked: false }));
  };

  /* ----- actions exposed ----- */
  window.YOLANDI.actions.onNodeDrop = (meta, pos) => {
    if (auth.locked) { setShowAuth(true); setPanelTab("console"); return; }
    canvasApiRef.current?.addNodeByMeta(meta, pos);
  };
  window.YOLANDI.actions.newWorkflow = () => openNewTab();
  window.YOLANDI.actions.saveWorkflow = () => log("Save workflow (use Export JSON)", "INFO");
  window.YOLANDI.actions.saveAsWorkflow = () => log("Save As workflow (use Export JSON)", "INFO");

  // Install purchased Node (client-side fetch to unzip into /nodes)
  useEffect(() => {
    window.YOLANDI.actions.installPurchased = async (item) => {
      try {
        const t = localStorage.getItem("yolandi_token");
        if (!t) { alert("Please login first."); return; }
        const d = await fetch(`https://yolandi.org/wp-json/yolandi-shop/v1/download/node/${item.id}?token=${encodeURIComponent(t)}`).then(r => r.json());
        if (!d.download_url) throw new Error("No download URL");
        const res = await fetch(window.ajaxurl || "/wp-admin/admin-ajax.php", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ action: "yolandi_install_node_zip", url: d.download_url })
        }).then(r => r.json());
        if (res?.success || res?.ok) { window.YOLANDI.log?.(`Installed: ${item.name}`, "INFO"); }
        else { throw new Error(res?.error || "Install failed"); }
      } catch (e) { window.YOLANDI.log?.("Install error: " + (e.message || e), "ERROR"); }
    };
  }, [auth]);

  /* ----- runner (no DB jobs) ----- */
  function getGraphSnapshot() {
    const doc = canvasApiRef.current?.exportJSON() || { nodes: [], links: [] };
    const byId = Object.fromEntries((doc.nodes || []).map(n => [n.id, n]));
    const inDeg = Object.fromEntries((doc.nodes || []).map(n => [n.id, 0]));
    const out = {};
    for (const L of (doc.links || [])) {
      out[L.from.nid] = out[L.from.nid] || [];
      out[L.from.nid].push(L.to.nid);
      inDeg[L.to.nid] = (inDeg[L.to.nid] || 0) + 1;
    }
    return { doc, byId, inDeg, out };
  }
  async function playRunner() {
    if (runner.running) return;
    setPanelTab("runner");
    setRunner({ running: true, stopping: false });
    window.YOLANDI.runnerLog?.("▶ Runner started");

    const G = getGraphSnapshot();
    const queue = Object.keys(G.inDeg).filter((nid) => G.inDeg[nid] === 0);
    const seen = new Set();

    while (queue.length && !runner.stopping) {
      const nid = queue.shift();
      if (seen.has(nid)) continue;
      seen.add(nid);

      const node = G.byId[nid];
      window.YOLANDI.runnerLog?.(`Node: ${node.title} (${node.type || "custom"})`);
      await new Promise((r) => setTimeout(r, 200)); // simulate work

      const outs = G.out[nid] || [];
      for (const next of outs) {
        G.inDeg[next]--;
        if (G.inDeg[next] === 0) queue.push(next);
      }
    }

    if (runner.stopping) window.YOLANDI.runnerLog?.("⏸ Runner paused");
    else window.YOLANDI.runnerLog?.("✔ Runner finished");
    setRunner({ running: false, stopping: false });
  }
  function pauseRunner() { setRunner((r) => ({ ...r, stopping: true })); }

  /* ----- File menu: Export / Import ----- */
  function doExport() {
    const json = canvasApiRef.current?.exportJSON() || {};
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `yolandi-workflow-${Date.now()}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  }
  function doImportFile() { fileInputRef.current?.click(); }
  function onImportChange(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { const doc = JSON.parse(String(reader.result)); canvasApiRef.current?.importJSON(doc); log("Workflow imported", "INFO"); }
      catch (err) { log("Import failed: " + (err?.message || err), "ERROR"); }
    };
    reader.readAsText(file); e.target.value = "";
  }

  const fileMenu = [
    { label: "New Workflow", onClick: openNewTab },
    { label: "Save", onClick: () => window.YOLANDI.actions.saveWorkflow?.() },
    { label: "Save as…", onClick: () => window.YOLANDI.actions.saveAsWorkflow?.() },
    { label: "—", onClick: null },
    { label: "Export JSON…", onClick: doExport },
    { label: "Import JSON…", onClick: doImportFile },
  ];

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

  const installedSlugs = useMemo(() => {
    const arr = [];
    for (const n of manifest) { const s = n?.meta?.type || n?.meta?.title; if (s) arr.push(s); }
    return Array.from(new Set(arr));
  }, [manifest]);

  return (
    <div id="ystudio" data-palette={paletteOpen ? "open" : "closed"}>
      {/* hidden file input for import */}
      <input type="file" ref={fileInputRef} accept="application/json" onChange={onImportChange} style={{ display: "none" }} />

      {/* Menubar */}
      <div id="ystudio-menubar">
        <div className="left">
          <span className="title">YOLANDI Studio</span>
          <DropMenu label="File" items={fileMenu} />
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
          <button className={`nav-icon ${runner.running ? "active" : ""}`} title={runner.running ? "Pause Runner" : "Run Workflow"} onClick={() => (runner.running ? pauseRunner() : playRunner())}>
            <i className={`fa fa-${runner.running ? "pause" : "play"}`} />
          </button>
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
            <span className="label">
              {activePanel === "loop" ? "Loop Nodes" : activePanel === "shop" ? "Shop" : "Puppeteer Nodes"}
            </span>
            <button className="icon-btn" onClick={togglePalette} title="Toggle Sidebar">
              <i className="fa fa-angles-left"></i>
            </button>
          </div>

          <div className="palette-scroll">
            {activePanel === "shop" ? (
              <div style={{ padding: 8, color: "#bbb", fontSize: 12 }}>
                Browse premium & free nodes in the main area →
              </div>
            ) : (
              <NodeTree
                grouped={grouped}
                onDragStart={(e, node) => {
                  const meta = node.meta || {};
                  e.dataTransfer.setData("application/x-yolandi-node", JSON.stringify(meta));
                  e.dataTransfer.effectAllowed = "copy";
                  log(`Dragging node: ${meta.title || meta.type || node.path}`);
                }}
              />
            )}
          </div>
        </div>

        {/* Editor */}
        <div id="ystudio-editor">
          {/* Tabs */}
          <div className="tabs">
            {tabs.map((t) => (
              <div key={t.id} className={`tab ${t.id === activeTabId ? "active" : ""}`} onClick={() => setActiveTabId(t.id)}>
                <span className="name">{t.title}{t.dirty ? "*" : ""}</span>
                <button className="close" onClick={(e) => (e.stopPropagation(), closeTab(t.id))}><i className="fa fa-xmark"></i></button>
              </div>
            ))}
            <button className="tab add" onClick={openNewTab} title="New Workflow"><i className="fa fa-plus"></i></button>
          </div>

          {/* Canvas OR Shop View */}
          <div
            id="ystudio-editor-host"
            style={{ position: "relative", flex: 1, minHeight: 0 }}
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
              // IMPORTANT: pass client coords; NodeCanvas converts to world
              window.YOLANDI.actions.onNodeDrop?.(meta, { x: e.clientX, y: e.clientY });
            }}
          >
            {activePanel === "shop" ? (
              <ShopView auth={auth} installedSlugs={installedSlugs} onClose={() => setActivePanel("puppeteer")} />
            ) : (
              <NodeCanvas registerApi={(api) => (canvasApiRef.current = api)} />
            )}
          </div>

          {/* Bottom panel */}
          <div id="ystudio-panel" ref={panelRef} style={{ "--panel-height": "220px" }}>
            <div id="ystudio-panel-tabs">
              <div className={`tab ${panelTab==="console"?"active":""}`} onClick={()=>setPanelTab("console")}><i className="fa fa-terminal" /> Console</div>
              <div className={`tab ${panelTab==="runner"?"active":""}`} onClick={()=>setPanelTab("runner")}><i className="fa fa-gauge-high" /> Runner Log</div>
              <div className="spacer" />
              <div className="controls">
                <button onClick={() => (document.querySelector(panelTab==="console"?"#ystudio-terminal pre":"#ystudio-runner pre").textContent = "")} title="Clear"><i className="fa fa-broom"></i></button>
                <button onClick={() => log("Ping")} title="Test log"><i className="fa fa-message"></i></button>
                <button onClick={() => log(JSON.stringify(window.YOLANDI.exportWorkflow?.() || {}, null, 2), "DATA")} title="Dump JSON"><i className="fa fa-file-code"></i></button>
              </div>
            </div>
            <div id="ystudio-panel-body">
              <div id="ystudio-terminal" style={{display: panelTab==="console"?"block":"none"}}><pre /></div>
              <div id="ystudio-runner" style={{display: panelTab==="runner"?"block":"none"}}><pre /></div>
            </div>
            <div id="ystudio-panel-drag" ref={panelDragRef} title="Resize panel" />
          </div>
        </div>
      </div>

      {/* Auth modal */}
      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          onLoggedIn={() => setShowAuth(false)}
          login={authLogin}
          register={authRegister}
        />
      )}

      {/* Status bar */}
      <div id="ystudio-statusbar">
        <div className="left"><i className="fa fa-code-branch" /> main <span className="sep" /> <i className="fa fa-circle" /> Ready</div>
        <div className="right"><i className="fa fa-gauge-high" /> Runner: {runner.running ? "running" : "idle"} <span className="sep" /> <i className="fa fa-rotate" /> Auto-save</div>
      </div>
    </div>
  );
}

/* ---------- subcomponents ---------- */
function DropMenu({ label, items }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`menu ${open ? "open" : ""}`} onMouseLeave={() => setOpen(false)}>
      <button onMouseEnter={() => setOpen(true)} onClick={() => setOpen((v) => !v)}>{label}</button>
      {open && (
        <div className="menu-popover">
          {items.map((it, i) =>
            it.label === "—" ? <div key={i} className="menu-sep" /> :
            <div key={i} className="menu-item" onClick={() => (setOpen(false), it.onClick && it.onClick())}>{it.label}</div>
          )}
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
                  <div key={name + n.path} className="node-item" draggable title={name} onDragStart={(e) => onDragStart(e, n)}>
                    <i className="fa fa-cube" /><span>{name}</span>
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

/* ---------- Shop overlay ---------- */
function ShopView({ auth, installedSlugs, onClose }) {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);

  async function fetchPage(p=1) {
    setLoading(true);
    try {
      const url = new URL("https://yolandi.org/wp-json/yolandi-shop/v1/products");
      url.searchParams.set("page", p);
      url.searchParams.set("per_page", 12);
      url.searchParams.set("installed_slugs", JSON.stringify(installedSlugs || []));
      const res = await fetch(url, { headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {} });
      const j = await res.json();
      if (p === 1) setItems(j.items || []); else setItems((x) => [...x, ...(j.items||[])]);
      setPage(j.page || p);
      setHasMore(!!j.has_more);
    } catch {
      setItems(Array.from({length:9}).map((_,i)=>({
        id: 1000+i, name: "Premium Node "+(i+1), slug:"demo.node"+i,
        short_description:"Premium capability node.", price_html:"$9.00",
        image:"", rating_count:10, average_rating:4.6, purchased:false, installed:false, downloadable:false
      })));
      setHasMore(false);
    } finally { setLoading(false); }
  }
  useEffect(()=>{ fetchPage(1); },[]);

  async function addToCart(prodId) {
    try {
      const res = await fetch("https://yolandi.org/wp-json/yolandi-shop/v1/order", {
        method:"POST",
        headers:{ "Content-Type":"application/json", ...(auth.token?{Authorization:`Bearer ${auth.token}`}:{}) },
        body: JSON.stringify({ items: [{ product_id: prodId, quantity: 1 }] })
      });
      const j = await res.json();
      if (j.payment_url) {
        const iframe = document.createElement("iframe");
        Object.assign(iframe.style,{position:"fixed",inset:"40px",border:"1px solid #2b2b2b",borderRadius:"8px",zIndex:9999,background:"#fff"});
        iframe.src = j.payment_url;
        const close = document.createElement("button");
        close.innerHTML = "×";
        Object.assign(close.style,{position:"fixed",top:"10px",right:"10px",zIndex:10000,background:"#1e1e1e",color:"#fff",border:"0",borderRadius:"6px",width:"32px",height:"32px"});
        close.onclick = ()=>{ iframe.remove(); close.remove(); };
        document.body.appendChild(iframe); document.body.appendChild(close);
      }
    } catch {}
  }

  return (
    <div className="shop-wrap">
      <div className="shop-head">
        <div className="left"><i className="fa fa-store" /> YOLANDI Marketplace</div>
        <div className="right">
          <button className="btn" onClick={()=>fetchPage(1)}><i className="fa fa-rotate" /> Refresh</button>
          <button className="btn" onClick={onClose}><i className="fa fa-xmark" /> Close</button>
        </div>
      </div>
      <div className="shop-grid">
        {items.map(it => (
          <div key={it.id} className="shop-card">
            <div className="thumb">{it.image ? <img src={it.image} alt="" /> : <i className="fa fa-cube" />}</div>
            <div className="name" title={it.name}>{it.name}</div>
            <div className="desc">{it.short_description}</div>
            <div className="meta">
              <span className="price" dangerouslySetInnerHTML={{__html: it.price_html || ""}} />
              <span className="rate"><i className="fa fa-star" /> {it.average_rating?.toFixed?.(1) || "—"}</span>
            </div>
            {it.installed ? (
              <button className="btn installed" disabled>Installed</button>
            ) : it.purchased ? (
              <button className="btn" onClick={()=>window.YOLANDI.actions.installPurchased?.(it)}>Download</button>
            ) : (
              <button className="btn primary" onClick={()=>addToCart(it.id)}>Add to Cart</button>
            )}
          </div>
        ))}
        {loading && <div className="loading">Loading…</div>}
      </div>
      {hasMore && <div className="shop-more"><button className="btn" onClick={()=>fetchPage(page+1)}>Load more</button></div>}
    </div>
  );
}

/* ---------- Auth modal ---------- */
function AuthModal({ onClose, onLoggedIn, login, register }) {
  const [mode,setMode]=useState("login");
  const [f,setF]=useState({username:"",email:"",password:""});
  const [err,setErr]=useState("");
  async function go() {
    const ok = mode==="login"
      ? await login({username:f.username, password:f.password})
      : await register({email:f.email, username:f.username, password:f.password});
    if (!ok) setErr("Authentication failed"); else onLoggedIn();
  }
  return (
    <div className="auth-mask">
      <div className="auth-modal">
        <div className="head"><b>Sign in to YOLANDI.org</b><button onClick={onClose}><i className="fa fa-xmark"/></button></div>
        <div className="body">
          {mode==="register" && <label>Email <input type="email" value={f.email} onChange={(e)=>setF({...f,email:e.target.value})}/></label>}
          <label>Username <input value={f.username} onChange={(e)=>setF({...f,username:e.target.value})}/></label>
          <label>Password <input type="password" value={f.password} onChange={(e)=>setF({...f,password:e.target.value})}/></label>
          {err && <div className="err">{err}</div>}
        </div>
        <div className="foot">
          <button onClick={go} className="primary">{mode==="login"?"Login":"Create Account"}</button>
          <button onClick={()=>setMode(mode==="login"?"register":"login")} className="ghost">
            {mode==="login"?"Create an account":"Back to login"}
          </button>
          <div className="grow" />
          <button onClick={()=>{window.YOLANDI.devBypass(); onLoggedIn();}} className="ghost" title="Developer bypass">Bypass</button>
        </div>
      </div>
    </div>
  );
}
