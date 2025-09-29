import React, { useEffect, useRef, useState } from "react";
import { api } from "../core";

// MONACO ESM workers (local to this tab)
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

if (!self.MonacoEnvironment) {
  self.MonacoEnvironment = {
    getWorker(_moduleId, label) {
      switch (label) {
        case "json": return new jsonWorker();
        case "css": return new cssWorker();
        case "html": return new htmlWorker();
        case "typescript":
        case "javascript": return new tsWorker();
        default: return new editorWorker();
      }
    },
  };
}

async function loadMonaco() {
  const monaco = await import("monaco-editor/esm/vs/editor/editor.api");
  await Promise.all([
    import("monaco-editor/esm/vs/language/json/monaco.contribution"),
    import("monaco-editor/esm/vs/language/css/monaco.contribution"),
    import("monaco-editor/esm/vs/language/html/monaco.contribution"),
    import("monaco-editor/esm/vs/language/typescript/monaco.contribution"),
  ]);
  return monaco;
}

function useMonacoJSON(defaultValue = "{}") {
  const ref = useRef(null);
  const [value, setValue] = useState(defaultValue);
  useEffect(() => {
    let editor;
    (async () => {
      try {
        const monaco = await loadMonaco();
        editor = monaco.editor.create(ref.current, {
          value: defaultValue,
          language: "json",
          automaticLayout: true,
          minimap: { enabled: false },
        });
        editor.onDidChangeModelContent(() => setValue(editor.getValue()));
      } catch {
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

export default function ScriptsTab() {
  const [slug, setSlug] = useState("example-search");
  const [version, setVersion] = useState(1);
  const [params, setParams] = useState(`{ "q": "hello" }`);
  const [editorRef, graphJSON] = useMonacoJSON(`{
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
    let parsed;
    try { parsed = JSON.parse(graphJSON); } catch { alert("Invalid JSON graph"); return; }
    const p = {
      script_slug: slug,
      script_version: Number(version),
      params: JSON.parse(params || "{}"),
      priority: 5,
    };
    const res = await api("/jobs/enqueue", { method: "POST", body: p });
    if (res?.id) alert(`Enqueued Job #${res.id}`);
    else alert("Failed to enqueue");
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
      <textarea
        value={params}
        onChange={(e) => setParams(e.target.value)}
        style={{ width: "100%", height: 120, marginTop: 8 }}
      />

      <div style={{ marginTop: 8 }}>
        <button className="button button-primary" onClick={enqueue}>Enqueue Test Run</button>
        <span style={{ marginLeft: 8, color: "#555" }}>
          Posts to <code>/jobs/enqueue</code>. Save graphs under <code>scripts/&lt;slug&gt;/vNNN.json</code>.
        </span>
      </div>
    </div>
  );
}
