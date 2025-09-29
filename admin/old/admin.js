/*
 * YOLANDI Admin SPA
 * - Minimal React app that talks to /wp-json/yolandi/v1
 * - Shows Nodes list, simple Script JSON editor, and Job enqueue/view tools
 * - Uses Monaco Editor (if bundled) for JSON editing
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

const CFG = window.YOLANDI_CONFIG || {};
const REST = (p) => `${CFG.restRoot.replace(/\/$/, "")}/${p.replace(/^\//, "")}`;

async function api(path, { method = "GET", body, headers } = {}) {
  const h = {
    "Content-Type": "application/json",
    "X-WP-Nonce": CFG.wpRestNonce,
    ...(headers || {}),
  };
  const res = await fetch(REST(path), {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 204) return null;
  const txt = await res.text();
  try { return txt ? JSON.parse(txt) : null; } catch { return txt; }
}

function TabNav({ tab, setTab }) {
  const tabs = [
    ["scripts", "Scripts"],
    ["jobs", "Jobs"],
    ["nodes", "Nodes"],
  ];
  return (
    <div style={{ display: "flex", gap: 12, margin: "12px 0" }}>
      {tabs.map(([key, label]) => (
        <button
          key={key}
          onClick={() => setTab(key)}
          className={"button" + (tab === key ? " button-primary" : "")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function NodesTab() {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let on = true;
    setLoading(true);
    api("/nodes").then((data) => { if (on) setNodes(Array.isArray(data) ? data : []); })
      .finally(() => on && setLoading(false));
    return () => (on = false);
  }, []);

  return (
    <div>
      <h2>Nodes</h2>
      {loading ? <p>Loading…</p> : null}
      <table className="widefat fixed striped">
        <thead>
          <tr><th>Module</th><th>Type</th><th>Title</th><th>Category</th><th>Version</th></tr>
        </thead>
        <tbody>
          {nodes.map((n) => (
            <tr key={n.path}>
              <td>{n.path}</td>
              <td>{n.meta?.type || "?"}</td>
              <td>{n.meta?.title || ""}</td>
              <td>{n.meta?.category || ""}</td>
              <td>{n.meta?.version || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: 8 }}>
        Add custom nodes by dropping <code>.mjs</code> files into <code>wp-content/plugins/yolandi/nodes/</code> then reload this page.
      </p>
    </div>
  );
}

function useMonacoJSON(defaultValue = "{}") {
  const ref = useRef(null);
  const [value, setValue] = useState(defaultValue);
  useEffect(() => {
    let editor;
    (async () => {
      try {
        const monaco = await import("monaco-editor");
        editor = monaco.editor.create(ref.current, {
          value: defaultValue,
          language: "json",
          automaticLayout: true,
          minimap: { enabled: false },
        });
        editor.onDidChangeModelContent(() => setValue(editor.getValue()));
      } catch (e) {
        // Fallback: plain textarea
        if (ref.current) {
          const ta = document.createElement("textarea");
          ta.value = defaultValue;
          ta.style.width = "100%";
          ta.style.height = "260px";
          ta.addEventListener("input", () => setValue(ta.value));
          ref.current.appendChild(ta);
        }
      }
    })();
    return () => editor?.dispose?.();
  }, []);
  return [ref, value, setValue];
}

function ScriptsTab() {
  const [slug, setSlug] = useState("example-search");
  const [version, setVersion] = useState(1);
  const [params, setParams] = useState("{\n  \"q\": \"hello\"\n}");

  const [editorRef, graphJSON, setGraphJSON] = useMonacoJSON(`{
  "nodes": [
    { "id": "n1", "type": "SetDevice", "props": { "profile": "Pixel7" } },
    { "id": "n2", "type": "ProxyDirector", "props": { "director": "webshare-main", "sessionSeed": "${"${jobId}"}" } },
    { "id": "n3", "type": "Navigate", "props": { "url": "https://example.com" } },
    { "id": "n4", "type": "Screenshot", "props": { "path": "${"${artifacts}"}/shot.png", "fullPage": true } }
  ],
  "edges": [ { "from": "n1", "to": "n2" }, { "from": "n2", "to": "n3" }, { "from": "n3", "to": "n4" } ],
  "meta": { "slug": "example-search", "version": 1 }
}`);

  async function enqueue() {
    let graph;
    try { graph = JSON.parse(graphJSON); } catch (e) { alert("Invalid JSON graph"); return; }
    const p = { script_slug: slug, script_version: Number(version), params: JSON.parse(params || "{}"), priority: 5 };
    const res = await api("/jobs/enqueue", { method: "POST", body: p });
    if (res?.id) alert(`Enqueued Job #${res.id}`); else alert("Failed to enqueue");
  }

  return (
    <div>
      <h2>Script JSON</h2>
      <div ref={editorRef} style={{ border: "1px solid #ccd0d4", height: 280 }} />

      <h3 style={{ marginTop: 16 }}>Run Parameters</h3>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label>Slug: <input value={slug} onChange={(e) => setSlug(e.target.value)} /></label>
        <label>Version: <input type="number" min={1} value={version} onChange={(e) => setVersion(e.target.value)} style={{ width: 80 }} /></label>
      </div>
      <textarea value={params} onChange={(e) => setParams(e.target.value)} style={{ width: "100%", height: 120, marginTop: 8 }} />

      <div style={{ marginTop: 8 }}>
        <button className="button button-primary" onClick={enqueue}>Enqueue Test Run</button>
        <span style={{ marginLeft: 8, color: "#555" }}>
          This posts to <code>/jobs/enqueue</code>. Save your graph as a file under <code>scripts/&lt;slug&gt;/vNNN.json</code> to run on runners.
        </span>
      </div>
    </div>
  );
}

function JobsTab() {
  const [jobId, setJobId] = useState(0);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);

  async function fetchJob() {
    if (!jobId) return;
    setLoading(true);
    const data = await api(`/jobs/${jobId}`);
    setJob(data || null);
    setLoading(false);
  }

  return (
    <div>
      <h2>Jobs</h2>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label>Job ID: <input type="number" value={jobId} onChange={(e) => setJobId(Number(e.target.value))} /></label>
        <button className="button" onClick={fetchJob}>Load</button>
      </div>
      {loading ? <p>Loading…</p> : null}
      {job ? (
        <div style={{ marginTop: 12 }}>
          <table className="widefat fixed striped">
            <tbody>
              <tr><th>ID</th><td>{job.id}</td></tr>
              <tr><th>Status</th><td>{job.status}</td></tr>
              <tr><th>Script</th><td>{job.script_slug} v{job.script_version}</td></tr>
              <tr><th>Attempts</th><td>{job.attempts} / {job.max_attempts}</td></tr>
              <tr><th>Runner</th><td>{job.runner_id || ""}</td></tr>
            </tbody>
          </table>
          {job.artifacts ? (
            <div style={{ marginTop: 8 }}>
              <h3>Artifacts</h3>
              <pre style={{ background: "#f6f7f7", padding: 8, whiteSpace: "pre-wrap" }}>{JSON.stringify(job.artifacts, null, 2)}</pre>
            </div>
          ) : null}
          {job.error ? (
            <div style={{ marginTop: 8 }}>
              <h3>Error</h3>
              <pre style={{ background: "#fff4f4", padding: 8, color: "#a00" }}>{JSON.stringify(job.error, null, 2)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function App() {
  const [tab, setTab] = useState("scripts");
  return (
    <div style={{ padding: 12 }}>
      <h1>YOLANDI Admin</h1>
      <TabNav tab={tab} setTab={setTab} />
      {tab === "scripts" && <ScriptsTab />}
      {tab === "jobs" && <JobsTab />}
      {tab === "nodes" && <NodesTab />}
    </div>
  );
}

(function mount() {
  const el = document.getElementById("yolandi-root");
  if (!el) return;
  const root = createRoot(el);
  root.render(<App />);
})();
