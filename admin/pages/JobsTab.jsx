import React, { useState } from "react";
import { api } from "../core";

export default function JobsTab() {
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
              <pre style={{ background: "#f6f7f7", padding: 8, whiteSpace: "pre-wrap" }}>
                {JSON.stringify(job.artifacts, null, 2)}
              </pre>
            </div>
          ) : null}
          {job.error ? (
            <div style={{ marginTop: 8 }}>
              <h3>Error</h3>
              <pre style={{ background: "#fff4f4", padding: 8, color: "#a00" }}>
                {JSON.stringify(job.error, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
