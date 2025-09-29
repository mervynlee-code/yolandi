import React, { useEffect, useState } from "react";
import { api } from "../core";

export default function NodesTab() {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let on = true;
    setLoading(true);
    api("/nodes")
      .then((data) => {
        if (!on) return;
        if (Array.isArray(data)) setNodes(data);
        else setError(String(data || ""));
      })
      .finally(() => on && setLoading(false));
    return () => (on = false);
  }, []);

  return (
    <div>
      <h2>Nodes</h2>
      {loading ? <p>Loading…</p> : null}
      {error && <p style={{ color: "#a00" }}>{error}</p>}
      <table className="widefat fixed striped">
        <thead>
          <tr>
            <th>Module</th><th>Type</th><th>Title</th><th>Category</th><th>Version</th>
          </tr>
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
        Add custom nodes by dropping <code>.mjs</code> files into{" "}
        <code>wp-content/plugins/yolandi/nodes/</code>, then reload this page.
      </p>
    </div>
  );
}
