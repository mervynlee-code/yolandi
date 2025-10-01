import React from "react";
import { createRoot } from "react-dom/client";
import { useHashRouter } from "./router";
import TabNav from "./components/TabNav.jsx";
import routes from "./pages";

// --- MONACO WORKERS (bundle + runtime mapping) ---
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker   from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker    from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker   from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker     from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

if (!self.MonacoEnvironment) {
  self.MonacoEnvironment = {
    getWorker(_moduleId, label) {
      switch (label) {
        case 'json':        return new jsonWorker();
        case 'css':         return new cssWorker();
        case 'html':        return new htmlWorker();
        case 'typescript':
        case 'javascript':  return new tsWorker();
        default:            return new editorWorker();
      }
    },
  };
}

function App() {
  const { routeKey, active, navigate } = useHashRouter(routes, "scripts");

  const ActiveComponent = active?.Component || (() => <div />);

  return (
    <div style={{ padding: 12 }}>
      <h1>YOLANDI Admin</h1>
      {/* <TabNav
        routes={routes}
        activeKey={routeKey}
        onNavigate={(key) => navigate(key)}
      /> */}
      <ActiveComponent />
    </div>
  );
}

(function mount() {
  const el = document.getElementById("yolandi-root");
  if (!el) return;
  const root = createRoot(el);
  root.render(<App />);
})();
