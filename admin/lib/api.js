// =========================
// FILE: admin/lib/api.js
// =========================
function wpRestInfo(){ const root=(window.wpApiSettings&&window.wpApiSettings.root)||(window.wp&&window.wp.apiSettings&&window.wp.apiSettings.root)||"/wp-json/"; const nonce=(window.wpApiSettings&&window.wp.apiSettings.nonce)|| (window.wp&&window.wp.apiSettings&&window.wp.apiSettings.nonce) ||null; return { root: root.replace(/\/$/,""), nonce }; }
export function apiBase(){ const { root } = wpRestInfo(); return `${root}/yolandi/v1`; }
export function apiHeaders(){ const { nonce } = wpRestInfo(); return nonce ? { "Content-Type":"application/json", "X-WP-Nonce": nonce } : { "Content-Type":"application/json"}; }
export async function apiEnqueueWorkflow(workflow,{ settings={}, env={}, scriptSlug="workflow", scriptVersion="1" }={}){ const r=await fetch(`${apiBase()}/jobs/enqueue`,{ method:"POST", headers:apiHeaders(), credentials:"same-origin", body: JSON.stringify({ script_slug:scriptSlug, script_version:scriptVersion, payload:{ mode:"workflow", workflow, settings, env }})}); if(!r.ok) throw new Error(`enqueue ${r.status}`); return r.json(); }
export async function apiGetJob(jobId){ const r=await fetch(`${apiBase()}/jobs/${jobId}`,{ headers:apiHeaders(), credentials:"same-origin" }); if(!r.ok) throw new Error(`get job ${r.status}`); return r.json(); }
export async function apiControl(jobId,control){ const r=await fetch(`${apiBase()}/jobs/${jobId}/control`,{ method:"POST", headers:apiHeaders(), credentials:"same-origin", body: JSON.stringify({ control })}); if(!r.ok) throw new Error(`control ${r.status}`); return r.json().catch(()=>({})); }
export async function apiCancel(jobId){ const r=await fetch(`${apiBase()}/jobs/${jobId}/cancel`,{ method:"POST", headers:apiHeaders(), credentials:"same-origin" }); if(!r.ok) throw new Error(`cancel ${r.status}`); return r.json().catch(()=>({})); }
