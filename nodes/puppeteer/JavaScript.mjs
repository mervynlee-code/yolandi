import { mergeCtx } from "../_shared/helpers.mjs";
export const meta={ type:"Puppeteer.JavaScript", title:"Puppeteer: JavaScript (page.evaluate)", category:"Puppeteer", version:1,
  props:{ code:{type:"textarea",default:"return document.title;"} } };
export function defineEditorNode({Baklava}){
  return new Baklava.NodeBuilder(meta.type).setName(meta.title).addInputInterface("in").addOutputInterface("out").addOutputInterface("Result")
    .addOption("code","TextAreaOption","return document.title;").build();
}
export async function run(ctx={}, options={}){
  if(!ctx.page) throw new Error("JavaScript: ctx.page required");
  const fn=new Function(options.code); const result=await ctx.page.evaluate(fn);
  return mergeCtx(ctx,{result});
}