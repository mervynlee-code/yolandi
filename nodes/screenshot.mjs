export const meta = {
    type: "Screenshot",
    title: "Take Screenshot",
    category: "Artifacts",
    version: 1,
    props: {
        path: { type: "string", required: true, default: "${artifacts}/shot.png" },
        fullPage: { type: "boolean", default: true }
    }
};
export function defineEditorNode({ Baklava }) {
    return new Baklava.NodeBuilder(meta.type)
        .setName(meta.title)
        .addInputInterface("in").addOutputInterface("out")
        .addOption("path", "TextOption", meta.props.path.default)
        .addOption("fullPage", "CheckboxOption", meta.props.fullPage.default)
        .build();
}
export async function run(ctx, props) {
    const page = await ctx.page();
    const file = ctx.interpolate(props.path);
    await page.screenshot({ path: file, fullPage: !!props.fullPage });
    ctx.artifacts.register({ type: "image", path: file, label: "screenshot" });
}