// nodes/_shared/helpers.mjs
export function mergeCtx(a = {}, b = {}) {
  return { ...a, ...b, browser: b.browser || a.browser, page: b.page || a.page, data: { ...(a.data||{}), ...(b.data||{}) } };
}
export async function queryOne(page, sel) {
  if (!sel) return null;
  const isXPath = sel.startsWith("/") || sel.startsWith("xpath:");
  if (isXPath) {
    const xp = sel.replace(/^xpath:/, "");
    const els = await page.$x(xp);
    return els[0] || null;
  }
  return await page.$(sel);
}
export async function waitForSelectable(page, sel, opts = {}) {
  if (!sel) return;
  const isXPath = sel.startsWith("/") || sel.startsWith("xpath:");
  if (isXPath) {
    const xp = sel.replace(/^xpath:/, "");
    return page.waitForXPath(xp, { visible: !!opts.visible, timeout: opts.timeout ?? 30000 });
  }
  return page.waitForSelector(sel, { visible: !!opts.visible, timeout: opts.timeout ?? 30000 });
}
export function stampName(stem, ext) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${stem}-${ts}.${ext}`;
}
export function getArtifactsDir(ctx) {
  return ctx?.artifactsDir || process.env.YOLANDI_ARTIFACTS_DIR || process.cwd();
}
export function toArgv(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.filter(Boolean).map(String);
  if (typeof input === "string") {
    try { const parsed = JSON.parse(input); if (Array.isArray(parsed)) return parsed.map(String); } catch {}
    return input.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  }
  return [];
}
