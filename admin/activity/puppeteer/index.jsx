import React, { useMemo } from "react";
import NodeTree from "../../components/NodeTree.jsx";

export const meta = { id: "puppeteer", icon: "fa-spider", title: "Puppeteer" };

export function create({ manifest, log }) {
  function Panel() {
    const grouped = useMemo(() => {
      const g = {};
      for (const n of manifest || []) {
        const folder = n?.meta?.category || n?.meta?.type || "Misc";
        (g[folder] ||= []).push(n);
      }
      const out = {};
      for (const [folder, arr] of Object.entries(g)) {
        const f = folder.toLowerCase();
        if (f.includes("puppeteer")) out[folder] = arr;
      }
      return Object.keys(out).length ? out : g;
    }, [manifest]);

    return (
      <NodeTree
        grouped={grouped}
        onDragStart={(e, node) => {
          const m = node.meta || {};
          e.dataTransfer.setData("application/x-yolandi-node", JSON.stringify(m));
          e.dataTransfer.effectAllowed = "copy";
          log?.(`Dragging node: ${m.title || m.type || node.path}`);
        }}
      />
    );
  }

  return { id: meta.id, title: meta.title, icon: meta.icon, render: () => <Panel /> };
}
