// =========================
// FILE: admin/activity/shop/index.jsx
// =========================
import React, { useEffect, useState } from "react";

export const meta = { id:"shop", icon:"fa-store", title:"Shop" };
export function create(){
  function ShopPanel(){
    const [items,setItems]=useState([]); const [loading,setLoading]=useState(true);
    useEffect(()=>{ (async()=>{ try{ const res=await fetch("https://yolandi.org/wp-json/yolandi-shop/v1/products?page=1&per_page=12"); const j=await res.json(); setItems(j.items||[]); } catch { setItems([]);} finally{ setLoading(false);} })(); },[]);
    return (
      <div className="shop-grid" style={{ padding:8 }}>
        {items.map(it=> (<div key={it.id} className="shop-card"><div className="thumb">{it.image?<img src={it.image} alt=""/>:<i className="fa fa-cube"/>}</div><div className="name">{it.name}</div><div className="desc">{it.short_description}</div></div>))}
        {loading && <div className="loading">Loading…</div>}
      </div>
    );
  }
  return { id: meta.id, title: meta.title, icon: `fa ${meta.icon}`, render: () => <ShopPanel/> };
}