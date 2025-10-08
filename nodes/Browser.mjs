// nodes/puppeteer/Browser.mjs
// Minimal, safe handler for graph node type: "Puppeteer.Browser"

export const meta = {
  type: "Puppeteer.Browser",
  // optional: declare outputs if your graph uses them by name
  // outputs: [{ id: "o0", name: "out" }],
};

function parseViewport(str) {
  if (!str) return undefined;
  const m = String(str).match(/^\s*(\d+)\s*x\s*(\d+)\s*$/i);
  if (!m) return undefined;
  return { width: Number(m[1]), height: Number(m[2]) };
}

function splitArgs(s) {
  if (!s) return [];
  // very simple splitter; if you need quotes, swap for a real shell parser
  return String(s).trim().split(/\s+/).filter(Boolean);
}

export async function run(ctx) {
  const { fields = {}, bag, log } = ctx;

  // Try puppeteer or puppeteer-core
  let puppeteer = null;
  try {
    ({ default: puppeteer } = await import("puppeteer"));
  } catch {
    try {
      ({ default: puppeteer } = await import("puppeteer-core"));
    } catch {}
  }

  if (!puppeteer) {
    await log?.("warn", "Puppeteer not installed; node will no-op");
    return {
      packet: {
        puppeteer: { launched: false, reason: "missing_dependency" },
      },
    };
  }

  const viewport = parseViewport(fields.defaultViewport);
  const args = splitArgs(fields.cliArgs);

  const launchOpts = {
    headless: !!fields.headless, // set true/false as-is from fields
    args: args.length ? args : undefined,
    executablePath: fields.executablePath || undefined,
    userDataDir: fields.userDataDir || undefined,
    defaultViewport: viewport,
  };

  // Friendly log of launch options (without leaking long args)
  await log?.("info", "Launching Puppeteer", {
    headless: launchOpts.headless,
    viewport,
    hasUserDataDir: !!launchOpts.userDataDir,
    argsCount: args.length,
  });

  const browser = await puppeteer.launch(launchOpts);
  let context = null;
  let page = null;

  if (fields.incognito) {
    context = await browser.createIncognitoBrowserContext();
    page = await context.newPage();
  } else {
    page = await browser.newPage();
  }

  if (fields.userAgent) await page.setUserAgent(String(fields.userAgent));
  if (fields.timeoutMs) page.setDefaultTimeout(Number(fields.timeoutMs));

  // Stash in shared bag for downstream nodes + gracefulCleanup()
  bag.browser = browser;
  bag.context = context;
  bag.page = page;

  return {
    packet: {
      puppeteer: {
        launched: true,
        pid: browser.process ? browser.process()?.pid : undefined,
        wsEndpoint: browser.wsEndpoint ? browser.wsEndpoint() : undefined,
        incognito: !!fields.incognito,
      },
    },
  };
}
