// =========================
// FILE: admin/lib/runnerCommands.js
// =========================
import { apiBase } from "./api.js";
export function buildRunnerCommands({ runnerId, nodesDir, runnerPath }={}){ const base=apiBase(); const RID=runnerId||`runner-${Math.random().toString(36).slice(2)}`; const NODES_DIR=nodesDir||"/wp-content/plugins/yolandi/nodes"; const RUNNER=runnerPath||"/wp-content/plugins/yolandi/runner/pause-aware-runner.js"; const ps=[`$env:YOLANDI_API=\"${base}\"`,`$env:YOLANDI_NODES_DIR=\"${NODES_DIR}\"`,`$env:YOLANDI_RUNNER_ID=\"${RID}\"`,`node \"${RUNNER}\"`].join(" ; "); const sh=[`YOLANDI_API='${base}'`,`YOLANDI_NODES_DIR='${NODES_DIR}'`,`YOLANDI_RUNNER_ID='${RID}'`,`node '${RUNNER}'`].join(" "); return { ps, sh }; }
