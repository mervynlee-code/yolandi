import puppeteer from "puppeteer";
import { mergeCtx, toArgv } from "../_shared/helpers.mjs";
export const meta = { type: "Puppeteer.Browser", title: "Puppeteer: Browser", category: "Puppeteer", version: 1,
  props: { headless:{type:"checkbox",default:true}, engine:{type:"select",default:"chrome",options:["chrome","chromium","firefox"]},
    executablePath:{type:"string",default:""}, userDataDir:{type:"string",default:""}, cliArgs:{type:"textarea",default:""},
    defaultViewport:{type:"string",default:"1280x800"}, incognito:{type:"checkbox",default:false}, userAgent:{type:"string",default:""},
    timeoutMs:{type:"number",default:60000} } };
export function defineEditorNode({ Baklava }){
  return new Baklava.NodeBuilder(meta.type).setName(meta.title).addInputInterface("in").addInputInterface("Proxy").addOutputInterface("out")
    .addOption("headless","CheckboxOption",true).addOption("engine","SelectOption","chrome",["chrome","chromium","firefox"])
    .addOption("executablePath","TextOption","").addOption("userDataDir","TextOption","").addOption("cliArgs","TextAreaOption","")
    .addOption("defaultViewport","TextOption","1280x800").addOption("incognito","CheckboxOption",false).addOption("userAgent","TextOption","")
    .addOption("timeoutMs","NumberOption",60000).build();
}
export async function run(ctx={}, options={}){
  const [w,h]=String(options.defaultViewport||"1280x800").split("x").map(n=>parseInt(n,10)||0);
  const args=toArgv(options.cliArgs);
  const proxy=ctx.proxy||options.Proxy||null;
  if(proxy&&proxy.url){ args.push(`--proxy-server=${proxy.url}`); if(proxy.bypass) args.push(`--proxy-bypass-list=${proxy.bypass}`); }
  const launchOpts={ headless:!!options.headless, product:options.engine||"chrome", ignoreHTTPSErrors:true, args, defaultViewport:{width:w||1280,height:h||800}, timeout:options.timeoutMs??60000 };
  if(options.executablePath) launchOpts.executablePath=options.executablePath;
  if(options.userDataDir) launchOpts.userDataDir=options.userDataDir;
  const browser=await puppeteer.launch(launchOpts);
  let context=browser.defaultBrowserContext();
  if(options.incognito) context=await browser.createIncognitoBrowserContext();
  const next=mergeCtx(ctx,{browser,context,proxy});
  if(options.userAgent) next.userAgent=String(options.userAgent).trim();
  return next;
}