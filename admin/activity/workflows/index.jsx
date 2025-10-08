/* ../activity/workflows/index.jsx */
/* global window, document */
const React = (window.React || (window.wp && window.wp.element));
const { useEffect, useState } = React;

export const meta = { id: "workflows", icon: "fa-folder-tree", title: "Workflows" };

/** WP REST base helper so it works in dev/prod without 404s */
function wpRestRoot() {
  const root =
    (window.wpApiSettings && window.wpApiSettings.root) ||
    (window.wp && window.wp.apiSettings && window.wp.apiSettings.root) ||
    "/wp-json/";
  return (root || "/wp-json/").replace(/\/$/, "");
}

/** Minimal styles (injected once) */
function ensureCSS() {
  if (document.getElementById("yolandi-workflows-css")) return;
  const css = `
  .yol-wfs { display:flex; flex-direction:column; height:100%; background:#0f172a; color:#e5e7eb; font-size:13px; }
  .yol-wfs__hdr { display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border-bottom:1px solid #1f2937; }
  .yol-wfs__title { font-weight:700; letter-spacing:.2px; }
  .yol-wfs__search { padding:8px 10px; border-bottom:1px solid #1f2937; }
  .yol-wfs__search input { width:100%; padding:6px 8px; border-radius:6px; background:#0b1220; border:1px solid #233046; color:#e5e7eb; }
  .yol-wfs__tree { overflow:auto; padding:6px 0 12px; flex:1; }
  .yol-wfs__section { margin-top:10px; }
  .yol-wfs__sectionTitle { font-size:11px; text-transform:uppercase; opacity:.7; padding:6px 10px; border-left:3px solid #334155; }
  .yol-tree__row { padding:4px 10px; line-height:1.5; user-select:none; cursor:pointer; }
  .yol-tree__row:hover { background:rgba(148,163,184,.08); }
  .yol-tree__file { display:flex; align-items:center; }
  .yol-empty { padding:12px; opacity:.7; }
  `;
  const style = document.createElement("style");
  style.id = "yolandi-workflows-css";
  style.textContent = css;
  document.head.appendChild(style);
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

function TreeNode({ node, baseKey, depth, expanded, onToggle, onOpen }) {
  const pad = 8 + depth * 12;

  if (node.type === "dir") {
    const key = node.rel || node.name;
    const isOpen = !!expanded[key];
    return (
      <div>
        <div
          className="yol-tree__row"
          style={{ paddingLeft: pad }}
          onClick={() => onToggle(key)}
          title={node.rel || node.name}
        >
          <Chevron open={isOpen} />
          <strong>{node.name}</strong>
        </div>
        {isOpen &&
          (node.children || []).map((child) => (
            <TreeNode
              key={`${child.type}-${child.rel ?? child.name}`}
              node={child}
              baseKey={baseKey}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))}
      </div>
    );
  }

  // file
  return (
    <div
      className="yol-tree__row yol-tree__file"
      style={{ paddingLeft: pad + 16 }}
      onClick={() => onOpen(baseKey, node)}
      title={node.rel || node.name}
    >
      <span style={{ marginRight: 6 }}>📄</span>
      <span>{node.name}</span>
    </div>
  );
}

export function create() {
  function WorkflowsPanel() {
    ensureCSS();

    const [trees, setTrees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [expanded, setExpanded] = useState(() => {
      try { return JSON.parse(localStorage.getItem("yolandi.workflows.expanded")) ?? {}; }
      catch { return {}; }
    });

    function setExpandedPersist(nextOrUpdater) {
      setExpanded((prev) => {
        const next = typeof nextOrUpdater === "function" ? nextOrUpdater(prev) : nextOrUpdater;
        try { localStorage.setItem("yolandi.workflows.expanded", JSON.stringify(next)); } catch {}
        return next;
      });
    }

    function onToggle(key) {
      setExpandedPersist((prev) => ({ ...prev, [key]: !prev[key] }));
    }

    useEffect(() => {
      (async () => {
        setLoading(true); setError("");
        try {
          const base = wpRestRoot();
          const res = await fetch(`${base}/yolandi/v1/workflows`, { credentials: "same-origin" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const j = await res.json();
          setTrees(Array.isArray(j) ? j : []);
        } catch (e) {
          setError("Workflows API unavailable"); setTrees([]);
        } finally {
          setLoading(false);
        }
      })();
    }, []);

    async function onOpen(baseKey, fileNode) {
      try {
        const base = wpRestRoot();
        const url = new URL(`${base}/yolandi/v1/workflow`, window.location.origin);
        url.searchParams.set("baseKey", baseKey);
        url.searchParams.set("rel", fileNode.rel);

        const res = await fetch(url.toString(), { credentials: "same-origin" });
        const data = await res.json();
        if (!res.ok || data?.error) throw new Error(data?.error || `HTTP ${res.status}`);

        const payload = {
          baseKey,
          rel: data.rel,
          name: data.name,
          content: String(data.content ?? ""),
          mtime: data.mtime || null,
        };

        // Fire both window + document events, plus optional global hook
        window.dispatchEvent(new CustomEvent("yolandi:open-workflow", { detail: payload }));
        document.dispatchEvent(new CustomEvent("yolandi:open-workflow", { detail: payload, bubbles: true, composed: true }));
        if (window.YOLANDI?.openWorkflowTab) window.YOLANDI.openWorkflowTab(payload);
      } catch (e) {
        alert(`Failed to open workflow: ${e.message}`);
        console.error(e);
      }
    }

    // Simple client-side filter (no useMemo to avoid hook issues)
    const filter = query.trim().toLowerCase();
    const filteredTrees = !filter
      ? trees
      : trees.map((b) => {
          const match = (name) => name.toLowerCase().includes(filter);
          function filterNode(node) {
            if (node.type === "file") return match(node.name) ? node : null;
            const kids = (node.children || []).map(filterNode).filter(Boolean);
            if (kids.length || match(node.name)) return { ...node, children: kids };
            return null;
          }
          return { ...b, tree: (b.tree || []).map(filterNode).filter(Boolean) };
        });

    return (
      <div className="yol-wfs">
        <div className="yol-wfs__hdr">
          <div className="yol-wfs__title">Workflows</div>
          {loading ? <div style={{ fontSize: 12, opacity: 0.7 }}>Loading…</div> : null}
        </div>

        <div className="yol-wfs__search">
          <input
            type="search"
            placeholder="Search workflows…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="yol-wfs__tree">
          {error && <div style={{ color: "#f66", margin: "8px 10px" }}>{error}</div>}

          {filteredTrees.length === 0 && !loading && !error && (
            <div className="yol-empty">No workflows yet.</div>
          )}

          {filteredTrees.map((base) => (
            <div key={base.baseKey} className="yol-wfs__section">
              <div className="yol-wfs__sectionTitle">{base.label}</div>
              {(base.tree || []).map((node) => (
                <TreeNode
                  key={`${node.type}-${node.rel ?? node.name}`}
                  node={node}
                  baseKey={base.baseKey}
                  depth={0}
                  expanded={expanded}
                  onToggle={onToggle}
                  onOpen={onOpen}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return { id: meta.id, title: meta.title, icon: meta.icon, render: () => <WorkflowsPanel /> };
}
