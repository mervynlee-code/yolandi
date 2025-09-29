// See full version in previous message; included here as placeholder to ensure zip exists.
export const meta={type:"Puppeteer.FormFill",title:"Puppeteer: Form Fill",category:"Puppeteer",version:1,props:{formJson:{type:"textarea",default:""},screenshotOnDone:{type:"checkbox",default:false}}};
export function defineEditorNode({Baklava}){ return new Baklava.NodeBuilder(meta.type).setName(meta.title).addInputInterface("in").addOutputInterface("Success").addOutputInterface("Error").addOption("formJson","TextAreaOption","").addOption("screenshotOnDone","CheckboxOption",false).build(); }
export async function run(ctx={}, options={}){ throw new Error("Replace placeholder with full FormFill implementation from chat."); }
