import { mergeCtx } from "../_shared/helpers.mjs";
export const meta={ type:"Puppeteer.RequestInterception", title:"Puppeteer: Request Interception", category:"Puppeteer", version:1,
  props:{ rulesJson:{type:"textarea",default:"[]"} } };
export function defineEditorNode({Baklava}){
  return new Baklava.NodeBuilder(meta.type).setName(meta.title).addInputInterface("in").addOutputInterface("out").addOption("rulesJson","TextAreaOption","[]").build();
}
function globToRegex(glob){ const s=String(glob).replace(/[.+^${}()|[\]\\]/g,"\\$&").replace(/\*/g,".*").replace(/\?/g,"."); return new RegExp("^"+s+"$"); }
export async function run(ctx={}, options={}){
  if(!ctx.page) throw new Error("RequestInterception: ctx.page required");
  const page=ctx.page; const rules=(()=>{ try{return JSON.parse(options.rulesJson||"[]")}catch{return[]} })();
  const compiled=rules.map(r=>({...r,_regex:globToRegex(r.pattern||"*")}));
  await page.setRequestInterception(true); page.removeAllListeners("request");
  page.on("request", async (request)=>{
    const url=request.url(); const rule=compiled.find(r=>r._regex.test(url)); if(!rule) return request.continue();
    try{
      if(rule.action==="block") return request.abort();
      if(rule.action==="modify"){ const overrides={}; if(rule.headers) overrides.headers={...(request.headers()||{}),...rule.headers};
        if(rule.method) overrides.method=rule.method; if(rule.postData) overrides.postData=rule.postData; return request.continue(overrides); }
      if(rule.action==="mock"){ return request.respond({ status:rule.status||200, headers:{"Content-Type":rule.contentType||"text/plain"}, body:rule.body||"" }); }
      if(rule.action==="script"&&rule.js){ const fn=new Function("request",rule.js); const res=await fn(request);
        if(res==="abort") return request.abort(); if(res&&typeof res==="object") return request.continue(res); }
    }catch(e){}
    return request.continue();
  });
  return mergeCtx(ctx,{});
}