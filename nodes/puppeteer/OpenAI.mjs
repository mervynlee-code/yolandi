import { mergeCtx, queryOne } from "../_shared/helpers.mjs";
export const meta={ type:"Puppeteer.OpenAI", title:"Puppeteer: OpenAI", category:"Puppeteer", version:1,
  props:{ apiKey:{type:"string",default:""}, model:{type:"string",default:"gpt-4o-mini"}, selector:{type:"string",default:"body"},
          contentSource:{type:"select",default:"text",options:["text","outerHTML"]}, prompt:{type:"textarea",default:"Summarize."} } };
export function defineEditorNode({Baklava}){
  return new Baklava.NodeBuilder(meta.type).setName(meta.title).addInputInterface("in").addOutputInterface("out").addOutputInterface("Response").addOutputInterface("Echo")
  .addOption("apiKey","TextOption","").addOption("model","TextOption","gpt-4o-mini").addOption("selector","TextOption","body")
  .addOption("contentSource","SelectOption","text",["text","outerHTML"]).addOption("prompt","TextAreaOption","Summarize.").build();
}
export async function run(ctx={}, options={}){
  if(!ctx.page) throw new Error("OpenAI: ctx.page required");
  const handle=await queryOne(ctx.page, options.selector||"body"); if(!handle) throw new Error("OpenAI: selector not found");
  const echo=await ctx.page.evaluate((el,mode)=>mode==="outerHTML"?(el.outerHTML||""):(el.innerText||el.textContent||""), handle, options.contentSource||"text");
  const key=(options.apiKey||process.env.OPENAI_API_KEY||"").trim(); if(!key) throw new Error("OpenAI: Missing OPENAI_API_KEY");
  const res=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${key}`,"Content-Type":"application/json"}, body:JSON.stringify({model:options.model||"gpt-4o-mini",messages:[{role:"system",content:"Be concise."},{role:"user",content:`${options.prompt||""}\n\n---\nCONTENT:\n${echo}`}]})});
  const json=await res.json(); const text=json.choices?.[0]?.message?.content||"";
  return mergeCtx(ctx,{openaiResponse:text, echo});
}