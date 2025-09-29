import { pickProxy } from "stealth-api/proxy-pool.mjs";
export const meta = {
    type: "ProxyDirector",
    title: "Proxy Director",
    category: "Env",
    version: 1,
    props: {
        director: { type: "string", required: true, default: "webshare-main" },
        sessionSeed: { type: "string", default: "${jobId}" }
    }
};
export function defineEditorNode({ Baklava }) {
    return new Baklava.NodeBuilder(meta.type)
        .setName(meta.title)
        .addInputInterface("in").addOutputInterface("out")
        .addOption("director", "TextOption", meta.props.director.default)
        .addOption("sessionSeed", "TextOption", meta.props.sessionSeed.default)
        .build();
}
export async function run(ctx, props) {
    const conf = await ctx.fs.readJson(`proxy-directors/${props.director}.json`);
    const endpoint = pickProxy(conf, ctx.interpolate(props.sessionSeed));
    await ctx.env.setProxy(endpoint); // YOLANDI runtime relaunches page if needed
}