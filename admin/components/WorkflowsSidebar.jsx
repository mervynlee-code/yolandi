import React, { useEffect, useMemo, useState, useCallback } from "react";

/**
 * WorkflowsSidebar
 * - Fetches /wp-json/yolandi/v1/workflows
 * - Shows collapsible trees for each base (Plugin / Uploads / Theme)
 * - Clicking a file fetches /workflow and dispatches a window event to open a new tab
 *
 * Integration:
 * - Listen for "yolandi:open-workflow" in your Graph/Tab host to spawn a new tab.
 */

const API_BASE = window?.ajaxurl
  ? new URL("/wp-json/yolandi/v1", window.location.origin).toString()
  : "/wp-json/yolandi/v1";

function usePersistedState(key, initial) {
  const [val, setVal] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key)) ?? initial; } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }, [key, val]);
  return [val, setVal];
}

function Chevron({ open }) {
  return (
    <span
      className={`inline-block transition-transform duration-150 mr-1 ${open ? "rotate-90" : ""}`}
      style={{ width: 12, display: "inline-block", textAlign: "center" }}
    >
      ▶
    </span>
  );
}

function TreeNode({ node, baseKey, depth, expanded, toggle, onOpen }) {
  const pad = 8 + depth * 12;

  if (node.type === "dir") {
    const isOpen = !!expanded[node.rel ?? node.name];
    return (
      <div>
        <div
          className="yol-tree-row"
          style={{ paddingLeft: pad, cursor: "pointer" }}
          onClick={() => toggle(node.rel ?? node.name)}
          title={node.rel || node.name}
        >
          <Chevron open={isOpen} />
          <strong>{node.name}</strong>
        </div>
        {isOpen && (node.children || []).map((child) => (
          <TreeNode
            key={`${child.type}-${child.rel ?? child.name}`}
            node={child}
            baseKey={baseKey}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            onOpen={onOpen}
          />
        ))}
      </div>
    );
  }

  // file
  return (
    <div
      className="yol-tree-row yol-tree-file"
      style={{ paddingLeft: pad + 16, cursor: "pointer" }}
      onClick={() => onOpen(baseKey, node)}
      title={node.rel || node.name}
    >
      <span style={{ marginRight: 6 }}>📄</span>
      <span>{node.name}</span>
    </div>
  );
}

export default function WorkflowsSidebar() {
  const [loading, setLoading] = useState(false);
  const [trees, setTrees] = useState([]);
  const [query, setQuery] = useState("");

  const [expanded, setExpanded] = usePersistedState("yolandi.workflows.expanded", {});
  const toggle = useCallback((key) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }, [setExpanded]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/workflows`, { credentials: "same-origin" });
        const json = await res.json();
        if (alive) setTrees(Array.isArray(json) ? json : []);
      } catch (e) {
        console.error("[WorkflowsSidebar] failed to fetch", e);
        if (alive) setTrees([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const onOpen = useCallback(async (baseKey, fileNode) => {
    try {
      const url = new URL(`${API_BASE}/workflow`, window.location.origin);
      url.searchParams.set("baseKey", baseKey);
      url.searchParams.set("rel", fileNode.rel);
      const res = await fetch(url.toString(), { credentials: "same-origin" });
      const data = await res.json();
      if (data?.error) throw new Error(data.error);

      // Dispatch a global event for your Graph host to catch
      window.dispatchEvent(new CustomEvent("yolandi:open-workflow", {
        detail: {
          baseKey,
          rel: data.rel,
          name: data.name,
          content: String(data.content ?? ""),
          mtime: data.mtime || null,
          // You can carry additional metadata here as needed
        }
      }));
    } catch (e) {
      alert(`Failed to open workflow: ${e.message}`);
      console.error(e);
    }
  }, []);

  const filter = query.trim().toLowerCase();
  const filteredTrees = useMemo(() => {
    if (!filter) return trees;

    const match = (name) => name.toLowerCase().includes(filter);

    function filterNode(node) {
      if (node.type === "file") return match(node.name) ? node : null;
      // dir: include if any child matches or dir name matches
      const kids = (node.children || []).map(filterNode).filter(Boolean);
      if (kids.length || match(node.name)) {
        return { ...node, children: kids };
      }
      return null;
    }

    return trees.map((b) => ({
      ...b,
      tree: (b.tree || []).map(filterNode).filter(Boolean)
    }));
  }, [trees, filter]);

  return (
    <div className="yol-workflows-sidebar">
      <div className="yol-wfs-header">
        <div className="yol-wfs-title">Workflows</div>
        {loading ? <div className="yol-wfs-loading">Loading…</div> : null}
      </div>

      <div className="yol-wfs-search">
        <input
          type="search"
          placeholder="Search workflows…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="yol-wfs-tree">
        {filteredTrees.length === 0 && !loading && (
          <div className="yol-empty">No workflows yet. Create one in Uploads.</div>
        )}

        {filteredTrees.map((base) => (
          <div key={base.baseKey} className="yol-wfs-section">
            <div className="yol-wfs-section-title">{base.label}</div>
            {(base.tree || []).map((node) => (
              <TreeNode
                key={`${node.type}-${node.rel ?? node.name}`}
                node={node}
                baseKey={base.baseKey}
                depth={0}
                expanded={expanded}
                toggle={toggle}
                onOpen={onOpen}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
