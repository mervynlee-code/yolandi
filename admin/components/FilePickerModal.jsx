import React, { useEffect, useState } from "react";

/**
 * Simple server-side file picker.
 * Props:
 * - initialPath: string|null
 * - fsLs(path?) -> Promise<{ cwd, base, canUp, dirs:[{name,path}], files:[{name,path,size}], defaultDir }>
 * - onConfirm({ dirPath, filename })
 * - onClose()
 */
export default function FilePickerModal({ initialPath = null, fsLs, onConfirm, onClose }) {
  const [state, setState] = useState({ loading: true, cwd: "", dirs: [], files: [], filename: "workflow.json", canUp: false });
  const [error, setError] = useState("");

  const load = async (path = null) => {
    setError(""); setState((s) => ({ ...s, loading: true }));
    try {
      const resp = await fsLs(path || initialPath || null);
      setState({
        loading: false,
        cwd: resp.cwd,
        dirs: resp.dirs || [],
        files: resp.files || [],
        filename: "workflow.json",
        canUp: !!resp.canUp,
      });
    } catch (e) {
      setError(e.message || String(e));
      setState((s) => ({ ...s, loading: false }));
    }
  };

  useEffect(() => { load(); /* eslint-disable-line */ }, []);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div style={{ width: 720, maxHeight: "80vh", background:"#151515", border:"1px solid #333", borderRadius:12, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div style={{ padding:"10px 14px", borderBottom:"1px solid #2a2a2a", display:"flex", alignItems:"center", gap:10 }}>
          <strong>Save workflow as…</strong>
          <div style={{ marginLeft:"auto" }} />
          <button className="btn" onClick={onClose}><i className="fa fa-xmark" /> Close</button>
        </div>

        <div style={{ padding:"8px 14px", borderBottom:"1px solid #1f1f1f", display:"flex", gap:8, alignItems:"center" }}>
          <button className="btn" disabled={!state.canUp} onClick={() => load(state.cwd + "/..")}><i className="fa fa-level-up-alt" /> Up</button>
          <div style={{ fontFamily:"ui-monospace, Menlo, Consolas, monospace", fontSize:12, opacity:0.9 }}>{state.cwd || "(loading…)"}</div>
        </div>

        <div style={{ display:"flex", gap:10, padding:12 }}>
          <div style={{ flex:"0 0 45%", border:"1px solid #2a2a2a", borderRadius:8, overflow:"hidden" }}>
            <div style={{ padding:8, borderBottom:"1px solid #222", background:"#1a1a1a" }}>
              <strong>Folders</strong>
            </div>
            <div style={{ maxHeight:320, overflow:"auto" }}>
              {state.loading ? <div style={{ padding:12, opacity:0.7 }}>Loading…</div> :
                state.dirs.map((d) => (
                  <div key={d.path} className="row" onDoubleClick={() => load(d.path)} style={{ padding:"8px 12px", cursor:"pointer" }}>
                    <i className="fa fa-folder" style={{ marginRight:8 }} /> {d.name}
                  </div>
                ))
              }
              {!state.loading && !state.dirs.length && <div style={{ padding:12, opacity:0.7 }}>No subfolders</div>}
            </div>
          </div>

          <div style={{ flex:"1 1 auto", border:"1px solid #2a2a2a", borderRadius:8, overflow:"hidden" }}>
            <div style={{ padding:8, borderBottom:"1px solid #222", background:"#1a1a1a" }}>
              <strong>Files</strong>
            </div>
            <div style={{ maxHeight:320, overflow:"auto" }}>
              {state.files.map((f) => (
                <div key={f.path} className="row" onClick={() => setState((s) => ({ ...s, filename: f.name }))} style={{ padding:"8px 12px", cursor:"pointer", display:"flex", justifyContent:"space-between" }}>
                  <div><i className="fa fa-file" style={{ marginRight:8 }} /> {f.name}</div>
                  <div style={{ opacity:0.6, fontSize:12 }}>{f.size}</div>
                </div>
              ))}
              {!state.files.length && <div style={{ padding:12, opacity:0.7 }}>No files</div>}
            </div>
          </div>
        </div>

        <div style={{ display:"flex", gap:10, alignItems:"center", padding:"10px 14px", borderTop:"1px solid #2a2a2a" }}>
          <label style={{ fontSize:12, opacity:0.8 }}>Filename</label>
          <input
            value={state.filename}
            onChange={(e) => setState((s) => ({ ...s, filename: e.target.value }))}
            style={{ flex:1, background:"#111", border:"1px solid #333", borderRadius:6, color:"#ddd", padding:"8px 10px", fontFamily:"ui-monospace, Menlo, Consolas, monospace" }}
          />
          <button
            className="btn"
            onClick={() => {
              const filename = state.filename.endsWith(".json") ? state.filename : `${state.filename}.json`;
              onConfirm({ dirPath: state.cwd, filename });
            }}
          >
            <i className="fa fa-save" /> Save
          </button>
        </div>

        {error && <div style={{ padding:"6px 14px", color:"#f88" }}>{String(error)}</div>}
      </div>
    </div>
  );
}
