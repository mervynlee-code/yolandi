// =========================
// FILE: admin/plugins/activityLoader.js
// =========================
import React, { useEffect, useMemo, useState } from "react";

// Lazy-import any file under ../activity/*/index.jsx that exports { meta, create }
const modules = import.meta.glob("../activity/*/index.{jsx,tsx,js,ts}");
console.log(modules)

export function useActivityPlugins({ manifest, log, auth }) {
  const [plugins, setPlugins] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = [];
      if (import.meta?.env?.DEV) {
        console.info("[activityLoader] candidates:", Object.keys(modules));
      }
      for (const [path, loader] of Object.entries(modules)) {
        try {
          const mod = await loader();
          const meta = mod.meta || {}; // { id, icon, title }
          const create = mod.create || (() => ({ id: "x", title: "Unknown", icon: "fa-cube", render: () => null }));
          const instance = create({ manifest, log, auth });
          loaded.push({
            id: meta.id || instance.id,
            title: meta.title || instance.title,
            icon: meta.icon || instance.icon, // icon is like "fa-spider"
            render: instance.render
          });
        } catch (e) { console.warn("Activity load failed", path, e); }
      }
      if (!cancelled) setPlugins(loaded);
    })();
    return () => { cancelled = true; };
  }, [manifest, log, auth]);

  // Fallback if no plugin files bundled
  const fallback = useMemo(() => {
    if (plugins.length) return [];
    return [{
      id: "puppeteer",
      title: "Puppeteer",
      icon: "fa-angle",
      render: () => (
        <div style={{ padding: 8, color: "#bbb", fontSize: 12 }}>
          No activity plugins found. Add files under <code>admin/activity/*/index.jsx</code>.
        </div>
      )
    }];
  }, [plugins]);
  return plugins.length ? plugins : fallback;
}