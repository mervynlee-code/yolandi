// runner/pause-aware-runner.js
import fetch from "node-fetch";

const BASE = process.env.YOLANDI_API; // e.g., https://yolandi.org/wp-json/yolandi/v1
const H = { "Content-Type": "application/json" /* + your HMAC header(s) */ };

async function lease(runnerId, leaseSeconds=90) {
  const r = await fetch(`${BASE}/jobs/lease`, { method:"POST", headers:H, body: JSON.stringify({ runner_id: runnerId, lease_seconds: leaseSeconds }) });
  if (r.status === 204) return null;
  if (!r.ok) throw new Error(`lease ${r.status}`);
  return r.json();
}
async function heartbeat(id, runnerId, leaseSeconds=90) {
  const r = await fetch(`${BASE}/jobs/${id}/heartbeat`, { method:"POST", headers:H, body: JSON.stringify({ runner_id: runnerId, lease_seconds: leaseSeconds }) });
  const j = await r.json().catch(()=> ({}));
  if (!r.ok) throw new Error(`heartbeat ${r.status}`);
  return j; // may include { control: 'pause'|'resume' }
}
async function report(id, runnerId, status, payload={}) {
  const r = await fetch(`${BASE}/jobs/${id}/report`, { method:"POST", headers:H, body: JSON.stringify({ runner_id: runnerId, status, ...payload }) });
  if (!r.ok) throw new Error(`report ${r.status}`);
  return r.json().catch(()=> ({}));
}

// ---- PAUSE SUPPORT ----
async function waitWhilePaused(jobId, runnerId) {
  // loop until heartbeat stops telling us to pause
  // keep lease alive every ~10s
  /* eslint-disable no-constant-condition */
  while (true) {
    const hb = await heartbeat(jobId, runnerId, 90);
    if (hb?.control === "resume" || !hb?.control) {
      break; // resume
    }
    // still paused; sleep a bit
    await new Promise(r => setTimeout(r, 10_000));
  }
}

async function runJob(job, runnerId) {
  const id = job.id;
  console.log(`Running #${id} (${job.script_slug}@${job.script_version})`);

  const hbLoop = setInterval(() => {
    heartbeat(id, runnerId, 90).then(hb => {
      if (hb?.control === "pause") {
        console.log(`Job #${id} → server requested PAUSE`);
      }
    }).catch(e => console.error('heartbeat err', e.message));
  }, 15_000);

  try {
    // PAUSE-AWARE: check before starting
    const first = await heartbeat(id, runnerId, 90);
    if (first?.control === "pause") {
      console.log(`Job #${id} initial pause; idling…`);
      await waitWhilePaused(id, runnerId);
      console.log(`Job #${id} resumed.`);
    }

    // ---- Your actual steps (insert checks between long actions) ----
    // step 1
    // ... do something lengthy ...
    // mid-run pause check
    const hb1 = await heartbeat(id, runnerId, 90);
    if (hb1?.control === "pause") {
      console.log(`Job #${id} pause during step; idling…`);
      await waitWhilePaused(id, runnerId);
      console.log(`Job #${id} resumed.`);
    }

    // step 2
    // ... do more ...
    // step 3 ...

    await report(id, runnerId, "succeeded", { run_ms: 12345 });
  } catch (err) {
    console.error(err);
    await report(id, runnerId, "failed", { error: { message: String(err.message || err) } });
  } finally {
    clearInterval(hbLoop);
  }
}

async function main() {
  const runnerId = process.env.YOLANDI_RUNNER_ID || `runner-${Math.random().toString(36).slice(2)}`;
  while (true) {
    const job = await lease(runnerId).catch(e => (console.error('lease err', e.message), null));
    if (!job) { await new Promise(r=>setTimeout(r, 2000)); continue; }
    await runJob(job, runnerId);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
