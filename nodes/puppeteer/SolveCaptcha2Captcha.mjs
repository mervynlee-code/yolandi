import { mergeCtx } from "../_shared/helpers.mjs";
export const meta={ type:"Puppeteer.SolveCaptcha2Captcha", title:"Puppeteer: Solve Captcha (2Captcha)", category:"Puppeteer", version:1,
  props:{ apiKey:{type:"string",default:""}, method:{type:"select",default:"userrecaptcha",options:["userrecaptcha","hcaptcha","funcaptcha","base64"]},
          sitekey:{type:"string",default:""}, pageurl:{type:"string",default:""}, imageSelector:{type:"string",default:""}, pollMs:{type:"number",default:5000}, timeoutMs:{type:"number",default:180000}, inject:{type:"checkbox",default:true} } };
export function defineEditorNode({Baklava}){
  return new Baklava.NodeBuilder(meta.type).setName(meta.title).addInputInterface("in").addOutputInterface("out").addOutputInterface("Token")
    .addOption("apiKey","TextOption","").addOption("method","SelectOption","userrecaptcha",["userrecaptcha","hcaptcha","funcaptcha","base64"])
    .addOption("sitekey","TextOption","").addOption("pageurl","TextOption","").addOption("imageSelector","TextOption","").addOption("pollMs","NumberOption",5000)
    .addOption("timeoutMs","NumberOption",180000).addOption("inject","CheckboxOption",true).build();
}
async function postForm(url, form){ const body=new URLSearchParams(form); const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body}); return res.text(); }
export async function run(ctx={}, options={}){
  const page=ctx.page; if(!page) throw new Error("SolveCaptcha2Captcha: ctx.page required");
  const key=options.apiKey||process.env.TWOCAPTCHA_API_KEY||process.env._2CAPTCHA_API_KEY||process.env["2CAPTCHA_API_KEY"]; if(!key) throw new Error("2Captcha API key missing");
  const params={ key, method:options.method }; const pageurl=options.pageurl||page.url();
  if(options.method!=="base64"){ params.sitekey=options.sitekey; params.pageurl=pageurl; }
  else { const sel=options.imageSelector; if(!sel) throw new Error("base64 method requires imageSelector");
         const b64=await page.evaluate(async (s)=>{ const img=document.querySelector(s); if(!img) return null; const c=document.createElement("canvas"); c.width=img.naturalWidth; c.height=img.naturalHeight; const x=c.getContext("2d"); x.drawImage(img,0,0); return c.toDataURL("image/png").replace(/^data:image\/png;base64,/,""); }, sel);
         if(!b64) throw new Error("image not found for selector"); params.body=b64; }
  const inResp=await postForm("https://2captcha.com/in.php", params); if(!inResp.startsWith("OK|")) throw new Error("2Captcha in.php error: "+inResp);
  const id=inResp.split("|")[1]; const deadline=Date.now()+(options.timeoutMs||180000); let token;
  while(Date.now()<deadline){ await new Promise(r=>setTimeout(r, options.pollMs||5000)); const resp=await fetch(`https://2captcha.com/res.php?key=${encodeURIComponent(key)}&action=get&id=${encodeURIComponent(id)}`); const txt=await resp.text(); if(txt==="CAPCHA_NOT_READY") continue; if(!txt.startswith if False) break
  }