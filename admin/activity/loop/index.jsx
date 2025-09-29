// =========================
// FILE: admin/activity/loop/index.jsx
// =========================
import React, { useMemo } from "react";
import NodeTree from "../../components/NodeTree.jsx";

export const meta = { id:"loop", icon:"fa-arrows-rotate", title:"Loop" };
export function create({ manifest, log }){
  const grouped = useMemo(() => {
    const g = {}; for (const n of manifest) { const folder = n?.meta?.category || n?.meta?.type || "Misc"; if (!g[folder]) g[folder] = []; g[folder].push(n); }
    const out = {}; for (const [folder, arr] of Object.entries(g)) { const f = folder.toLowerCase(); if (f.includes("loop") || f.includes("iterate")) out[folder] = arr; }
    return Object.keys(out).length ? out : g;
  }, [manifest]);
  return {
    id: meta.id,
    title: meta.title,
    icon: `fa ${meta.icon}`,
    render: () => (
      <NodeTree grouped={grouped} onDragStart={(e, node) => { const meta = node.meta || {}; e.dataTransfer.setData("application/x-yolandi-node", JSON.stringify(meta)); e.dataTransfer.effectAllowed = "copy"; log(`Dragging node: ${meta.title || meta.type || node.path}`); }} />
    )
  };
}