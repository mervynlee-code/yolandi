// nodes/node-template.mjs
export const meta = {
    type: "MyNode", // unique type id used in graphs
    title: "My Node",
    category: "Custom",
    version: 1,
    props: {
        exampleText: { type: "string", required: true, default: "hello" },
        retries: { type: "number", default: 0 },
        fullPage: { type: "boolean", default: false }
    }
};

// Register in BaklavaJS (admin only)
export function defineEditorNode({ Baklava }) {
    const node = new Baklava.NodeBuilder(meta.type)
        .setName(meta.title)
        .addInputInterface("in")
        .addOutputInterface("out")
        .addOption("exampleText", "TextOption", meta.props.exampleText.default)
        .addOption("retries", "NumberOption", meta.props.retries.default)
        .addOption("fullPage", "CheckboxOption", meta.props.fullPage.default);
    return node.build();
}

// Execute on runner
export async function run(ctx, props) {
    ctx.log.debug(`[MyNode] start`, { props });
    // Your logic here. You can access ctx.page(), ctx.browser, ctx.job, ctx.vars, ctx.interpolate()
    return { ok: true };
}