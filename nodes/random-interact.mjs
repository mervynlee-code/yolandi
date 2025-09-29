export const meta = {
    type: "RandomInteract",
    title: "Random User Interaction",
    category: "Behavior",
    version: 1,
    props: { maxScrolls: { type: "number", default: 3 }, clickLinks: { type: "boolean", default: false } }
};
export function defineEditorNode({ Baklava }) {
    return new Baklava.NodeBuilder(meta.type)
        .setName(meta.title)
        .addInputInterface("in").addOutputInterface("out")
        .addOption("maxScrolls", "NumberOption", 3)
        .addOption("clickLinks", "CheckboxOption", false)
        .build();
}
export async function run(ctx, props) {
    const page = await ctx.page();
    const n = Math.max(0, Number(props.maxScrolls || 0));
    for (let i = 0; i < n; i++) {
        await page.evaluate(y => window.scrollBy(0, y), 200 + Math.random() * 400);
        await page.waitForTimeout(300 + Math.random() * 700);
    }
    if (props.clickLinks) {
        await page.evaluate(() => {
            const links = [...document.querySelectorAll('a[href]')];
            const pick = links[Math.floor(Math.random() * links.length)];
            pick && pick.click();
        });
        await page.waitForNetworkIdle?.({ idleTime: 500 }).catch(() => { });
    }
}