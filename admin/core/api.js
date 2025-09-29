// admin/core/api.js

// Compute the REST base once per call (resilient to WP setups)
export function computeRestBase() {
  let base = (window.YOLANDI_BOOT && window.YOLANDI_BOOT.restBase) || "";
  if (!base) {
    const link = document.querySelector('link[rel="https://api.w.org"]');
    if (link?.href) base = link.href.replace(/\/$/, "") + "/yolandi/v1";
  }
  if (!base) base = "/wp-json/yolandi/v1";
  return base.replace(/\/$/, "");
}

async function fetchJson(url, opts = {}) {
  const headers = {
    "Content-Type": "application/json",
    // "X-WP-Nonce":
    //   window?.YOLANDI_BOOT?.nonce || window?.wpApiSettings?.nonce || "",
    // ...(opts.headers || {}),
  };

  const init = {
    credentials: "omit",
    ...opts,
    headers,
  };

  // Normalize body to JSON unless it's already a string/FormData
  if (
    init.body &&
    typeof init.body !== "string" &&
    !(init.body instanceof FormData)
  ) {
    init.body = JSON.stringify(init.body);
  }

  const resp = await fetch(url, init);
  const text = await resp.text();
  const isJson = (resp.headers.get("content-type") || "").includes("application/json");
  const body = isJson ? (text ? JSON.parse(text) : null) : text;

  return { resp, isJson, body, text };
}

export async function api(path, opts = {}) {
  const restBase = computeRestBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  const primary = `${restBase}${p}`;

  // Normalize body (again) for callers that pass objects
  const normOpts = { ...opts };
  if (
    normOpts.body != null &&
    typeof normOpts.body !== "string" &&
    !(normOpts.body instanceof FormData)
  ) {
    normOpts.body = JSON.stringify(normOpts.body);
  }

  // Try primary
  let { resp, isJson, body } = await fetchJson(primary, normOpts);

  // Fallback to ?rest_route= if we got HTML/404/etc.
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

// Small helper if you need to build REST URLs elsewhere (optional export)
export function joinRest(endpoint, params) {
  const base = computeRestBase();
  const url = new URL(
    String(base).replace(/\/$/, "") + "/" + String(endpoint).replace(/^\//, ""),
    window.location.origin
  );
  if (params && typeof params === "object") {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}
