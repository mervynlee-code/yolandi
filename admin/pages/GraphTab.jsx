// admin/pages/GraphTab.jsx
import React, { useEffect, useRef, useState } from "react";
import { apiWithTimeout } from "../core/api";

/* ---------------- ensure theme css ---------------- */
async function ensureBaklavaThemeCss(log) {
  const injected = new Set(
    Array.from(document.styleSheets)
      .map((ss) => ss.href || ss.ownerNode?.getAttribute?.("href") || "")
      .filter(Boolean)
  );
  const inject = (href) =>
    new Promise((res, rej) => {
      if (!href) return rej(new Error("no href"));
      if (injected.has(href)) return res(true);
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = () => res(true);
      link.onerror = () => rej(new Error("css load failed: " + href));
      document.head.appendChild(link);
    });

  const tryUrlImport = async (spec) => {
    try {
      const mod = await import(/* @vite-ignore */ `${spec}?url`);
      if (mod?.default) {
        await inject(mod.default);
        log("theme loaded via import", spec);
        return true;
      }
    } catch {}
    return false;
  };

  const pluginBase =
    window?.YOLANDI_BOOT?.pluginUrl?.replace(/\/$/, "") ||
    (() => {
      const scripts = Array.from(document.getElementsByTagName("script"));
      for (const s of scripts) {
        const src = s.getAttribute("src") || "";
        const m = src.match(/^(.*\/wp-content\/plugins\/yolandi)\//);
        if (m) return m[1];
      }
      return "/wp-content/plugins/yolandi";
    })();

  const candidates = [
    "@baklavajs/themes/dist/syrup-dark.css",
    "@baklavajs/themes/dist/classic.css",
  ];

  for (const c of candidates) if (await tryUrlImport(c)) return;

  for (const c of candidates) {
    const direct = `${pluginBase}/node_modules/${c}`;
    try {
      await inject(direct);
      log("theme loaded via direct url", direct);
      return;
    } catch {}
  }

  log("theme not found; applying minimal inline styles");
  const style = document.createElement("style");
  style.textContent = `
    .baklava-editor,.bk-editor{background:#0f172a;color:#e5e7eb;min-height:100%;position:relative}
    .bk-toolbar{background:#0b1220;border-bottom:1px solid #1f2937;padding:6px}
    .bk-btn{background:#111827;border:1px solid #374151;color:#e5e7eb;padding:4px 6px;border-radius:6px}
    .baklava-node,.bk-node{background:#1f2937;border:1px solid #4b5563;border-radius:10px;color:#e5e7eb;min-width:220px}
    .baklava-node .title,.bk-node__title{font-weight:600;color:#fff;padding:6px 8px}
    .bk-interface,.baklava-port{padding:6px 8px}
    .baklava-connection-path,.bk-connection path{stroke:#93c5fd;stroke-width:2px}
    .bk-editor, .bk-editor * { pointer-events: auto; }
    .bk-palette .bk-palette-item { cursor: grab; }
    .bk-palette .bk-palette-item:active { cursor: grabbing; }
  `;
  document.head.appendChild(style);
}

/* ---------------- component ---------------- */
export default function GraphTab() {
  const mountRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    let cleanup = () => {};
    const log = (...a) => console.log("[YOLANDI Graph]", ...a);

    (async () => {
      try {
        log("start");
        log("fetching /nodes…");
        const nodesList = await apiWithTimeout("/nodes", 15000);
        log("nodes received", Array.isArray(nodesList) ? nodesList.length : nodesList);
        if (!Array.isArray(nodesList)) throw new Error("Nodes endpoint did not return an array");
        if (!alive) return;

        log("importing vue/renderer/baklava…");
        const vue = await import("vue");
        const rv = await import("@baklavajs/renderer-vue");
        const bk = await import("baklavajs");

        await ensureBaklavaThemeCss(log);

        // host
        let tries = 0;
        while (alive && !mountRef.current && tries < 10) {
          await new Promise((r) => requestAnimationFrame(r));
          tries++;
        }
        if (!alive) return;
        const root = mountRef.current;
        if (!root) {
          setError("Graph host not found");
          setStatus("error");
          return;
        }
        const host = document.createElement("div");
        Object.assign(host.style, {
          height: "640px",
          border: "1px solid #ccd0d4",
          background: "#0f172a",
          display: "flex",
          flexDirection: "column",
        });
        root.innerHTML = "";
        root.appendChild(host);
        log("host attached");

        const BaklavaEditor =
          rv.BaklavaEditor || rv.default?.BaklavaEditor || rv.default;
        if (!BaklavaEditor) throw new Error("BaklavaEditor component not found");

        // Vue app
        const AppVue = {
          components: { BaklavaEditor },
          setup() {
            const { h, onMounted, nextTick } = vue;

            // Get renderer context from plugin
            const vm = rv.useBaklava?.();
            if (!vm) throw new Error("renderer plugin not available (useBaklava missing)");
            if (!vm.editor) throw new Error("renderer editor not available from plugin");

            // ---- Register node types ONCE
            const mkUI = (spec = {}) => {
              const { kind = "string", name, value, options, min, max } = spec;
              try {
                switch (kind) {
                  case "text":
                  case "string":   return new rv.TextInputInterface(name, value ?? "");
                  case "textarea": return new rv.TextareaInputInterface(name, value ?? "");
                  case "label":    return new rv.TextInterface(name, String(value ?? ""));
                  case "integer":  return new rv.IntegerInterface(
                    name,
                    Number.isInteger(value) ? value : 0,
                    typeof min === "number" ? min : undefined,
                    typeof max === "number" ? max : undefined
                  );
                  case "number":   return new rv.NumberInterface(
                    name,
                    Number(value ?? 0),
                    typeof min === "number" ? min : undefined,
                    typeof max === "number" ? max : undefined
                  );
                  case "slider":   return new rv.SliderInterface(
                    name,
                    Number(value ?? 0),
                    Number.isFinite(min) ? min : 0,
                    Number.isFinite(max) ? max : 100
                  );
                  case "boolean":
                  case "checkbox": return new rv.CheckboxInterface(name, Boolean(value));
                  case "select":   return new rv.SelectInterface(
                    name,
                    value,
                    Array.isArray(options) ? options : []
                  );
                  case "button":   return new rv.ButtonInterface(
                    name,
                    typeof value === "function" ? value : () => {}
                  );
                  default:         return new bk.NodeInterface(name, value);
                }
              } catch {
                return new bk.NodeInterface(name, value);
              }
            };

            const defs = [];
            for (const n of nodesList) {
              const meta = n?.meta || {};
              const type = String(meta.type || n.path || "").replace(/\.mjs$/i, "") || "CustomNode";
              const title = meta.title || type;
              const category = meta.category || "YOLANDI";
              const props = meta.props && typeof meta.props === "object" ? meta.props : {};
              const extraIns = Array.isArray(meta.inputs) ? meta.inputs : [];
              const extraOuts = Array.isArray(meta.outputs) ? meta.outputs : [];

              const Def = bk.defineNode({
                type,
                inputs: {
                  in: () => new bk.NodeInterface("in"),
                  ...Object.fromEntries(
                    Object.entries(props).map(([k, s]) => [k, () => mkUI({ name: k, ...(s || {}) })])
                  ),
                  ...Object.fromEntries(extraIns.map((name) => [name, () => new bk.NodeInterface(String(name))])),
                },
                outputs: {
                  out: () => new bk.NodeInterface("out"),
                  ...Object.fromEntries(extraOuts.map((name) => [name, () => new bk.NodeInterface(String(name))])),
                },
              });

              try {
                vm.editor.registerNodeType(Def, { title, category });
              } catch {
                vm.editor.registerNodeType(Def);
              }
              defs.push({ type, Def });
            }
            console.log("[YOLANDI Graph] registered types:", defs.map((d) => d.type));

            // ---- Seed defaults into the ACTIVE graph
            onMounted(async () => {
              await nextTick();

              let graph = vm.displayedGraph;
              if (!graph) {
                graph = new bk.Graph();
                // prefer name-based register+switch if present
                if (typeof vm.registerGraph === "function" && typeof vm.switchGraph === "function") {
                  vm.registerGraph("main", graph);
                  vm.switchGraph("main");
                } else if (typeof vm.switchGraph === "function") {
                  vm.switchGraph(graph);
                } else {
                  // If neither is present, still add nodes; some builds auto-display latest
                }
              }

              const place = (Def, x, y) => {
                try {
                  if (!Def || !graph) return null;
                  const node = new Def();
                  node.position = { x, y };
                  graph.addNode(node);
                  return node;
                } catch (e) {
                  console.warn("[YOLANDI Graph] place failed", e);
                  return null;
                }
              };

              place(defs[0]?.Def, 140, 120);
              place(defs[1]?.Def, 380, 160);
              place(defs[2]?.Def, 620, 200);

              try { vm.fitToContent?.(); vm.viewModel?.fitToContent?.(); } catch {}

              setTimeout(() => {
                const count =
                  document.querySelector(".bk-editor")?.querySelectorAll?.(".bk-node").length || 0;
                console.log("[YOLANDI Graph] DOM node elements visible:", count);
              }, 60);
            });

            // render
            return () => {
              const h = vue.h;
              const toolbar = h(
                "div",
                {
                  style: {
                    padding: "8px",
                    borderTop: "1px solid #1f2937",
                    background: "#0b1220",
                    display: "flex",
                    gap: "8px",
                  },
                },
                [
                  h(
                    "button",
                    {
                      class: "button button-secondary",
                      onClick: () => {
                        try {
                          const data = JSON.stringify(vm.editor.save(), null, 2);
                          const w = window.open();
                          if (w) w.document.write(`<pre>${data.replace(/</g, "&lt;")}</pre>`);
                        } catch (e) {
                          alert("Unable to export: " + (e?.message || e));
                        }
                      },
                    },
                    "Export JSON"
                  ),
                  h(
                    "button",
                    {
                      class: "button",
                      onClick: async () => {
                        const json = prompt("Paste graph JSON");
                        if (!json) return;
                        try {
                          vm.editor.load(JSON.parse(json));
                        } catch {
                          alert("Invalid JSON");
                        }
                      },
                    },
                    "Import JSON"
                  ),
                ]
              );

              // IMPORTANT: pass the viewModel explicitly so renderer never tries to
              // read switchGraph from an undefined injection.
              return h(
                "div",
                { style: { height: "100%", display: "flex", flexDirection: "column" } },
                [h(BaklavaEditor, { viewModel: vm }), toolbar]
              );
            };
          },
        };

        const app = vue.createApp(AppVue);

        // Provide renderer plugin BEFORE mounting
        if (typeof rv.providePlugin === "function") {
          rv.providePlugin(app);
        }

        app.mount(host);
        cleanup = () => app.unmount();

        if (!alive) cleanup();
        log("mounted");
        setStatus("ready");
      } catch (e) {
        if (!alive) return;
        console.error("[YOLANDI Graph] error", e);
        setError(String(e?.message || e));
        setStatus("error");
      }
    })();

    return () => {
      alive = false;
      cleanup();
    };
  }, []);

  return (
    <div style={{ position: "relative", minHeight: 640 }}>
      <div ref={mountRef} />
      {status === "loading" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            background: "rgba(255,255,255,0.6)",
          }}
        >
          <p>Loading Graph editor…</p>
        </div>
      )}
      {status === "error" && (
        <div className="y-card" style={{ marginTop: 8 }}>
          <h3>BaklavaJS not available</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{error}</pre>
        </div>
      )}
    </div>
  );
}
