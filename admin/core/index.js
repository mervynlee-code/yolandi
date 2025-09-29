// --- REST / Nonce helpers (shared) ---
const CFG = window.YOLANDI_CONFIG || {};
const ORIGIN = window.location.origin.replace(/\/$/, "");

const REST_CANDIDATES = [
  (CFG.restRoot || "").replace(/\/$/, ""),
  (CFG.restRootQuery || "").replace(/\/$/, ""),
  `${ORIGIN}/index.php?rest_route=/yolandi/v1`,
  `${ORIGIN}/wp-json/yolandi/v1`,
].filter(Boolean);

let REST_BASE = REST_CANDIDATES[0];
export const REST = (p = "") => `${REST_BASE}/${String(p).replace(/^\//, "")}`;

export function computeRestBase() {
  let base = (window.YOLANDI_BOOT && window.YOLANDI_BOOT.restBase) || "";
  if (!base) {
    const link = document.querySelector('link[rel="https://api.w.org"]');
    if (link?.href) base = link.href.replace(/\/$/, "") + "/yolandi/v1";
  }
  if (!base) base = "/wp-json/yolandi/v1";
  return base.replace(/\/$/, "");
}

export function joinRest(base, route, queryParams = {}) {
  const withRoute = `${base}${base.endsWith("/") ? "" : "/"}${route.replace(
    /^\//,
    ""
  )}`;
  const qs =
    Object.keys(queryParams).length === 0
      ? ""
      : (withRoute.includes("?") ? "&" : "?") +
        Object.entries(queryParams)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join("&");
  return withRoute + qs;
}

async function fetchJson(url, opts = {}) {
  const headers = {
    "Content-Type": "application/json",
    "X-WP-Nonce":
      window?.YOLANDI_BOOT?.nonce || window?.wpApiSettings?.nonce || "",
    ...(opts.headers || {}),
  };
  const init = { credentials: "same-origin", ...opts, headers };
  if (init.body && typeof init.body !== "string" && !(init.body instanceof FormData)) {
    init.body = JSON.stringify(init.body);
  }
  const resp = await fetch(url, init);
  const text = await resp.text();
  const isJson = (resp.headers.get("content-type") || "").includes(
    "application/json"
  );
  const body = isJson ? (text ? JSON.parse(text) : null) : text;
  return { resp, isJson, body, text };
}

export async function api(path, opts = {}) {
  const restBase = computeRestBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  const primary = `${restBase}${p}`;

  const normOpts = { ...opts };
  if (normOpts.body != null && typeof normOpts.body !== "string" && !(normOpts.body instanceof FormData)) {
    normOpts.body = JSON.stringify(normOpts.body);
  }

  let { resp, isJson, body } = await fetchJson(primary, normOpts);

  const looksLikeHtml =
    typeof body === "string" && body.trim().startsWith("<!DOCTYPE");
  if ((!resp.ok || looksLikeHtml) && !normOpts.__fallbackTried) {
    const fallback = `${primary.replace(restBase, "")}`.replace(/^\//, "");
    const alt = `${window.location.origin}/index.php?rest_route=/yolandi/v1/${fallback}`;
    const r2 = await fetchJson(alt, { ...normOpts, __fallbackTried: true });
    resp = r2.resp;
    isJson = r2.isJson;
    body = r2.body;
  }

  if (!resp.ok) {
    const e = new Error(`API ${resp.status} ${resp.statusText}`);
    e.status = resp.status;
    e.url = resp.url;
    e.body = body;
    throw e;
  }
  if (!isJson || body == null) {
    const e = new Error("API returned non-JSON response");
    e.url = resp.url;
    e.body = body;
    throw e;
  }
  return body;
}

export async function apiWithTimeout(path, ms = 15000, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await api(path, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
