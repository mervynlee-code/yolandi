import { mergeCtx, queryOne, waitForSelectable } from "../_shared/helpers.mjs";
export const meta={ type:"Puppeteer.SelectorGetSet", title:"Puppeteer: Selector Get/Set", category:"Puppeteer", version:1,
  props:{ mode:{type:"select",default:"get",options:["get","set"]}, selector:{type:"string",default:""}, waitFor:{type:"checkbox",default:true},
         prop:{type:"select",default:"text",options:["text","innerHTML","outerHTML","value","attr","data"]}, name:{type:"string",default:""},
         value:{type:"string",default:""}, evalJS:{type:"textarea",default:""} } };
export function defineEditorNode({Baklava}){
  return new Baklava.NodeBuilder(meta.type).setName(meta.title).addInputInterface("in").addOutputInterface("out").addOutputInterface("Value")
  .addOption("mode","SelectOption","get",["get","set"]).addOption("selector","TextOption","").addOption("waitFor","CheckboxOption",true)
  .addOption("prop","SelectOption","text",["text","innerHTML","outerHTML","value","attr","data"]).addOption("name","TextOption","")
  .addOption("value","TextAreaOption","").addOption("evalJS","TextAreaOption","").build();
}
export async function run(ctx={}, options={}){
  if(!ctx.page) throw new Error("SelectorGetSet: ctx.page required");
  const page=ctx.page; if(options.waitFor&&options.selector) await waitForSelectable(page, options.selector, {visible:true});
  const handle=await queryOne(page, options.selector); if(!handle) throw new Error("Element not found");
  const prop=options.prop||"text"; let ret;
  if(options.evalJS){ ret=await page.evaluate((el,js)=>{ const fn=new Function("el", js); return fn(el); }, handle, options.evalJS); }
  else if(options.mode==="get"){
    if(prop==="text") ret=await page.evaluate(el=>el.textContent??"",handle);
    else if(prop==="innerHTML") ret=await page.evaluate(el=>el.innerHTML??"",handle);
    else if(prop==="outerHTML") ret=await page.evaluate(el=>el.outerHTML??"",handle);
    else if(prop==="value") ret=await page.evaluate(el=>el.value??"",handle);
    else if(prop==="attr") ret=await page.evaluate((el,name)=>el.getAttribute(name)??"",handle,options.name||"");
    else if(prop==="data") ret=await page.evaluate((el,name)=>el.dataset?.[name]??"",handle,options.name||"");
  } else {
    if(prop in {text:1,innerHTML:1,outerHTML:1}) ret=await page.evaluate((el,p,v)=>(el[p==="text"?"textContent":p]=v,v),handle,prop,options.value);
    else if(prop==="value") ret=await page.evaluate((el,v)=>(el.value=v,v),handle,options.value);
    else if(prop==="attr") ret=await page.evaluate((el,name,v)=>(el.setAttribute(name,v),v),handle,options.name||"",options.value);
    else if(prop==="data") ret=await page.evaluate((el,name,v)=>(el.dataset[name]=v,v),handle,options.name||"",options.value);
  }
  return mergeCtx(ctx,{value:ret});
}