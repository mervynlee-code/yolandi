import { mergeCtx } from "../_shared/helpers.mjs";
export const meta={ type:"Puppeteer.GlobalProxy", title:"Puppeteer: Global Proxy", category:"Puppeteer", version:1,
  props:{ protocol:{type:"select",default:"http",options:["http","https","socks4","socks5"]}, host:{type:"string",default:""}, port:{type:"number",default:8080},
          username:{type:"string",default:""}, password:{type:"string",default:""}, bypass:{type:"string",default:""} } };
export function defineEditorNode({Baklava}){
  return new Baklava.NodeBuilder(meta.type).setName(meta.title).addInputInterface("in").addOutputInterface("out").addOutputInterface("Proxy")
    .addOption("protocol","SelectOption","http",["http","https","socks4","socks5"]).addOption("host","TextOption","").addOption("port","NumberOption",8080)
    .addOption("username","TextOption","").addOption("password","TextOption","").addOption("bypass","TextOption","").build();
}
export async function run(ctx={}, options={}){
  const url = `${options.protocol||"http"}://${options.username?`${encodeURIComponent(options.username)}:${encodeURIComponent(options.password||"")}@`:""}${options.host}:${options.port}`;
  return mergeCtx(ctx,{ proxy:{...options,url} });
}