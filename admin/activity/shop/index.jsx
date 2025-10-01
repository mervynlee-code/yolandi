import React, { useEffect, useState } from "react";

export const meta = { id: "shop", icon: "fa-store", title: "Shop" };

// WP REST base helper so it works in dev/prod without 404s
function wpRestRoot() {
  const root =
    (window.wpApiSettings && window.wpApiSettings.root) ||
    (window.wp && window.wp.apiSettings && window.wp.apiSettings.root) ||
    "/wp-json/";
  return (root || "/wp-json/").replace(/\/$/, "");
}

export function create() {
  function ShopPanel() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
      (async () => {
        setLoading(true);
        setError("");
        try {
          const base = wpRestRoot();
          const res = await fetch(`${base}/yolandi-shop/v1/products?page=1&per_page=12`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const j = await res.json();
          setItems(j.items || []);
        } catch (e) {
          setError("Shop API unavailable");
          setItems([]);
        } finally {
          setLoading(false);
        }
      })();
    }, []);

    return (
      <div className="shop-grid" style={{ padding: 8 }}>
        {error && <div style={{ color: "#f66", marginBottom: 8 }}>{error}</div>}
        {items.map((it) => (
          <div key={it.id} className="shop-card">
            <div className="thumb">{it.image ? <img src={it.image} alt="" /> : <i className="fa fa-cube" />}</div>
            <div className="name" title={it.name}>{it.name}</div>
            <div className="desc">{it.short_description}</div>
          </div>
        ))}
        {loading && <div className="loading">Loading…</div>}
        {!loading && !items.length && !error && (
          <div style={{ color: "#bbb", fontSize: 12 }}>No products to show.</div>
        )}
      </div>
    );
  }

  return { id: meta.id, title: meta.title, icon: meta.icon, render: () => <ShopPanel /> };
}
