// /wp-content/plugins/yolandi/nodes/puppeteer/Browser.mjs
import puppeteer from "puppeteer";
import { mergeCtx, toArgv } from "../_shared/helpers.mjs";

export const meta = {
  type: "Puppeteer.Browser",
  title: "Puppeteer: Browser",
  category: "Puppeteer",
  version: 1,
  props: {
    headless:         { type: "checkbox", default: true },
    engine:           { type: "select",   default: "chrome", options: ["chrome", "chromium", "firefox"] },
    executablePath:   { type: "string",   default: "" },
    userDataDir:      { type: "string",   default: "" },
    cliArgs:          { type: "textarea", default: "" },
    defaultViewport:  { type: "string",   default: "1280x800" },
    incognito:        { type: "checkbox", default: false },
    userAgent:        { type: "string",   default: "" },
    timeoutMs:        { type: "number",   default: 60000 }
  }
};

export function defineEditorNode({ Baklava }) {
  return new Baklava.NodeBuilder(meta.type)
    .setName(meta.title)
    .addInputInterface("in")
    .addInputInterface("Proxy")
    .addOutputInterface("out")
    .addOption("headless",        "CheckboxOption", true)
    .addOption("engine",          "SelectOption",   "chrome", ["chrome", "chromium", "firefox"])
    .addOption("executablePath",  "TextOption",     "")
    .addOption("userDataDir",     "TextOption",     "")
    .addOption("cliArgs",         "TextAreaOption", "")
    .addOption("defaultViewport", "TextOption",     "1280x800")
    .addOption("incognito",       "CheckboxOption", false)
    .addOption("userAgent",       "TextOption",     "")
    .addOption("timeoutMs",       "NumberOption",   60000)
    .build();
}

/**
 * Accepts either (io, ctx) or (ctx, options).
 * Mutates the real shared ctx (ctx.browser / ctx.context), and returns:
 *  - io (unchanged) if called with (io, ctx)
 *  - merged ctx if called with (ctx, options)
 */
export async function run(arg1 = {}, arg2 = {}) {
  // Detect calling convention
  const calledWithIO = !!(arg1 && (arg1.fields || arg1.packet));
  const io       = calledWithIO ? arg1         : { packet: {}, fields: arg2 || {} };
  const ctx      = calledWithIO ? (arg2 || {}) : (arg1 || {});
  const options  = io.fields ? io.fields : (arg2 || {});

  // --- Viewport ---
  const [w, h] = String(options.defaultViewport || "1280x800")
    .split("x")
    .map(n => parseInt(n, 10) || 0);

  // --- CLI args + Proxy ---
  const args = toArgv(options.cliArgs);
  const proxy = ctx.proxy || options.Proxy || null;
  if (proxy && proxy.url) {
    args.push(`--proxy-server=${proxy.url}`);
    if (proxy.bypass) args.push(`--proxy-bypass-list=${proxy.bypass}`);
  }

  // --- Launch options ---
  const launchOpts = {
    headless: !!options.headless,
    product: options.engine || "chrome",
    ignoreHTTPSErrors: true,
    args,
    defaultViewport: { width: w || 1280, height: h || 800 },
    timeout: options.timeoutMs ?? 60000
  };
  if (options.executablePath) launchOpts.executablePath = options.executablePath;
  if (options.userDataDir)    launchOpts.userDataDir    = options.userDataDir;

  // --- Reuse if connected; else launch ---
  let browser = ctx.browser;
  try {
    if (!browser || typeof browser.isConnected !== "function" || !browser.isConnected()) {
      browser = await puppeteer.launch(launchOpts);
    }
  } catch (e) {
    // Some puppeteer products barf on defaultViewport; retry without it
    const { defaultViewport, ...rest } = launchOpts;
    browser = await puppeteer.launch(rest);
  }

  // --- Context (default vs incognito) ---
  let context = browser.defaultBrowserContext();
  if (options.incognito) {
    context = await browser.createIncognitoBrowserContext();
  }

  // --- Mutate the REAL shared ctx (this is what NewPage reads) ---
  ctx.browser = browser;
  ctx.context = context;
  ctx.proxy   = proxy || ctx.proxy || null;

  ctx.puppeteer = ctx.puppeteer || {};
  ctx.puppeteer.browser = browser;
  ctx.puppeteer.context = context;

  if (options.userAgent) {
    ctx.userAgent = String(options.userAgent).trim();
    ctx.puppeteer.userAgent = ctx.userAgent;
  }

  // --- One-time cleanup hook for the job ---
  if (typeof ctx.onCleanup === "function" && !ctx.__puppeteerCleanup) {
    ctx.__puppeteerCleanup = true;
    ctx.onCleanup(async () => {
      try { await ctx.puppeteer?.context?.close?.(); } catch {}
      try { await ctx.puppeteer?.browser?.close?.(); } catch {}
      ctx.browser = null;
      ctx.context = null;
      if (ctx.puppeteer) {
        ctx.puppeteer.browser = null;
        ctx.puppeteer.context = null;
      }
    });
  }

  // --- Return shape that matches how we were called ---
  return calledWithIO
    ? io // runner style: run(io, ctx) → return io
    : mergeCtx(ctx, { browser, context, proxy: ctx.proxy, puppeteer: ctx.puppeteer, userAgent: ctx.userAgent });
}
