import { mergeCtx, waitForSelectable } from "../_shared/helpers.mjs";

export const meta = {
  type: "Puppeteer.NewPage",
  title: "Puppeteer: New Page",
  category: "Puppeteer",
  version: 1,
  props: {
    url:         { type: "string",   default: "about:blank" },
    waitUntil:   { type: "select",   default: "networkidle2", options: ["load","domcontentloaded","networkidle0","networkidle2"] },
    waitFor:     { type: "string",   default: "" },
    headersJson: { type: "textarea", default: "" }
  }
};

export function defineEditorNode({ Baklava }) {
  return new Baklava.NodeBuilder(meta.type)
    .setName(meta.title)
    .addInputInterface("in")
    .addOutputInterface("out")
    .addOutputInterface("Page")
    .addOption("url",       "TextOption",   "about:blank")
    .addOption("waitUntil", "SelectOption", "networkidle2", ["load","domcontentloaded","networkidle0","networkidle2"])
    .addOption("waitFor",   "TextOption",   "")
    .addOption("headersJson","TextAreaOption","")
    .build();
}

/**
 * Accepts either (io, ctx) or (ctx, options)
 */
export async function run(arg1 = {}, arg2 = {}) {
  // Detect the runner calling convention
  const calledWithIO = !!(arg1 && (arg1.fields || arg1.packet));
  const io   = calledWithIO ? arg1                  : { packet: {}, fields: arg2 || {} };
  const ctx  = calledWithIO ? (arg2 || {})          : (arg1 || {});
  const opts = io.fields ? io.fields : (arg2 || {});

  // Find a browser from ctx
  const browser =
    ctx.browser ||
    (ctx.puppeteer && ctx.puppeteer.browser) ||
    null;

  if (!browser) {
    throw new Error("NewPage: missing ctx.browser (runner likely passed {packet,fields} as first arg — switch to run({packet,fields}, ctx) or use this shim).");
  }

  // Prefer context.newPage() if available (e.g., incognito)
  const page = (ctx.context && typeof ctx.context.newPage === "function")
    ? await ctx.context.newPage()
    : await browser.newPage();

  // Helpful defaults
  await page.setBypassCSP(true);

  if (ctx.userAgent) {
    try { await page.setUserAgent(String(ctx.userAgent)); } catch {}
  }

  if (opts.headersJson) {
    try {
      const hdrs = JSON.parse(opts.headersJson);
      if (hdrs && typeof hdrs === "object") {
        await page.setExtraHTTPHeaders(hdrs);
      }
    } catch {}
  }

  // Proxy auth (HTTP auth proxies)
  if (ctx.proxy && ctx.proxy.username) {
    await page.authenticate({
      username: ctx.proxy.username,
      password: ctx.proxy.password || ""
    });
  }

  // Navigate if URL provided
  const url = opts.url || "about:blank";
  if (url && url !== "about:blank") {
    await page.goto(url, { waitUntil: opts.waitUntil || "networkidle2" });
  }

  // Optional waitFor (selector or milliseconds)
  if (opts.waitFor) {
    const ms = Number(opts.waitFor);
    if (Number.isFinite(ms)) {
      await page.waitForTimeout(ms);
    } else {
      // uses your helper; falls back to page.waitForSelector behavior
      await waitForSelectable(page, opts.waitFor, { visible: true });
    }
  }

  // Expose page on context for downstream nodes
  ctx.page = page;
  ctx.puppeteer = ctx.puppeteer || {};
  ctx.puppeteer.page = page;

  // Return merged ctx for runners that replace the reference
  return mergeCtx(ctx, { page });
}
