// =========================
// FILE: admin/components/NodeTree.jsx
// =========================
import React, { useState } from "react";

export default function NodeTree({ grouped, onDragStart }){
  const [open, setOpen] = useState(()=> new Set(Object.keys(grouped)));
  const toggle=(k)=>{ const n=new Set(open); n.has(k)?n.delete(k):n.add(k); setOpen(n); };
  return (
    <div className="node-tree">
      {Object.keys(grouped).sort().map(folder => (
        <div key={folder} className="folder">
          <div className="folder-head" onClick={()=>toggle(folder)}><i className={`fa fa-caret-${open.has(folder)?"down":"right"}`} /><span>{folder}</span></div>
          {open.has(folder) && (
            <div className="folder-body">
              {grouped[folder].map((n)=>{ const name=n?.meta?.title||n?.meta?.type||n?.path||"Node"; return (
                <div key={name + n.path} className="node-item" draggable title={name} onDragStart={(e)=>onDragStart(e,n)}>
                  <i className="fa fa-cube" /><span>{name}</span>
                </div>
              ); })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}