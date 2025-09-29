import ScriptsTab from "./ScriptsTab.jsx";
import JobsTab from "./JobsTab.jsx";
import NodesTab from "./NodesTab.jsx";
import GraphApp from "../app/GraphApp.jsx";

// Dynamic, single source of truth for tabs.
// To add a new page, just import it here and add an entry.
const routes = [
  { key: "scripts", label: "Scripts", Component: ScriptsTab },
  { key: "jobs",    label: "Jobs",    Component: JobsTab },
  { key: "nodes",   label: "Nodes",   Component: NodesTab },
  { key: "graph",   label: "Graph",   Component: GraphApp },
];

export default routes;