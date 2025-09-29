import { useEffect, useMemo, useState } from "react";

function parseHash() {
  // supports "#/graph" and "#graph"
  const raw = (window.location.hash || "").replace(/^#\/?/, "");
  const [key, ...rest] = raw.split("/");
  return { key: key || "", rest: rest.join("/") };
}

export function useHashRouter(routes, defaultKey = "") {
  const routeMap = useMemo(
    () =>
      routes.reduce((acc, r) => {
        acc[r.key] = r;
        return acc;
      }, {}),
    [routes]
  );

  const [routeKey, setRouteKey] = useState(() => {
    const { key } = parseHash();
    return routeMap[key] ? key : defaultKey;
  });

  useEffect(() => {
    const onHash = () => {
      const { key } = parseHash();
      setRouteKey(routeMap[key] ? key : defaultKey);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [routeMap, defaultKey]);

  const navigate = (key) => {
    if (!routeMap[key]) return;
    if (parseHash().key === key) return; // avoid double-render
    window.location.hash = `#/${key}`;
  };

  return {
    routeKey,
    active: routeMap[routeKey],
    navigate,
  };
}
