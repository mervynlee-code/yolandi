import { chromium } from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { loadRegistry, runGraph } from './yolandi-runtime.mjs';


export const handler = async () => {
    const job = await lease();
    if (!job) return { statusCode: 204 };
    const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath() });
    try {
        const { registry } = await loadRegistry(process.env.YOLANDI_BASE_URL, process.env.YOLANDI_SECRET, '/tmp/nodes');
        await runGraph(job.graph, { browser, job, registry });
        await report(job.id, { status: 'succeeded', artifacts: collectArtifacts() });
    } catch (e) {
        await report(job.id, { status: 'failed', error: serialize(e) });
    } finally { await browser.close(); }
};