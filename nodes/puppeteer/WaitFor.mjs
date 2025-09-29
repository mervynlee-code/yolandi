import { mergeCtx, waitForSelectable } from "../_shared/helpers.mjs";
export const meta={ type:"Puppeteer.WaitFor", title:"Puppeteer: WaitFor", category:"Puppeteer", version:1,
  props:{ type:{type:"select",default:"selector",options:["selector","function"]}, selector:{type:"string",default:""},
         visible:{type:"checkbox",default:true}, timeoutMs:{type:"number",default:30000},
         fn:{type:"textarea",default:"return !!document.querySelector('body');"}, fnIntervalMs:{type:"number",default:500} } };
export function defineEditorNode({Baklava}){
  return new Baklava.NodeBuilder(meta.type).setName(meta.title).addInputInterface("in").addOutputInterface("out")
    .addOption("type","SelectOption","selector",["selector","function"]).addOption("selector","TextOption","")
    .addOption("visible","CheckboxOption",true).addOption("timeoutMs","NumberOption",30000).addOption("fn","TextAreaOption","return !!document.querySelector('body');")
    .addOption("fnIntervalMs","NumberOption",500).build();
}
export async function run(ctx={}, options={}){
  if(!ctx.page) throw new Error("WaitFor: ctx.page required");
  if(options.type==="selector"){ await waitForSelectable(ctx.page, options.selector, {visible:!!options.visible, timeout:options.timeoutMs}); }
  else{ const deadline=Date.now()+(options.timeoutMs||30000); let ok=false,lastErr;
    while(Date.now()<deadline){ try{ ok=await ctx.page.evaluate(new Function(options.fn)); if(ok) break; }catch(e){lastErr=e}
      await ctx.page.waitForTimeout(options.fnIntervalMs||500); }
    if(!ok) throw lastErr||new Error("WaitFor function did not return truthy"); }
  return mergeCtx(ctx,{});
}