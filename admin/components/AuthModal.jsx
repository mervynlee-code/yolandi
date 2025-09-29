// =========================
// FILE: admin/components/AuthModal.jsx
// =========================
import React, { useState } from "react";

export default function AuthModal({ onClose, onLoggedIn }){
  const [mode, setMode] = useState("login");
  const [f, setF] = useState({ username: "", email: "", password: "" }); const [err, setErr] = useState("");
  async function login({ username, password }){
    try{ const res=await fetch("https://yolandi.org/wp-json/yolandi-shop/v1/auth/login",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({username,password})}); const j=await res.json(); if(j?.token){ localStorage.setItem("yolandi_token", j.token); onLoggedIn(); return true; } }catch{} return false;
  }
  async function register({ email, username, password }){
    try{ const res=await fetch("https://yolandi.org/wp-json/yolandi-shop/v1/auth/register",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({email,username,password})}); const j=await res.json(); if(j?.token){ localStorage.setItem("yolandi_token", j.token); onLoggedIn(); return true; } }catch{} return false;
  }
  async function go(){ const ok = mode==="login" ? await login({username:f.username,password:f.password}) : await register({email:f.email,username:f.username,password:f.password}); if(!ok) setErr("Authentication failed"); }
  return (
    <div className="auth-mask">
      <div className="auth-modal">
        <div className="head"><b>Sign in to YOLANDI.org</b><button onClick={onClose}><i className="fa fa-xmark" /></button></div>
        <div className="body">
          {mode==="register" && (<label>Email <input type="email" value={f.email} onChange={(e)=>setF({...f,email:e.target.value})} /></label>)}
          <label>Username <input value={f.username} onChange={(e)=>setF({...f,username:e.target.value})} /></label>
          <label>Password <input type="password" value={f.password} onChange={(e)=>setF({...f,password:e.target.value})} /></label>
          {err && <div className="err">{err}</div>}
        </div>
        <div className="foot">
          <button onClick={go} className="primary">{mode==="login"?"Login":"Create Account"}</button>
          <button onClick={()=>setMode(mode==="login"?"register":"login")} className="ghost">{mode==="login"?"Create an account":"Back to login"}</button>
          <div className="grow" />
          <button onClick={()=>{ window.YOLANDI?.devBypass?.(); onLoggedIn(); }} className="ghost" title="Developer bypass">Bypass</button>
        </div>
      </div>
    </div>
  );
}