import React from "react";

export default function TabNav({ routes, activeKey, onNavigate }) {
  return (
    <div style={{ display: "flex", gap: 12, margin: "12px 0" }}>
      {routes.map((r) => {
        const active = r.key === activeKey;
        return (
          <a
            key={r.key}
            href={`#/${r.key}`}
            onClick={(e) => {
              // allow native hash navigation (works without JS too),
              // but also notify the parent so state updates immediately.
              onNavigate?.(r.key);
            }}
            className={"button" + (active ? " button-primary" : "")}
            style={{ textDecoration: "none", lineHeight: "28px" }}
          >
            {r.label}
          </a>
        );
      })}
    </div>
  );
}
