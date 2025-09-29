// nodes/meta-workflow.mjs
export const meta = {
  type: "MetaWorkflow",
  title: "Meta Workflow",
  category: "YOLANDI",
  version: 1,
  props: {
    macro: { type: "string", default: "" },
  },
  inputs: ["in"],
  outputs: ["out"]
};

// This run executes the selected macro's graph using the in-process interpreter.
// It should NOT enqueue; instead it writes logs into the parent job context.
export async function run(ctx, props) {
  const macroName = String(props.macro || "").trim();
  if (!macroName) {
    ctx.log?.warn?.("MetaWorkflow: No macro selected");
    return;
  }
  try {
    // fetch macro JSON from server (stored by the /macros POST above)
    const base = ctx.env?.REST_ROOT || process.env.YOLANDI_API;
    const token = ctx.env?.nonce;
    const r = await fetch(`${base}/macros`, { headers: token ? { 'X-WP-Nonce': token } : {} });
    const list = await r.json();
    const macro = (Array.isArray(list) ? list : []).find(m => m.name === macroName);
    if (!macro) {
      ctx.log?.error?.(`MetaWorkflow: Macro "${macroName}" not found`);
      return;
    }
    // You’ll likely expose an interpreter helper on ctx:
    // await ctx.runWorkflow(macro.graph, { pipeLogs: true })
    if (typeof ctx.runWorkflow === "function") {
      await ctx.runWorkflow(macro.graph, { pipeLogs: true }); // pipeLogs: send to parent job log
    } else {
      ctx.log?.warn?.("MetaWorkflow: ctx.runWorkflow missing; skipping");
    }
  } catch (e) {
    ctx.log?.error?.(`MetaWorkflow error: ${e?.message || e}`);
  }
}
