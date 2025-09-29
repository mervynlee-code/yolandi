import fs from 'node:fs/promises';
import path from 'node:path';
import fetch from 'node-fetch';


export async function loadRegistry(baseUrl, secret, cacheDir) {
    const t = Math.floor(Date.now() / 1000);
    const body = '';
    const sig = await hmac(secret, `${t}.${body}`);
    const res = await fetch(`${baseUrl}/wp-json/yolandi/v1/nodes/bundle?target=runner`, {
        headers: { 'x-yolandi-signature': `t=${t},v1=${sig}` }
    });
    if (res.status === 304) return import(path.join(cacheDir, 'index.mjs'));
    const buf = Buffer.from(await res.arrayBuffer());
    await unzipTo(buf, cacheDir);
    return import(path.join(cacheDir, 'index.mjs'));
}


export async function runGraph(graph, { browser, job, registry }) {
    const page = await browser.newPage();
    const ctx = mkCtx({ browser, page, job });
    const nodesById = Object.fromEntries(graph.nodes.map(n => [n.id, n]));
    const order = topoSort(graph.edges);
    for (const id of order) {
        const node = nodesById[id];
        const impl = registry[node.type];
        if (!impl) throw new Error(`Unknown node: ${node.type}`);
        await impl.run(ctx, node.props || {});
    }
}