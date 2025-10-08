// =========================
// FILE: admin/components/NodeCanvas.jsx
// =========================
import React, { useEffect, useMemo, useRef, useState } from "react";

const uid = () => Math.random().toString(36).slice(2, 9);

export default function NodeCanvas({ registerApi }) {
  // helpers for port centers
  function portElKey(type, nid, pid) { return `${type}:${nid}:${pid}`; }
  function getPortCenterScreen(type, nid, pid) {
    const el = document.querySelector(`[data-port-key="${portElKey(type, nid, pid)}"] .dot`) || document.querySelector(`[data-port-key="${portElKey(type, nid, pid)}"]`);
    if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  const NODE_W = 280, HEAD_H = 28, ROW_H = 22;
  const wrapRef = useRef(null); const contentRef = useRef(null);
  const [nodes, setNodes] = useState([]); const [links, setLinks] = useState([]);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 }); const [mode, setMode] = useState("select");
  const [drag, setDrag] = useState(null); const [wip, setWip] = useState(null); const [marq, setMarq] = useState(null);
  const kMin = 0.3, kMax = 2.0;

  const toWorld = (clientX, clientY) => { const rect = wrapRef.current.getBoundingClientRect(); return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k }; };
  const nodeById = (nid) => nodes.find((n) => n.id === nid);

  useEffect(() => {
    const api = {
      addNodeByMeta(meta, posScr) {
        const { x, y } = toWorld(posScr.x, posScr.y);
        const id = "n" + uid(); const title = meta?.title || meta?.type || "Node"; const props = meta?.props || {}; const fields = {};
        for (const [k, spec] of Object.entries(props)) fields[k] = spec?.default ?? "";
        const inputs = (meta?.io?.inputs || ["in"]).map((name, i) => ({ id: "i" + i, name }));
        const outputs = (meta?.io?.outputs || ["out"]).map((name, i) => ({ id: "o" + i, name }));
        setNodes((N) => [...N, { id, x: Math.round(x - NODE_W / 2), y: Math.round(y - 16), w: NODE_W, title, meta, fields, inputs, outputs, selected:false }]);
      },
      exportJSON() { return { version: 1, view, nodes: nodes.map(n=>({ id:n.id, title:n.title, type:n.meta?.type||null, x:n.x, y:n.y, w:n.w, fields:n.fields, inputs:n.inputs, outputs:n.outputs })), links }; },
      importJSON(doc){ if(!doc||!Array.isArray(doc.nodes)) return; setView(doc.view||{x:0,y:0,k:1}); setNodes(doc.nodes.map(n=>({ id:n.id, title:n.title||"Node", meta:{type:n.type||"Imported"}, x:n.x, y:n.y, w:n.w||NODE_W, fields:n.fields||{}, inputs:n.inputs||[{id:"i0",name:"in"}], outputs:n.outputs||[{id:"o0",name:"out"}], selected:false }))); setLinks(Array.isArray(doc.links)?doc.links:[]); },
      setMode,
    };
    registerApi?.(api);
    window.YOLANDI = window.YOLANDI || {}; window.YOLANDI.exportWorkflow = () => api.exportJSON(); window.YOLANDI.importWorkflow = (doc) => api.importJSON(doc);
  }, [nodes, links, view, registerApi]);

  const getPortCenterWorld = (type, nid, pid) => { const scr = getPortCenterScreen(type, nid, pid); if (!scr) return null; const rect = wrapRef.current.getBoundingClientRect(); return { x: (scr.x - rect.left - view.x) / view.k, y: (scr.y - rect.top - view.y) / view.k }; };
  const wirePaths = useMemo(() => {
    const paths = [];
    for (const L of links) {
      const p1 = getPortCenterWorld("out", L.from.nid, L.from.pid); const p2 = getPortCenterWorld("in", L.to.nid, L.to.pid);
      if (!p1 || !p2) continue; const dx = Math.max(40, Math.abs(p2.x - p1.x) * 0.6);
      paths.push({ id: L.id, d: `M ${p1.x},${p1.y} C ${p1.x + dx},${p1.y} ${p2.x - dx},${p2.y} ${p2.x},${p2.y}` });
    }
    if (wip) { const p1 = getPortCenterWorld("out", wip.from.nid, wip.from.pid); const p2 = toWorld(wip.x, wip.y); if (p1 && p2) { const dx = Math.max(40, Math.abs(p2.x - p1.x) * 0.6); paths.push({ id: "_wip", d: `M ${p1.x},${p1.y} C ${p1.x + dx},${p1.y} ${p2.x - dx},${p2.y} ${p2.x},${p2.y}` }); } }
    return paths;
  }, [links, wip, nodes, view]);

  function zoomAt(factor, pivotScreen){ setView(v=>{ const kMin=0.3,kMax=2.0; const k=Math.min(kMax,Math.max(kMin,v.k*factor)); if(!pivotScreen) return {...v,k}; const rect=wrapRef.current.getBoundingClientRect(); const px=(pivotScreen.x-rect.left-v.x)/v.k; const py=(pivotScreen.y-rect.top-v.y)/v.k; const nx=pivotScreen.x-rect.left-px*k; const ny=pivotScreen.y-rect.top-py*k; return {x:nx,y:ny,k}; }); }
  useEffect(()=>{ const el=wrapRef.current; if(!el) return; const onWheel=(e)=>{ if(e.ctrlKey){ e.preventDefault(); zoomAt(e.deltaY<0?1.1:1/1.1,{x:e.clientX,y:e.clientY}); } else if(mode==="pan"){ e.preventDefault(); setView(v=>({...v,x:v.x-e.deltaX,y:v.y-e.deltaY})); } }; el.addEventListener("wheel",onWheel,{passive:false}); return ()=>el.removeEventListener("wheel",onWheel); },[mode]);

  function onCanvasMouseDown(e){ if(e.target.closest?.(".yc-node")||e.target.closest?.(".yc-port")) return; if(mode==="pan"||e.button===1){ const start={sx:e.clientX,sy:e.clientY,vx:view.x,vy:view.y}; const move=(ev)=>setView({x:start.vx+(ev.clientX-start.sx),y:start.vy+(ev.clientY-start.sy),k:view.k}); const up=()=>{window.removeEventListener("mousemove",move); window.removeEventListener("mouseup",up);}; window.addEventListener("mousemove",move); window.addEventListener("mouseup",up); return; }
    const startW=toWorld(e.clientX,e.clientY); let box={sx:startW.x,sy:startW.y,ex:startW.x,ey:startW.y,sxScr:e.clientX,syScr:e.clientY,exScr:e.clientX,eyScr:e.clientY}; setMarq(box);
    const move=(ev)=>{ const w=toWorld(ev.clientX,ev.clientY); box={...box,ex:w.x,ey:w.y,exScr:ev.clientX,eyScr:ev.clientY}; setMarq(box);
      const x1=Math.min(box.sx,box.ex), y1=Math.min(box.sy,box.ey), x2=Math.max(box.sx,box.ex), y2=Math.max(box.sy,box.ey);
      setNodes(N=>N.map(n=>{ const H=HEAD_H+8+Math.max(n.inputs.length,n.outputs.length)*ROW_H+12+Object.keys(n.fields).length*(ROW_H+4); const nx1=n.x,ny1=n.y,nx2=n.x+n.w,ny2=n.y+H; const hit=!(nx2<x1||nx1>x2||ny2<y1||ny1>y2); return {...n,selected:hit}; })); };
    const up=()=>{ setMarq(null); window.removeEventListener("mousemove",move); window.removeEventListener("mouseup",up); };
    window.addEventListener("mousemove",move); window.addEventListener("mouseup",up);
  }

  function onHeadDown(e,nid){ if(e.button!==0) return; startDragFromNode(e,nid); }
  function onNodeDown(e,nid){ if(e.button!==0) return; const tag=e.target.tagName; if(["INPUT","SELECT","TEXTAREA","BUTTON"].includes(tag)) return; if(e.target.closest(".yc-port")) return; startDragFromNode(e,nid); }
  function startDragFromNode(e,nid){ const n=nodeById(nid); if(!n) return; const ids=nodes.filter(x=>x.selected).map(x=>x.id); const moving=ids.length?ids:[nid]; const start=toWorld(e.clientX,e.clientY); const offsets=moving.map(id=>{ const node=nodeById(id); return {id,dx:start.x-node.x,dy:start.y-node.y}; }); setDrag({ids:moving,offsets}); e.stopPropagation(); }
  useEffect(()=>{ const onMove=(e)=>{ if(!drag) return; const w=toWorld(e.clientX,e.clientY); setNodes(N=>N.map(n=>{ const m=drag.offsets.find(o=>o.id===n.id); return m?{...n,x:Math.round(w.x-m.dx),y:Math.round(w.y-m.dy)}:n; })); }; const onUp=()=>setDrag(null); window.addEventListener("mousemove",onMove); window.addEventListener("mouseup",onUp); return ()=>{ window.removeEventListener("mousemove",onMove); window.removeEventListener("mouseup",onUp); }; },[drag]);

  function startWire(fromNid,outPid,ev){ const el=document.querySelector(`[data-port-key="out:${fromNid}:${outPid}"] .dot`); if(!el) return; const r=el.getBoundingClientRect(); setWip({from:{nid:fromNid,pid:outPid}, x:r.left+r.width/2, y:r.top+r.height/2}); ev.stopPropagation(); }
  function moveWire(ev){ if(!wip) return; setWip(W=>({...W,x:ev.clientX,y:ev.clientY})); }
  function nearestInputPortWorld(xw,yw){ const ports=Array.from(document.querySelectorAll('.yc-port.in')); let best=null, bestD2=256; for(const el of ports){ const k=el.getAttribute('data-port-key'); const [,nid,pid]=k.split(':'); const c=getPortCenterWorld('in',nid,pid); if(!c) continue; const dx=c.x-xw, dy=c.y-yw, d2=dx*dx+dy*dy; if(d2<bestD2){ bestD2=d2; best={nid,pid}; } } return best; }
  function acceptWire(toNid,inPid,ev){ if(!wip) return; if(!toNid||!inPid){ const p2=toWorld(ev.clientX,ev.clientY); const near=nearestInputPortWorld(p2.x,p2.y); if(near){ toNid=near.nid; inPid=near.pid; } } if(!toNid||!inPid){ setWip(null); return; } const id="l"+uid(); const link={id, from:wip.from, to:{nid:toNid,pid:inPid}}; setLinks(L=>[...L.filter(x=>!(x.to.nid===toNid&&x.to.pid===inPid)), link]); setWip(null); ev.stopPropagation(); }
  function endWire(){ if(wip) setWip(null); }

  function fitToContent(){ if(!nodes.length){ setView({x:0,y:0,k:1}); return; } const pad=60; let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity; for(const n of nodes){ const H=HEAD_H+8+Math.max(n.inputs.length,n.outputs.length)*ROW_H+12+Object.keys(n.fields).length*(ROW_H+4); minX=Math.min(minX,n.x); maxX=Math.max(maxX,n.x+n.w); minY=Math.min(minY,n.y); maxY=Math.max(maxY,n.y+H); } const rect=wrapRef.current.getBoundingClientRect(); const w=rect.width-pad*2, h=rect.height-pad*2; const k=Math.min(kMax,Math.max(kMin,Math.min(w/(maxX-minX),h/(maxY-minY)))); const x=pad-minX*k+(rect.width-(maxX-minX)*k-pad*2)/2; const y=pad-minY*k+(rect.height-(maxY-minY)*k-pad*2)/2; setView({x,y,k}); }

  return (
    <div id="yc-canvas" ref={wrapRef} style={{ position:"absolute", inset:0 }} onMouseMove={moveWire} onMouseUp={endWire} onMouseDown={onCanvasMouseDown}
      onDragOver={(e)=>{ if(e.dataTransfer?.types?.includes("application/x-yolandi-node")){ e.preventDefault(); e.dataTransfer.dropEffect='copy'; } }}
      onDrop={(e)=>{ const dt=e.dataTransfer?.getData("application/x-yolandi-node"); if(!dt) return; e.preventDefault(); e.stopPropagation(); const meta=JSON.parse(dt); window.YOLANDI.actions.onNodeDrop?.(meta,{x:e.clientX,y:e.clientY}); }}>

      <div ref={contentRef} className="yc-content" style={{ position:"absolute", left:0, top:0, width:"100%", height:"100%", transformOrigin:"0 0", transform:`translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="yc-wires" width="20000" height="12000" style={{ position:"absolute", left:0, top:0, overflow:"visible", pointerEvents:"none", zIndex:0 }}>
          {wirePaths.map(p=> (<path key={p.id} d={p.d} className={p.id==="_wip"?"yc-wire wip":"yc-wire"} stroke={p.id==="_wip"?"rgba(96,165,250,.7)":"rgba(96,165,250,.95)"} strokeWidth={2} fill="none" style={{ vectorEffect:"non-scaling-stroke" }} />))}
        </svg>
        {nodes.map(n=> (
          <div key={n.id} className={`yc-node ${n.selected?"selected":""}`} style={{ left:n.x, top:n.y, width:n.w, position:"absolute", zIndex:1 }} onMouseDown={(e)=>onNodeDown(e,n.id)}>
            <div className="yc-head" onMouseDown={(e)=>onHeadDown(e,n.id)} title={n.title}><i className="fa fa-grip-lines" /><span>{n.title}</span></div>
            <div className="yc-ports">
              <div className="col in">{n.inputs.map(p=> (
                <div key={p.id} className="yc-port in" data-port-key={`in:${n.id}:${p.id}`} onMouseUp={(e)=>acceptWire(n.id,p.id,e)}>
                  <span className="dot"/><span className="name">{p.name}</span>
                </div>))}
              </div>
              <div className="col out">{n.outputs.map(p=> (
                <div key={p.id} className="yc-port out" data-port-key={`out:${n.id}:${p.id}`} onMouseDown={(e)=>startWire(n.id,p.id,e)}>
                  <span className="name">{p.name}</span><span className="dot"/>
                </div>))}
              </div>
            </div>
            <div className="yc-body">
              {Object.entries(n.fields).map(([key,val])=>{
                const spec=n.meta?.props?.[key]||{type:"string"}; const t=(spec.type||"string").toLowerCase();
                const onChange=(v)=> setNodes(N=> N.map(x=> x.id===n.id?{...x,fields:{...x.fields,[key]:v}}:x));
                if(["bool","boolean","checkbox"].includes(t)) return (<label key={key} className="row check"><input type="checkbox" checked={!!val} onChange={(e)=>onChange(e.target.checked)}/><span className="lab">{key}</span></label>);
                if(t==="number") return (<label key={key} className="row"><span className="lab">{key}</span><input type="number" value={val??""} onChange={(e)=>onChange(e.target.value===""?"":Number(e.target.value))}/></label>);
                if(t==="select") return (<label key={key} className="row"><span className="lab">{key}</span><select value={val??""} onChange={(e)=>onChange(e.target.value)}>{(spec.options||[]).map(opt=> <option key={String(opt)} value={opt}>{String(opt)}</option>)}</select></label>);
                return (<label key={key} className="row"><span className="lab">{key}</span><input type="text" value={val??""} onChange={(e)=>onChange(e.target.value)}/></label>);
              })}
            </div>
          </div>))}
      </div>
      {marq && (<div className="yc-marquee" style={{ position:"fixed", border:"1px dashed rgba(96,165,250,.9)", background:"rgba(96,165,250,.12)", pointerEvents:"none", zIndex:10, left:Math.min(marq.sxScr,marq.exScr), top:Math.min(marq.syScr,marq.eyScr), width:Math.abs(marq.exScr-marq.sxScr), height:Math.abs(marq.eyScr-marq.syScr) }}/>) }
    </div>
  );
}