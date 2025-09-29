import path from "node:path";
import { mergeCtx, getArtifactsDir, stampName } from "../_shared/helpers.mjs";
export const meta={ type:"Puppeteer.ScreenshotPdf", title:"Puppeteer: Screenshot / PDF", category:"Puppeteer", version:1,
  props:{ mode:{type:"select",default:"screenshot",options:["screenshot","pdf"]}, fileStem:{type:"string",default:"capture"},
         dir:{type:"string",default:""}, fullPage:{type:"checkbox",default:true}, quality:{type:"number",default:90},
         type:{type:"select",default:"png",options:["png","jpeg"]}, pdfFormat:{type:"select",default:"A4",options:["Letter","Legal","A4","A3"]},
         landscape:{type:"checkbox",default:false} } };
export function defineEditorNode({Baklava}){
  return new Baklava.NodeBuilder(meta.type).setName(meta.title).addInputInterface("in").addOutputInterface("out").addOutputInterface("Path")
    .addOption("mode","SelectOption","screenshot",["screenshot","pdf"]).addOption("fileStem","TextOption","capture")
    .addOption("dir","TextOption","").addOption("fullPage","CheckboxOption",true).addOption("quality","NumberOption",90)
    .addOption("type","SelectOption","png",["png","jpeg"]).addOption("pdfFormat","SelectOption","A4",["Letter","Legal","A4","A3"])
    .addOption("landscape","CheckboxOption",false).build();
}
export async function run(ctx={}, options={}){
  if(!ctx.page) throw new Error("Screenshot/PDF: ctx.page required");
  const dir=options.dir||getArtifactsDir(ctx); const mode=options.mode||"screenshot"; let p;
  if(mode==="pdf"){ p=path.join(dir, stampName(options.fileStem||"capture","pdf")); await ctx.page.pdf({path:p, format:options.pdfFormat||"A4", landscape:!!options.landscape}); }
  else { const ext=options.type||"png"; p=path.join(dir, stampName(options.fileStem||"capture",ext));
         await ctx.page.screenshot({path:p, fullPage:!!options.fullPage, type:ext, quality:ext==="jpeg"?(options.quality||90):undefined}); }
  return mergeCtx(ctx,{path:p});
}