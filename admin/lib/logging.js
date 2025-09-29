// =========================
// FILE: admin/lib/logging.js
// =========================
export function logLineFactory(selector){ return (msg, level="DEBUG")=>{ const pre=document.querySelector(selector); if(!pre) return; const t=new Date().toLocaleTimeString(); pre.textContent += `${pre.textContent?"\n":""}[${t}] ${level} — ${msg}`; pre.parentElement.scrollTop = pre.parentElement.scrollHeight; }; }
export function runnerLogFactory(selector){ return (msg)=>{ const el=document.querySelector(selector); if(!el) return; const t=new Date().toLocaleTimeString(); el.textContent += `${el.textContent?"\n":""}[${t}] ${msg}`; el.parentElement.scrollTop = el.parentElement.scrollHeight; }; }
