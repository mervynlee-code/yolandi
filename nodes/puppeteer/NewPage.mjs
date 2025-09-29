import { mergeCtx, waitForSelectable } from "../_shared/helpers.mjs";
export const meta={ type:"Puppeteer.NewPage", title:"Puppeteer: New Page", category:"Puppeteer", version:1,
  props:{ url:{type:"string",default:"about:blank"}, waitUntil:{type:"select",default:"networkidle2",options:["load","domcontentloaded","networkidle0","networkidle2"]},
         waitFor:{type:"string",default:""}, headersJson:{type:"textarea",default:""} } };
export function defineEditorNode({Baklava}){
  return new Baklava.NodeBuilder(meta.type).setName(meta.title).addInputInterface("in").addOutputInterface("out").addOutputInterface("Page")
    .addOption("url","TextOption","about:blank").addOption("waitUntil","SelectOption","networkidle2",["load","domcontentloaded","networkidle0","networkidle2"])
    .addOption("waitFor","TextOption","").addOption("headersJson","TextAreaOption","").build();
}
export async function run(ctx={}, options={}){
  if(!ctx.browser) throw new Error("NewPage: missing ctx.browser");
  const page=await ctx.browser.newPage();
  await page.setBypassCSP(true);
  if(ctx.userAgent) await page.setUserAgent(ctx.userAgent);
  if(options.headersJson){ try{ await page.setExtraHTTPHeaders(JSON.parse(options.headersJson)); }catch{} }
  if(ctx.proxy&&ctx.proxy.username){ await page.authenticate({username:ctx.proxy.username,password:ctx.proxy.password||""}); }
  if(options.url&&options.url!=="about:blank"){ await page.goto(options.url,{waitUntil:options.waitUntil||"networkidle2"}); }
  if(options.waitFor) await waitForSelectable(page, options.waitFor, {visible:true});
  return mergeCtx(ctx,{page});
}