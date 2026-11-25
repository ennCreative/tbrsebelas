/* Dashboard Transaction Banking Retail Region XI
 * Data dimuat dari data/data.enc.json (AES-256-GCM) dan hanya bisa dibuka dengan Kode Login.
 */
(() => {
"use strict";

const POLL_MS = 5 * 60 * 1000;           // cek data baru tiap 5 menit
const BLN = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
const C = { s1:"#2a78d6", s2:"#eb6834", s3:"#1baf7a", s4:"#eda100", prev:"#b9b8b2", text2:"#52514e", grid:"#ecebe7", seq:["#0d366b","#184f95","#256abf","#3987e5","#6da7ec","#9ec5f4","#cde2fb"] };
const AREA_COLOR = {"AREA DENPASAR":C.s1,"AREA KUTA":C.s2,"AREA MATARAM":C.s3,"AREA KUPANG":C.s4};

let D = null, USER = null, VERSION = null, AREA = "";
const charts = {};
const $ = id => document.getElementById(id);

/* ------------------------------------------------------------------ format */
const nf0 = new Intl.NumberFormat("id-ID",{maximumFractionDigits:0});
const fN = v => nf0.format(v || 0);
function fC(v){ // ringkas
  const a = Math.abs(v||0);
  const f = (x,s) => (x).toLocaleString("id-ID",{maximumFractionDigits:2,minimumFractionDigits:x<100?2:1}) + " " + s;
  if (a >= 1e12) return f(v/1e12,"T");
  if (a >= 1e9)  return f(v/1e9,"M");
  if (a >= 1e6)  return f(v/1e6,"Jt");
  return fN(v);
}
const fRp = v => "Rp " + fC(v);
function fShort(v){                 // label ringkas di atas batang: 7,1M · 28,9T · 4,5rb
  const a = Math.abs(v||0), f = (x,u) => x.toLocaleString("id-ID",{maximumFractionDigits:x<10?1:0}) + u;
  if (a >= 1e12) return f(v/1e12,"T"); if (a >= 1e9) return f(v/1e9,"M"); if (a >= 1e6) return f(v/1e6,"Jt"); if (a >= 1e3) return f(v/1e3,"rb");
  return fN(v);
}
const fP = v => (v==null || !isFinite(v)) ? "–" : (v*100).toLocaleString("id-ID",{maximumFractionDigits:1,minimumFractionDigits:1}) + "%";
const gr = (c,p) => p ? c/p - 1 : null;
function grHtml(c,p,label="YoY"){
  const g = gr(c,p); if (g==null) return `<span>${label} –</span>`;
  return `<span class="${g>=0?"up":"down"}">${g>=0?"▲":"▼"} ${fP(Math.abs(g))}</span> ${label}`;
}
const pctCls = p => p==null ? "" : p>=1 ? "pct-good" : p>=.8 ? "pct-mid" : "pct-bad";
const pctHtml = p => `<span class="${pctCls(p)}">${fP(p)}</span>`;
const sum = (arr, f=x=>x) => arr.reduce((s,x)=>s+(+f(x)||0),0);
const esc = s => String(s??"").replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const title = s => String(s||"").toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());

/* ------------------------------------------------------------------ data terenkripsi */
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function openBox(dk, box){
  const gz = await crypto.subtle.decrypt({name:"AES-GCM", iv:b64(box.iv)}, dk, b64(box.ct));
  return JSON.parse(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).text());
}
let DK = null, DK2 = null;                 // DK: dashboard lengkap, DK2: data Pencarian merchant
const LIMITED_ROLES = {yokke:"Marketing Yokke", outbranch:"Outbranch"};   // peran khusus: hanya menu Pencarian merchant
const BOX = {}, BOX_P = {};
function loadBox(name){            // file data terenkripsi tambahan, dimuat saat dibutuhkan
  if (BOX[name]) return Promise.resolve(BOX[name]);
  if (!BOX_P[name]) BOX_P[name] = fetch(`data/${name}.enc.json?t=`+Date.now(),{cache:"no-store"})
    .then(r => { if (!r.ok) throw new Error(`file data/${name}.enc.json tidak ditemukan`); return r.json(); })
    .then(box => openBox(["merchant","lvm"].includes(name) ? DK2 : DK, box))
    .then(m => { BOX[name] = m; return m; })
    .catch(e => { delete BOX_P[name]; throw e; });
  return BOX_P[name];
}
async function fetchVersion(){
  try { return await fetch("data/version.json?t="+Date.now(),{cache:"no-store"}).then(r=>r.json()); } catch(e){ return null; }
}

/* ------------------------------------------------------------------ server login (Supabase REST) */
const CFG = window.TBR_CONFIG || {};
// cukup alamat dasar project (https://xxxx.supabase.co); buang tambahan seperti /rest/v1/ bila ikut tersalin
const SBU = (() => { try { return new URL(String(CFG.supabaseUrl || "").trim()).origin; } catch(e){ return ""; } })();
const USER_RE = /^[a-z0-9._]{3,30}$/;
const toEmail = u => `${u}@${CFG.emailDomain || "users.tbr11.example.com"}`;
let SESSION = null;
class AuthErr extends Error {}
async function sb(path, {method="GET", body, auth=true, headers={}, retry=true} = {}){
  if (!SBU || !CFG.supabaseAnonKey) throw new AuthErr("Server login belum diatur. Isi assets/config.js sesuai panduan SETUP_LOGIN.md.");
  const h = {apikey:CFG.supabaseAnonKey, "Content-Type":"application/json", ...headers,
             Authorization:"Bearer " + (auth && SESSION ? SESSION.access_token : CFG.supabaseAnonKey)};
  let r;
  try { r = await fetch(SBU + path, {method, headers:h, body: body ? JSON.stringify(body) : undefined}); }
  catch(e){ throw new AuthErr("Tidak bisa terhubung ke server login. Periksa koneksi internet."); }
  if (r.status === 401 && auth && SESSION && retry){ await refreshSession(SESSION.refresh_token); return sb(path, {method, body, auth, headers, retry:false}); }
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch(e){}
  if (!r.ok){
    const err = new AuthErr((j && (j.msg || j.message || j.error_description || j.error)) || ("HTTP " + r.status));
    err.status = r.status; err.code = j && (j.error_code || j.code); throw err;
  }
  return j;
}
function setSession(s){
  SESSION = s && s.access_token ? s : null;
  if (SESSION) sessionStorage.setItem("tbr_rt", SESSION.refresh_token); else sessionStorage.removeItem("tbr_rt");
}
async function refreshSession(rt){
  setSession(await sb("/auth/v1/token?grant_type=refresh_token", {method:"POST", auth:false, body:{refresh_token:rt}}));
}
async function loadProfile(){
  const r = await sb(`/rest/v1/profiles?id=eq.${SESSION.user.id}&select=*`);
  if (!r || !r.length) throw new AuthErr("Profil akun tidak ditemukan. Hubungi admin.");
  return r[0];
}
async function enterDashboard(p){
  if (p.status === "menunggu") throw new AuthErr("Akun Anda masih menunggu persetujuan admin.");
  if (p.status !== "aktif") throw new AuthErr("Akun Anda sedang dinonaktifkan. Hubungi admin.");
  const lim = !!LIMITED_ROLES[p.role];
  const keys = await sb("/rest/v1/app_keys?select=id,k") || [];
  const k1 = keys.find(x => x.id === 1), k2 = keys.find(x => x.id === 2);
  if (!k2 || (!lim && !k1)) throw new AuthErr("Kunci data belum lengkap di server. Admin perlu menjalankan isi file _rahasia\\supabase_kunci.sql dan supabase_peran.sql di Supabase.");
  const imp = async k => {
    try {
      const raw = b64(String(k).replace(/\s+/g, ""));
      if (raw.length !== 32) throw 0;
      return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    } catch(e){ throw new AuthErr("Kunci data di server tidak valid. Admin perlu menjalankan ulang isi file _rahasia\\supabase_kunci.sql (salin langsung dari file, jangan diketik ulang)."); }
  };
  const dk2 = await imp(k2.k), dk = lim ? null : await imp(k1.k);
  const file = lim ? "cari" : "data";
  const enc = await fetch(`data/${file}.enc.json?t=`+Date.now(), {cache:"no-store"}).then(r => { if (!r.ok) throw new AuthErr("File data dashboard tidak ditemukan."); return r.json(); });
  try { D = await openBox(lim ? dk2 : dk, enc); }
  catch(e){ throw new AuthErr("Data dashboard tidak cocok dengan kunci di server. Pastikan file data dan supabase_kunci.sql berasal dari update yang sama."); }
  USER = {nama:p.nama, akses:p.akses || "REGION", role:p.role, lim, jabatan:p.jabatan, unit:p.unit_kerja, foto:p.foto, username:p.username};
  DK = dk; DK2 = dk2; for (const k in BOX) delete BOX[k]; for (const k in BOX_P) delete BOX_P[k];
  VERSION = await fetchVersion();
  start();
}
function busy(on){ $("loading").hidden = !on; $("loginBtn").disabled = on; $("signupBtn").disabled = on; }
async function doLogin(username, password){
  busy(true); $("loginMsg").textContent = "";
  try {
    const u = username.trim().toLowerCase();
    if (!USER_RE.test(u)) throw new AuthErr("Username atau password salah.");
    try { setSession(await sb("/auth/v1/token?grant_type=password", {method:"POST", auth:false, body:{email:toEmail(u), password}})); }
    catch(e){
      const t = (String(e.code||"") + " " + String(e.message||"")).toLowerCase();
      if (t.includes("not_confirmed") || t.includes("not confirmed")) throw new AuthErr("Akun belum terkonfirmasi. Admin perlu mematikan \"Confirm email\" di Supabase, lalu daftar ulang.");
      if (t.includes("invalid") || e.status === 400 || e.status === 401) throw new AuthErr("Username atau password salah. Pastikan akun sudah didaftarkan lewat \"Daftar di sini\" dan huruf besar/kecil password sama persis.");
      throw new AuthErr("Login gagal: " + e.message);
    }
    await enterDashboard(await loadProfile());
  } catch(e){
    console.error(e); setSession(null);
    $("loginMsg").textContent = e instanceof AuthErr ? e.message : "Gagal membuka dashboard: " + e.message;
    showLogin();
  } finally { busy(false); }
}
async function resume(){            // lanjutkan sesi setelah halaman di-refresh
  const rt = sessionStorage.getItem("tbr_rt"); if (!rt) return;
  busy(true);
  try { await refreshSession(rt); await enterDashboard(await loadProfile()); }
  catch(e){ setSession(null); showLogin(); }
  finally { busy(false); }
}
function showLogin(){ $("login").hidden = false; $("app").hidden = true; }
function showForm(which){
  $("loginForm").hidden = which !== "login"; $("signupForm").hidden = which !== "signup"; $("signupDone").hidden = which !== "done";
  $("loginMsg").textContent = ""; $("signupMsg").textContent = "";
  const f = which === "signup" ? $("suNama") : which === "login" ? $("lgUser") : null; if (f) f.focus();
}
document.querySelectorAll("[data-go-form]").forEach(b => b.addEventListener("click", () => showForm(b.dataset.goForm)));

/* ---- pendaftaran ---- */
let SU_FOTO = null;
function resizePhoto(file){          // potong persegi & perkecil ke 200 px, JPEG
  return new Promise((ok, no) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const s = Math.min(img.width, img.height), c = document.createElement("canvas"); c.width = c.height = 200;
      c.getContext("2d").drawImage(img, (img.width-s)/2, (img.height-s)/2, s, s, 0, 0, 200, 200);
      URL.revokeObjectURL(url); ok(c.toDataURL("image/jpeg", .82)); };
    img.onerror = () => no(new AuthErr("File foto tidak bisa dibaca. Gunakan JPG atau PNG."));
    img.src = url; });
}
$("suFoto").addEventListener("change", async e => {
  const f = e.target.files[0]; SU_FOTO = null; $("suAvatar").style.backgroundImage = ""; $("suAvatar").classList.remove("has");
  if (!f) return;
  try { SU_FOTO = await resizePhoto(f); $("suAvatar").style.backgroundImage = `url(${SU_FOTO})`; $("suAvatar").classList.add("has"); }
  catch(err){ $("signupMsg").textContent = err.message; }
});
$("signupForm").addEventListener("submit", async e => {
  e.preventDefault();
  const v = id => $(id).value.trim(), u = v("suUser").toLowerCase(), p = $("suPass").value;
  const msg = $("signupMsg"); msg.textContent = "";
  if (!USER_RE.test(u)) { msg.textContent = "Username 3–30 karakter: huruf kecil, angka, titik, atau garis bawah, tanpa spasi."; $("suUser").focus(); return; }
  if (p.length < 6) { msg.textContent = "Password minimal 6 karakter."; $("suPass").focus(); return; }
  if (p !== $("suPass2").value) { msg.textContent = "Ulangi password tidak sama."; $("suPass2").focus(); return; }
  busy(true);
  try {
    const res = await sb("/auth/v1/signup", {method:"POST", auth:false,
      body:{email:toEmail(u), password:p, data:{username:u, nama:v("suNama"), jabatan:v("suJabatan"), unit_kerja:v("suUnit"), peran:$("suPeran").value}}});
    if (SU_FOTO && res && res.access_token){
      setSession(res);
      try { await sb(`/rest/v1/profiles?id=eq.${res.user.id}`, {method:"PATCH", body:{foto:SU_FOTO}, headers:{Prefer:"return=minimal"}}); } catch(err){ console.warn(err); }
    }
    setSession(null);
    $("doneUser").textContent = u; $("signupForm").reset(); SU_FOTO = null; $("suAvatar").style.backgroundImage = ""; $("suAvatar").classList.remove("has");
    showForm("done");
  } catch(err){
    console.error(err); setSession(null);
    const t = String(err.message || "").toLowerCase();
    msg.textContent = t.includes("already") || t.includes("registered") || t.includes("duplicate") || t.includes("saving new user") ? "Username sudah dipakai. Pilih username lain."
      : t.includes("password") ? "Password terlalu lemah. Gunakan minimal 6 karakter."
      : t.includes("signups not allowed") ? "Pendaftaran sedang ditutup admin."
      : err instanceof AuthErr ? err.message : "Pendaftaran gagal: " + err.message;
  } finally { busy(false); }
});

$("loginForm").addEventListener("submit", e => { e.preventDefault(); doLogin($("lgUser").value, $("lgPass").value); });
$("logoutBtn").addEventListener("click", async () => {
  try { if (SESSION) await sb("/auth/v1/logout", {method:"POST", retry:false}); } catch(e){}
  setSession(null); location.reload();
});
$("reloadBtn").addEventListener("click", async () => {
  $("banner").hidden = true; busy(true);
  try { await enterDashboard(await loadProfile()); } catch(e){ alert(e.message); } finally { busy(false); }
});
setInterval(async () => {
  if (!D) return;
  const v = await fetchVersion();
  if (v && VERSION && v.hash !== VERSION.hash) $("banner").hidden = false;
}, POLL_MS);
if (!SBU || !CFG.supabaseAnonKey) $("loginMsg").textContent = "Server login belum diatur. Isi assets/config.js sesuai panduan SETUP_LOGIN.md.";
resume();

/* ------------------------------------------------------------------ helpers data */
let BAREA = {}, KELAS = {};
function prep(){
  BAREA = {}; KELAS = {};
  for (const [c,t] of Object.entries(D.targets)) { BAREA[c] = t.area; KELAS[c] = t.kelas; }
  for (const r of D.lvm.cube) if (!BAREA[r[1]]) BAREA[r[1]] = r[0];
  for (const r of D.edc.cube) if (!BAREA[r[1]]) BAREA[r[1]] = r[0];
  for (const m of D.atm.machines) if (!BAREA[m.c]) BAREA[m.c] = m.a;
}
const bn = c => D.branches[c] || c || "-";
const inArea = a => !AREA || a === AREA;
const areas = () => AREA ? [AREA] : D.areas;
function lvmDate(){ const [y,m,d] = D.lvm.asof.split("-").map(Number); return {y,m,d,dim:new Date(y,m,0).getDate()}; }
function tgtFor(codes){
  const {m,d,dim} = lvmDate(); const frac = (m-1) + d/dim;
  let t = {akMtd:0, akMtdP:0, akFy:0, akYtd:0, usak:0, edcFy:0};
  for (const c of codes){ const x = D.targets[c]; if (!x) continue;
    t.akMtd += x.tAkMtd; t.akMtdP += x.tAkMtd*d/dim; t.akFy += x.tAkFy; t.akYtd += x.tAkMtd*frac; t.usak += x.tUsak; t.edcFy += x.tEdcFy; }
  return t;
}
function opts(sel, values, allLabel="Semua"){
  const cur = sel.value;
  sel.innerHTML = `<option value="">${allLabel}</option>` + values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");
  if (values.includes(cur)) sel.value = cur;
}

/* ------------------------------------------------------------------ charts */
const chart = (id, cfg) => drawChart($(id), cfg);
const S_ = (label, data, color, extra={}) => Object.assign({label, data, color}, extra);

/* ------------------------------------------------------------------ table */
function table(el, {cols, rows, page=25, search=true, sort, dir=-1, foot, csv, freeze=0, full=false, rowKey=null, onRow=null, needQuery=null}){
  const st = el._st || (el._st = {q:"", sort, dir, p:0});
  st.cols = cols; st.rows = rows;
  const draw = () => {
    let r = st.rows;
    if (st.q){ const q = st.q.toLowerCase(); r = r.filter(x => cols.some(c => String(c.v ? c.v(x) : x[c.k]).toLowerCase().includes(q))); }
    if (st.sort){ const c = cols.find(c=>c.k===st.sort); const g = c && c.v ? c.v : x=>x[st.sort];
      r = [...r].sort((a,b)=>{ const A=g(a), B=g(b); return (typeof A==="number"||typeof B==="number") ? ((A??-Infinity)-(B??-Infinity))*st.dir : String(A).localeCompare(String(B))*st.dir; }); }
    const pages = Math.max(1, Math.ceil(r.length/page)); st.p = Math.min(st.p, pages-1);
    const vis = r.slice(st.p*page, st.p*page+page);
    const cell = (c,x,i) => { const v = c.v ? c.v(x) : x[c.k];
      if (c.num || c.h || c.f) return `<td class="${c.num?"num":""}">${c.h ? c.h(x,v,i) : c.f ? c.f(v,x) : esc(v)}</td>`;
      const t = String(v ?? ""); return `<td class="txt"${t.length > 34 ? ` title="${esc(t)}"` : ""}>${esc(t)}</td>`; };
    if (needQuery && !st.q){
      el.innerHTML = `<div class="tbl-tools"><input type="search" placeholder="Cari…" value=""><span></span></div><div class="empty-q">${needQuery}</div>`;
      const i0 = el.querySelector("input[type=search]"); i0.oninput = e => { st.q = e.target.value; st.p = 0; draw(); const n = el.querySelector("input[type=search]"); n.focus(); n.setSelectionRange(n.value.length,n.value.length); };
      return;
    }
    el.innerHTML = `
      <div class="tbl-tools">${search?`<input type="search" placeholder="Cari…" value="${esc(st.q)}">`:"<span></span>"}
        <span><span class="note">${fN(r.length)} baris</span> ${csv?`<button class="btn" data-csv>Unduh CSV</button>`:""}</span></div>
      <div class="tbl-wrap${full?" full":""}${freeze?" frz":""}"><table><thead><tr>${cols.map(c=>`<th class="${c.num?"num":""}" data-k="${c.k}">${c.l}${st.sort===c.k?`<span class="arr">${st.dir>0?"▲":"▼"}</span>`:""}</th>`).join("")}</tr></thead>
      <tbody>${vis.map((x,i)=>`<tr${rowKey?` data-key="${esc(rowKey(x))}" class="clk" title="Klik untuk melihat performance lengkap"`:""}>${cols.map(c=>cell(c,x,st.p*page+i)).join("")}</tr>`).join("") || `<tr><td colspan="${cols.length}" class="note">Tidak ada data</td></tr>`}</tbody>
      ${foot?`<tfoot><tr>${foot(r).map((v,i)=>`<td class="${cols[i]&&cols[i].num?"num":""}">${v??""}</td>`).join("")}</tr></tfoot>`:""}</table></div>
      ${pages>1?`<div class="pager"><button data-p="-1">‹</button> Hal ${st.p+1} / ${pages} <button data-p="1">›</button></div>`:""}`;
    if (freeze) {   // kolom beku: hitung posisi kiri tiap kolom beku
      const ths = el.querySelectorAll("thead th"); let left = 0;
      for (let i=0;i<freeze && i<ths.length;i++){
        const w = ths[i].offsetWidth;
        el.querySelectorAll(`tr > :nth-child(${i+1})`).forEach(c => { c.classList.add("fz"); c.style.left = left+"px"; if (i===freeze-1) c.classList.add("fz-last"); });
        left += w;
      }
    }
    if (onRow) el.querySelectorAll("tr[data-key]").forEach(tr => tr.onclick = () => onRow(tr.dataset.key));
    const inp = el.querySelector("input[type=search]");
    if (inp) inp.oninput = e => { st.q = e.target.value; st.p = 0; draw(); const n = el.querySelector("input[type=search]"); n.focus(); n.setSelectionRange(n.value.length,n.value.length); };
    el.querySelectorAll("th").forEach(th => th.onclick = () => { const k = th.dataset.k; st.dir = st.sort===k ? -st.dir : -1; st.sort = k; draw(); });
    el.querySelectorAll("[data-p]").forEach(b => b.onclick = () => { st.p = Math.max(0, st.p + +b.dataset.p); draw(); });
    const cb = el.querySelector("[data-csv]");
    if (cb) cb.onclick = () => {
      const lines = [cols.map(c=>`"${c.l.replace(/<[^>]+>/g,"")}"`).join(";")].concat(r.map(x => cols.map(c => { const v = c.v ? c.v(x) : x[c.k]; return typeof v==="number" ? String(v).replace(".",",") : `"${String(v??"").replace(/"/g,'""')}"`; }).join(";")));
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿"+lines.join("\n")],{type:"text/csv"})); a.download = csv + ".csv"; a.click();
    };
  };
  draw();
}

/* ------------------------------------------------------------------ KPI */
const kpi = (lbl, val, cmp="", tag="", barPct=null) =>
  `<div class="kpi"><div class="lbl">${lbl}</div><div class="val">${val}</div><div class="cmp">${cmp}</div>${barPct!=null?`<div class="bar"><i style="width:${Math.min(100,Math.max(0,barPct*100))}%"></i></div>`:""}</div>`;

/* ================================================================== ATM */
function atmData(){
  const j = $("atmJenis").value, g = $("atmGroup").value, A = D.atm;
  const ms = A.machines.filter(m => inArea(m.a) && (!j || m.j===j) && (!g || m.g===g));
  const pv = A.prev.filter(p => inArea(p.a) && (!j || p.j===j) && (!g || p.g===g));
  const n = A.last + 1;
  const mon = k => Array.from({length:n}, (_,i) => sum(ms, m => m[k][i]));
  const pmon = k => Array.from({length:12}, (_,i) => sum(pv, p => p[k][i]));
  return {ms, n, cur:{t:mon("t"), v:mon("v"), f:mon("f"), ts:mon("ts"), vs:mon("vs")}, prev:{t:pmon("t"), v:pmon("v"), f:pmon("f")}};
}
const ytd = (arr,n) => sum(arr.slice(0,n));
const mYtd = (m,k) => sum(m[k]);
function atmSummary(area){
  const A = D.atm, n = A.last+1;
  const ms = A.machines.filter(m => !area || m.a===area), pv = A.prev.filter(p => !area || p.a===area);
  return { n: ms.length, crm: ms.filter(m=>m.j==="CRM").length, f: sum(ms,m=>mYtd(m,"f")), t: sum(ms,m=>mYtd(m,"t")), v: sum(ms,m=>mYtd(m,"v")),
           vs: sum(ms,m=>mYtd(m,"vs")), ts: sum(ms,m=>mYtd(m,"ts")),
           fp: sum(pv,p=>ytd(p.f,n)), tp: sum(pv,p=>ytd(p.t,n)), vp: sum(pv,p=>ytd(p.v,n)) };
}
function renderATM(){
  const A = D.atm, x = atmData(), n = x.n, L = BLN[A.last];
  const metric = $("atmMetric").value, mName = {t:"Transaksi", v:"Volume", f:"Fee based income"}[metric];
  const mf = metric==="t" ? fC : fRp;
  const k = (lbl,key,fmt) => { const c=ytd(x.cur[key],n), p=ytd(x.prev[key]||[],n), lc=x.cur[key][n-1], lp=x.cur[key][n-2];
    return kpi(lbl+` YTD ${A.year}`, fmt(c), `${grHtml(c,p,"dibanding "+(A.year-1))}<br>${L}: ${fmt(lc)} ${n>1?grHtml(lc,lp,"MoM"):""}`); };
  const nCrm = x.ms.filter(m=>m.j==="CRM").length;
  $("atmKpis").innerHTML =
    kpi("Jumlah mesin", fN(x.ms.length), `CRM ${fN(nCrm)}, ATM ${fN(x.ms.length-nCrm)}`) +
    k("Transaksi","t",fC) + k("Volume","v",fRp) + k("Fee based income","f",fRp) +
    kpi(`Volume setor tunai YTD ${A.year}`, fRp(ytd(x.cur.vs,n)), `${fN(ytd(x.cur.ts,n))} transaksi setor`);

  $("atmTrendT").textContent = `${mName} per bulan, ${A.year} dibanding ${A.year-1}`;
  chart("cAtmTrend", {labels:BLN, fmt:mf, series:[S_(String(A.year-1), x.prev[metric]||[], C.prev), S_(String(A.year), x.cur[metric].concat(Array(12-n).fill(null)), C.s1)]});

  $("atmAreaT").textContent = `${mName} Jan–${L} per area`;
  const ar = areas();
  const pvAll = A.prev.filter(p => (!$("atmJenis").value || p.j===$("atmJenis").value) && (!$("atmGroup").value || p.g===$("atmGroup").value));
  chart("cAtmArea", {labels:ar.map(title), fmt:mf, horizontal:true, series:[
      S_(String(A.year-1), ar.map(a => sum(pvAll.filter(p=>p.a===a), p=>ytd(p[metric],n))), C.prev),
      S_(String(A.year), ar.map(a => sum(x.ms.filter(m=>m.a===a), m=>mYtd(m,metric))), C.s1)]});

  const qc = (cats, j) => cats.map(q => x.ms.filter(m => m.j===j && m.q===q).length);
  const crmQ = ["A","B","C","D","E","F"], atmQ = ["Tier 1","Tier 2","Tier 3","Tier 4","F"];
  chart("cAtmQ1", {labels:crmQ.map(q=>"Kuadran "+q), fmt:fN, series:[S_("Jumlah CRM", qc(crmQ,"CRM"), C.s1)]});
  chart("cAtmQ2", {labels:atmQ, fmt:fN, series:[S_("Jumlah ATM", qc(atmQ,"ATM"), C.s1)]});
  renderQSeries(x.ms, n);

  if (MAP.sel && !x.ms.some(m => m.id === MAP.sel)) { MAP.sel = null; $("atmMapDetail").innerHTML = ""; }
  renderAtmMap(x.ms);
  table($("tAtm"), {csv:"mesin_atm", sort:"fy", cols:[
    {k:"id",l:"ID Mesin"}, {k:"nm",l:"Nama Lokasi"}, {k:"j",l:"Jenis", h:(m,v)=>`<span class="pill">${v}</span>`}, {k:"g",l:"Lokasi"},
    {k:"a",l:"Area",f:title}, {k:"cb",l:"Cabang",v:m=>bn(m.c)}, {k:"q",l:`Kuadran ${L}`, h:(m,v)=>qChip(v)}, {k:"qs",l:"Series kuadran", v:m=>(m.qs||[]).join(" "), h:m=>qStrip(m.qs)},
    {k:"ty",l:"Trx YTD",num:1,v:m=>mYtd(m,"t"),f:fN}, {k:"vy",l:"Volume YTD",num:1,v:m=>mYtd(m,"v"),f:fC},
    {k:"fy",l:"FBI YTD",num:1,v:m=>mYtd(m,"f"),f:fC}, {k:"fl",l:`FBI ${L}`,num:1,v:m=>m.f[n-1],f:fC},
    {k:"fm",l:"FBI MoM",num:1,v:m=>gr(m.f[n-1],m.f[n-2]),h:(m,v)=>v==null?"–":`<span class="${v>=0?"up":"down"}">${fP(v)}</span>`}],
    rows:x.ms,
    foot: r => ["Total","","","","","","","", fN(sum(r,m=>mYtd(m,"t"))), fC(sum(r,m=>mYtd(m,"v"))), fC(sum(r,m=>mYtd(m,"f"))), fC(sum(r,m=>m.f[n-1])), ""]});
}

/* ================================================================== EDC */
function edcRows(withFilters=true){
  const E = D.edc, I = Object.fromEntries(E.cols.map((c,i)=>[c,i]));
  const s = $("edcSeg").value, l = $("edcLob").value, tp = $("edcTipe").value;
  const rows = E.cube.filter(r => inArea(r[0]) && (!withFilters || ((!s||r[2]===s) && (!l||r[3]===l) && (!tp||r[4]===tp))));
  const tot = k => sum(rows, r=>r[I[k]]);
  return {rows, I, tot};
}
function edcSummary(area){
  const E = D.edc, I = Object.fromEntries(E.cols.map((c,i)=>[c,i]));
  const rows = E.cube.filter(r => !area || r[0]===area);
  const t = k => sum(rows, r=>r[I[k]]);
  return {sv:t("sv"), svp:t("svp"), md:t("md"), mdp:t("mdp"), tx:t("tx"), txp:t("txp"), fd:t("fd"), fdp:t("fdp"), merch:t("merch"), edc:t("edc"), nw:t("new")};
}
function renderEDC(){
  const E = D.edc, x = edcRows(), I = x.I, t = x.tot, W = `W${E.week}`;
  $("edcKpis").innerHTML =
    kpi("Jumlah merchant", fN(t("merch")), `${fN(t("edc"))} mesin EDC terpasang`) +
    kpi(`Merchant baru ${E.year}`, fN(t("new")), "aktivasi tahun berjalan") +
    kpi(`Sales volume YTD ${W}`, fRp(t("sv")), grHtml(t("sv"),t("svp"))) +
    kpi(`MDFG / Fee YTD ${W}`, fRp(t("md")), grHtml(t("md"),t("mdp"))) +
    kpi(`Transaksi YTD ${W}`, fC(t("tx")), grHtml(t("tx"),t("txp"))) +
    kpi(`Avg funding ${W}`, fRp(t("fd")), grHtml(t("fd"),t("fdp"))) +
    kpi(`Sales volume minggu ${W}`, fRp(t("sw")), grHtml(t("sw"),t("swp"),`vs W${E.week-1}`));

  const ar = areas();
  const byA = (a,k) => sum(x.rows.filter(r=>r[0]===a), r=>r[I[k]]);
  chart("cEdcArea", {labels:ar.map(title), fmt:fC, series:[S_(`YTD ${W} ${E.year-1}`, ar.map(a=>byA(a,"svp")), C.prev), S_(`YTD ${W} ${E.year}`, ar.map(a=>byA(a,"sv")), C.s1)]});

  const yrs = Object.keys(E.hist);
  chart("cEdcHist", {labels:yrs, fmt:fC, series:[S_("Sales Volume", yrs.map(y => sum(ar, a => E.hist[y][a]||0)), yrs.map(y=>y.includes("YTD")?C.s1:"#86b6ef"))]});

  const segs = [...new Set(x.rows.map(r=>r[2]))].map(s => ({s, sv:sum(x.rows.filter(r=>r[2]===s),r=>r[I.sv]), svp:sum(x.rows.filter(r=>r[2]===s),r=>r[I.svp])})).sort((a,b)=>b.sv-a.sv);
  chart("cEdcSeg", {labels:segs.map(s=>s.s), fmt:fC, horizontal:true, series:[S_(String(E.year-1), segs.map(s=>s.svp), C.prev), S_(String(E.year), segs.map(s=>s.sv), C.s1)]});

  const kq = ["On Track","SV Driven","Funding Driven","Review"];
  chart("cEdcKuad", {labels:kq, fmt:fN, series:[S_("Merchant", kq.map(q => sum(E.kuad.filter(k=>inArea(k[0])&&k[1]===q), k=>k[2])), C.s1)]});

  const s = $("edcSeg").value;
  const ghx = (m,v) => v==null?"–":`<span class="${v>=0?"up":"down"}">${fP(v)}</span>`;
  table($("tEdcTop"), {csv:"top_merchant_edc", sort:"sv", page:20, freeze:2, full:true, rows:E.top.filter(m=>inArea(m.a) && (!s||m.s===s)), cols:[
    {k:"nm",l:"Merchant"}, {k:"a",l:"Area",f:title}, {k:"cb",l:"Cabang",v:m=>bn(m.c)},
    {k:"e",l:"EDC",num:1,f:fN}, {k:"svp",l:`SV ${E.year-1}`,num:1,f:fC}, {k:"sv",l:`SV ${E.year}`,num:1,f:fC},
    {k:"g",l:"Growth",num:1,v:m=>gr(m.sv,m.svp),h:ghx},
    {k:"md",l:"MDFG",num:1,f:fC}, {k:"tx",l:"Trx",num:1,f:fN}, {k:"fd",l:"Avg Fund",num:1,f:fC},
    {k:"s",l:"Segmen"}, {k:"l",l:"LOB"}]});
  renderEdcLob();
  renderEdcRank();
}
function lobFilterOpts(){
  const ar = $("lobArea"), cb = $("lobCab");
  const areasOk = D.areas.filter(a => inArea(a));
  const curA = ar.value;
  ar.innerHTML = (AREA ? "" : `<option value="">Region XI</option>`) + areasOk.map(a=>`<option value="${a}">${title(a)}</option>`).join("");
  ar.value = AREA || (areasOk.includes(curA) ? curA : "");
  const a = ar.value, curC = cb.value;
  const codes = [...new Set(D.edc.lob.filter(r => inArea(r[0]) && (!a || r[0]===a)).map(r=>r[1]))].filter(Boolean)
    .sort((x,y) => bn(x).localeCompare(bn(y)));
  cb.innerHTML = `<option value="">Semua cabang</option>` + codes.map(c=>`<option value="${c}">${esc(c+" - "+bn(c))}</option>`).join("");
  cb.value = codes.includes(curC) ? curC : "";
}
function renderEdcLob(){
  const E = D.edc; lobFilterOpts();
  const a = $("lobArea").value, c = $("lobCab").value;
  const lobs = {};
  for (const r of E.lob) if (inArea(r[0]) && (!a || r[0]===a) && (!c || r[1]===c)) {
    const o = lobs[r[2]] || (lobs[r[2]] = {l:r[2], m:0, sv:0, svp:0, md:0}); o.m+=r[3]; o.sv+=r[4]; o.svp+=r[5]; o.md+=r[6]; }
  const totSv = sum(Object.values(lobs), o=>o.sv);
  table($("tEdcLob"), {csv:"lob_edc", sort:"sv", page:20, full:true, rows:Object.values(lobs).filter(o=>o.sv||o.m), cols:[
    {k:"l",l:"LOB"}, {k:"m",l:"Merchant",num:1,f:fN}, {k:"svp",l:`SV ${E.year-1}`,num:1,f:fC}, {k:"sv",l:`SV ${E.year}`,num:1,f:fC},
    {k:"g",l:"Growth",num:1,v:o=>gr(o.sv,o.svp),h:(o,v)=>v==null?"–":`<span class="${v>=0?"up":"down"}">${fP(v)}</span>`},
    {k:"sh",l:"Share",num:1,v:o=>totSv?o.sv/totSv:0,f:fP}, {k:"md",l:"MDFG",num:1,f:fC}],
    foot: r => ["Total", fN(sum(r,o=>o.m)), fC(sum(r,o=>o.svp)), fC(sum(r,o=>o.sv)), (g=>g==null?"–":`<span class="${g>=0?"up":"down"}">${fP(g)}</span>`)(gr(sum(r,o=>o.sv),sum(r,o=>o.svp))), "", fC(sum(r,o=>o.md))]});
}


/* ================================================================== RANKING MERCHANT PER CABANG */
const RANK = {edc:"sv"};
const RANK_M = {sv:["Sales volume", fC, "SV"], md:["MDFG", fC, "MDFG"], tx:["Frekuensi transaksi", fN, "Frek"]};
function cabOptions(sel, codes){
  const cur = sel.value;
  const list = [...new Set(codes)].filter(Boolean).sort((x,y) => bn(x).localeCompare(bn(y)));
  sel.innerHTML = `<option value="">Semua cabang${AREA?` ${title(AREA)}`:" Region XI"}</option>` + list.map(c => `<option value="${c}">${esc(c+" - "+bn(c))}</option>`).join("");
  sel.value = list.includes(cur) ? cur : "";
  return sel.value;
}
function openInSearch(mode, field, q){        // klik baris ranking -> buka performance lengkap di Cari merchant
  MS.mode = mode; MS.sel = null; MS.page = 0;
  goTab("merchant");
  setTimeout(() => { $("msField").value = field; $("msQ").value = q; renderMerchant(); }, 0);
}
const growthTag = v => v==null ? "–" : `<span class="${v>=0?"up":"down"}">${v>=0?"▲":"▼"} ${fP(Math.abs(v))}</span>`;
async function renderEdcRank(){
  const host = $("edcRankBody");
  if (!BOX.merchant){
    host.hidden = true; $("edcRankInfo").textContent = "Menyiapkan data merchant…";
    try { await loadBox("merchant"); } catch(e){ $("edcRankInfo").textContent = "Gagal memuat data merchant: " + e.message; return; }
    if (TAB !== "edc") return;
  }
  const m = BOX.merchant, L = m.labels.length, iY = L-3, iP = L-4, y = m.year, w = m.week;
  const idxArea = []; for (let i=0;i<m.n;i++) if (inArea(m.a[i])) idxArea.push(i);
  const cab = cabOptions($("edcRankCab"), idxArea.map(i => m.c[i]));
  const idx = cab ? idxArea.filter(i => m.c[i] === cab) : idxArea;
  const nmCol = {k:"nm", l:"Merchant", h:(x,v)=>`<span class="nm-cut" title="${esc(v)}${cab?"":" · "+esc(x.cb)}">${esc(v)}</span>`};
  for (const [k, fmt] of [["sv",fC],["tx",fN],["md",fC]]){
    const cur = i => mv(m,k,iY,i)||0, prev = i => mv(m,k,iP,i)||0;
    const rowOf = (i,n) => ({rk:n+1, nm:m.nm[i]||"–", mid:m.mid[i]||"", cb:m.c[i]+" - "+bn(m.c[i]), cur:cur(i), prev:prev(i), d:cur(i)-prev(i), g:gr(cur(i),prev(i))});
    const top = idx.filter(i => cur(i) > 0).sort((a,b) => cur(b) - cur(a)).slice(0,20).map(rowOf);
    const drop = idx.filter(i => prev(i) > 0 && cur(i) < prev(i)).sort((a,b) => (cur(a)-prev(a)) - (cur(b)-prev(b))).slice(0,20).map(rowOf);
    const mk = (el, rows, cols, csv) => { el._st = null; table(el, {rows, cols, page:20, search:false, full:true, csv, rowKey:x=>x.mid, onRow:mid => openInSearch("edc","mid",mid)}); };
    mk($(`tTop_${k}`), top, [{k:"rk",l:"#",num:1}, nmCol, {k:"cur",l:`${y}`,num:1,f:fmt}, {k:"g",l:"YoY",num:1,h:(x,v)=>growthTag(v)}], `top20_${k}_${cab||"semua"}`);
    mk($(`tDrop_${k}`), drop, [{k:"rk",l:"#",num:1}, nmCol, {k:"d",l:"Turun",num:1,h:(x,v)=>`<span class="down">${fmt(v)}</span>`}, {k:"g",l:"%",num:1,h:(x,v)=>growthTag(v)}], `drop20_${k}_${cab||"semua"}`);
  }
  host.hidden = false;
  $("edcRankInfo").textContent = `${fN(idx.length)} MID${cab?` di ${bn(cab)}`:""}. YTD minggu ke-${w} ${y} dibanding minggu yang sama ${y-1}. Drop = penurunan terbesar. Klik baris untuk performance lengkap.`;
}
async function renderLvmUsak(){
  const host = $("lvmUsakInfo");
  if (!BOX.lvm){
    host.textContent = "Menyiapkan data Livin' Merchant (sekitar 12 MB)…";
    try { await loadBox("lvm"); } catch(e){ host.textContent = "Gagal memuat data: " + e.message; return; }
    if (TAB !== "lvm") return;
  }
  const m = BOX.lvm, kelas = $("lvmKelas").value;
  const idxArea = []; for (let i=0;i<m.n;i++) if (m.u[i] && inArea(cv(m.a,i)) && (!kelas || (KELAS[m.c[i]]||"Lainnya")===kelas)) idxArea.push(i);
  const cab = cabOptions($("lvmUsakCab"), idxArea.map(i => m.c[i]));
  const idx = cab ? idxArea.filter(i => m.c[i] === cab) : idxArea;
  const rowOf = i => ({i, nm:m.nm[i]||"–", mid:m.mid[i]||"", cb:m.c[i]+" - "+bn(m.c[i]), g:cv(m.g,i), sv:m.svy[i], fq:m.fqy[i], fb:m.fby[i]});
  const cols = [{k:"rk",l:"#",num:1}, {k:"nm",l:"Merchant"}, {k:"mid",l:"MID"}].concat(cab ? [] : [{k:"cb",l:"Cabang"}]).concat([
    {k:"g",l:"Grading"}, {k:"sv",l:"SV YTD",num:1,f:fC}, {k:"fq",l:"Frek YTD",num:1,f:fN}, {k:"fb",l:"FBI YTD",num:1,f:fC}]);
  const mk = (el, key, csv) => { el._st = null;
    const rows = [...idx].sort((a,b) => (key==="sv" ? m.svy[b]-m.svy[a] : m.fqy[b]-m.fqy[a])).slice(0,20).map((i,n) => ({...rowOf(i), rk:n+1}));
    table(el, {rows, cols, page:20, search:false, full:true, csv, rowKey:x=>x.mid, onRow:mid => openInSearch("lvm","mid",mid)}); };
  mk($("tLvmUsakSv"), "sv", `top_usak_sv_${cab||"semua"}`);
  mk($("tLvmUsakFq"), "fq", `top_usak_frek_${cab||"semua"}`);
  host.textContent = `${fN(idx.length)} merchant USAK${cab?` di ${bn(cab)}`:""}, posisi ${m.asof.split("-").reverse().join("-")}. Klik baris untuk melihat performance lengkap.`;
}

/* ================================================================== LVM */
function lvmFilter(kelas){
  const L = D.lvm;
  const ok = c => inArea(BAREA[c]) && (!kelas || (KELAS[c]||"Lainnya")===kelas);
  const rows = L.cube.filter(r => inArea(r[0]) && (!kelas || (KELAS[r[1]]||"Lainnya")===kelas));
  const codes = Object.keys(D.targets).filter(ok);
  return {rows, codes, ok};
}
function lvmAgg(rows){
  const NEW = ["New Akuisisi YTD","New Akuisisi MTD"];
  return { n:sum(rows,r=>r[4]), act:sum(rows,r=>r[5]), usak:sum(rows,r=>r[6]), cls:sum(rows,r=>r[7]),
    svm:sum(rows,r=>r[9]), fbm:sum(rows,r=>r[10]), svy:sum(rows,r=>r[12]), fby:sum(rows,r=>r[13]), bal:sum(rows,r=>r[14]),
    akY:sum(rows.filter(r=>NEW.includes(r[3])),r=>r[4]), akM:sum(rows.filter(r=>r[3]==="New Akuisisi MTD"),r=>r[4]) };
}
function lvmSummary(area){
  const rows = D.lvm.cube.filter(r => !area || r[0]===area);
  const codes = Object.keys(D.targets).filter(c => !area || D.targets[c].area===area);
  return {...lvmAgg(rows), tgt:tgtFor(codes)};
}
function renderLVM(){
  const L = D.lvm, kelas = $("lvmKelas").value, f = lvmFilter(kelas), a = lvmAgg(f.rows), t = tgtFor(f.codes);
  const {y,m,d} = lvmDate(), asof = `${d} ${BLN[m-1]} ${y}`;
  $("lvmKpis").innerHTML =
    kpi("Merchant terdaftar", fN(a.n), `${fN(a.act)} aktif bertransaksi (${fP(a.n?a.act/a.n:0)})`) +
    kpi("Akuisisi YTD", fN(a.akY), `${pctHtml(t.akYtd?a.akY/t.akYtd:null)} dari target s.d. ${asof} (${fN(t.akYtd)}) <br>Target setahun ${fN(t.akFy)}`, "", t.akFy?a.akY/t.akFy:null) +
    kpi(`Akuisisi MTD ${BLN[m-1]}`, fN(a.akM), `${pctHtml(t.akMtdP?a.akM/t.akMtdP:null)} dari target s.d. ${asof} (${fN(t.akMtdP)}) <br>Target sebulan ${fN(t.akMtd)}`, "", t.akMtd?a.akM/t.akMtd:null) +
    kpi("Merchant USAK", fN(a.usak), `${pctHtml(t.usak?a.usak/t.usak:null)} dari target ${fN(t.usak)}`, "", t.usak?a.usak/t.usak:null) +
    kpi(`Sales volume YTD`, fRp(a.svy), `MTD ${BLN[m-1]}: ${fRp(a.svm)}`) +
    kpi(`Fee based income YTD`, fRp(a.fby), `MTD ${BLN[m-1]}: ${fRp(a.fbm)}`) +
    kpi("Avg balance tabungan", fRp(a.bal), `${fN(a.cls)} rekening merchant closed`);

  const acq = L.acq.filter(r => f.ok(r[0]) || (!D.targets[r[0]] && inArea(BAREA[r[0]]) && !kelas));
  const byM = yr => Array.from({length:12},(_,i)=> sum(acq.filter(r=>r[1]===yr && r[2]===i+1), r=>r[3]));
  const cur = byM(y).map((v,i)=> i<m ? v : null);
  chart("cLvmAcq", {labels:BLN, fmt:fN, series:[S_(String(y-1), byM(y-1), C.prev), S_(String(y), cur, C.s1),
      S_("Target bulanan", Array(12).fill(t.akMtd), C.s2, {type:"line", dash:1, flat:1})]});

  const grades = ["USAK OPTIMAL","USAK IDEAL","USAK","UREG > 0","UREG = 0"];
  chart("cLvmGrade", {labels:grades, fmt:fC, horizontal:true, series:[S_("Merchant", grades.map(g=>sum(f.rows.filter(r=>r[2]===g),r=>r[4])), [C.seq[0],C.seq[2],C.seq[3],C.seq[4],C.seq[5]])]});

  // ranking cabang
  const byC = {};
  for (const r of f.rows) (byC[r[1]] || (byC[r[1]] = [])).push(r);
  const codes = [...new Set([...f.codes, ...Object.keys(byC)])];
  const rows = codes.map(c => { const g = lvmAgg(byC[c]||[]), tt = tgtFor([c]);
    return {c, nm:bn(c), a:BAREA[c]||"", k:KELAS[c]||"-", akM:g.akM, tM:tt.akMtdP, tMf:tt.akMtd, akY:g.akY, tY:tt.akYtd, usak:g.usak, tU:tt.usak, n:g.n, act:g.act, svy:g.svy,
            pM:tt.akMtdP?g.akM/tt.akMtdP:null, pY:tt.akYtd?g.akY/tt.akYtd:null, pU:tt.usak?g.usak/tt.usak:null}; });
  table($("tLvmRank"), {csv:"ranking_cabang_lvm", sort:"pY", rows, cols:[
    {k:"rk",l:"#",num:1,v:()=>0,h:(x,v,i)=>i+1}, {k:"c",l:"Kode"}, {k:"nm",l:"Cabang"}, {k:"a",l:"Area",f:title}, {k:"k",l:"Kelas"},
    {k:"akM",l:"Akuisisi MTD",num:1,f:fN}, {k:"tM",l:`Target s.d. ${d} ${BLN[m-1]}`,num:1,f:fN}, {k:"pM",l:"% MTD",num:1,f:pctHtml},
    {k:"akY",l:"Akuisisi YTD",num:1,f:fN}, {k:"tY",l:"Target YTD",num:1,f:fN}, {k:"pY",l:"% YTD",num:1,f:pctHtml},
    {k:"usak",l:"USAK",num:1,f:fN}, {k:"tU",l:"Target USAK",num:1,f:fN}, {k:"pU",l:"% USAK",num:1,f:pctHtml},
    {k:"n",l:"Merchant",num:1,f:fN}, {k:"svy",l:"SV YTD",num:1,f:fC}],
    foot: r => { const s = k => sum(r,x=>x[k]); return ["","Total","","","", fN(s("akM")), fN(s("tM")), pctHtml(s("tM")?s("akM")/s("tM"):null), fN(s("akY")), fN(s("tY")), pctHtml(s("tY")?s("akY")/s("tY"):null), fN(s("usak")), fN(s("tU")), pctHtml(s("tU")?s("usak")/s("tU"):null), fN(s("n")), fC(s("svy"))]; }});

  const lobs = {};
  for (const r of L.lob) if (inArea(r[0])) { const o = lobs[r[1]] || (lobs[r[1]] = {l:r[1], n:0, act:0, usak:0, sv:0}); o.n+=r[2]; o.act+=r[3]; o.usak+=r[4]; o.sv+=r[5]; }
  renderLvmUsak();
  table($("tLvmLob"), {csv:"lob_lvm", sort:"sv", page:12, rows:Object.values(lobs), cols:[
    {k:"l",l:"Kategori"}, {k:"n",l:"Merchant",num:1,f:fN}, {k:"act",l:"Aktif",num:1,f:fN}, {k:"usak",l:"USAK",num:1,f:fN}, {k:"sv",l:"SV YTD",num:1,f:fC}]});

  table($("tLvmTop"), {csv:"top_merchant_lvm", sort:"sv", page:12, rows:L.top.filter(x=>inArea(x.a) && (!kelas || (KELAS[x.c]||"Lainnya")===kelas)), cols:[
    {k:"nm",l:"Merchant"}, {k:"cb",l:"Cabang",v:x=>bn(x.c)}, {k:"g",l:"Grading"}, {k:"sv",l:"SV YTD",num:1,f:fC}, {k:"fb",l:"FBI YTD",num:1,f:fC}]});
}

/* ================================================================== SCORECARD */
function renderCabang(){
  const A = D.atm, E = D.edc, EI = Object.fromEntries(E.cols.map((c,i)=>[c,i])), n = A.last+1;
  const R = {};
  const g = c => R[c] || (R[c] = {c, nm:bn(c), a:BAREA[c]||"", k:KELAS[c]||"-", atm:0, af:0, at:0, sv:0, svp:0, md:0, ak:0, usak:0});
  for (const m of A.machines) if (inArea(m.a)) { const o = g(m.c); o.atm++; o.af += mYtd(m,"f"); o.at += mYtd(m,"t"); }
  for (const r of E.cube) if (inArea(r[0])) { const o = g(r[1]); o.sv += r[EI.sv]; o.svp += r[EI.svp]; o.md += r[EI.md]; }
  for (const r of D.lvm.cube) if (inArea(r[0])) { const o = g(r[1]); if (r[3].startsWith("New Akuisisi")) o.ak += r[4]; o.usak += r[6]; }
  const rows = Object.values(R).filter(o => o.c && inArea(o.a)).map(o => { const t = tgtFor([o.c]);
    return {...o, pAk: t.akYtd ? o.ak/t.akYtd : null, pU: t.usak ? o.usak/t.usak : null, gSv: gr(o.sv,o.svp)}; });
  const gh = (x,v) => v==null?"–":`<span class="${v>=0?"up":"down"}">${fP(v)}</span>`;
  table($("tCabang"), {csv:"scorecard_cabang", sort:"md", page:30, rows, cols:[
    {k:"c",l:"Kode"}, {k:"nm",l:"Cabang"}, {k:"a",l:"Area",f:title}, {k:"k",l:"Kelas"},
    {k:"atm",l:"ATM/CRM",num:1,f:fN}, {k:"at",l:`Trx ATM YTD ${BLN[A.last]}`,num:1,f:fC}, {k:"af",l:"FBI ATM YTD",num:1,f:fC},
    {k:"sv",l:`SV EDC YTD W${E.week}`,num:1,f:fC}, {k:"gSv",l:"Growth SV",num:1,h:gh}, {k:"md",l:"MDFG EDC",num:1,f:fC},
    {k:"ak",l:"Akuisisi LVM YTD",num:1,f:fN}, {k:"pAk",l:"% Target",num:1,f:pctHtml}, {k:"usak",l:"USAK",num:1,f:fN}, {k:"pU",l:"% USAK",num:1,f:pctHtml}],
    foot: r => { const s=k=>sum(r,x=>x[k]); return ["","Total","","", fN(s("atm")), fC(s("at")), fC(s("af")), fC(s("sv")), gh(0,gr(s("sv"),s("svp"))), fC(s("md")), fN(s("ak")), "", fN(s("usak")), ""]; }});
}

/* ================================================================== CARI MERCHANT */
const MS_MODES = {
  edc:{label:"e-Channel", box:"merchant",
       fields:[["nm","Nama merchant"],["on","Official name"],["mid","MID"],["rek","No. rekening"]]},
  lvm:{label:"Livin' Merchant", box:"lvm", fields:[["nm","Nama merchant"],["mid","MID"],["rek","No. rekening"]]},
  atm:{label:"ATM", box:null, fields:[["id","ID mesin"],["nm","Nama lokasi"]]},
};
const MS = {mode:"edc", sel:null, page:0};
const MS_PER = 10;
const digits = v => String(v||"").replace(/\D/g,"");
const cv = (o,i) => o.k[o.v[i]];                        // nilai kategori (data LVM)
const gtag = v => v==null ? "–" : `<span class="${v>=0?"up":"down"}">${v>=0?"▲":"▼"} ${fP(Math.abs(v))}</span>`;
const fieldHtml = (k,v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
function msModes(){
  if (USER.lim && MS.mode === "atm") MS.mode = "edc";
  $("msModes").innerHTML = Object.entries(MS_MODES).filter(([k]) => !(USER.lim && k === "atm")).map(([k,c]) => `<button data-m="${k}" class="${k===MS.mode?"on":""}">${c.label}</button>`).join("");
  $("msModes").querySelectorAll("button").forEach(b => b.onclick = () => {
    if (MS.mode === b.dataset.m) return;
    MS.mode = b.dataset.m; MS.sel = null; MS.page = 0; $("msQ").value = "";
    msModes(); renderMerchant(); $("msQ").focus(); });
  const f = $("msField"), cur = f.value;
  f.innerHTML = MS_MODES[MS.mode].fields.map(([k,l]) => `<option value="${k}">${l}</option>`).join("");
  if (MS_MODES[MS.mode].fields.some(x=>x[0]===cur)) f.value = cur;
}
async function renderMerchant(){
  msModes();
  const cfg = MS_MODES[MS.mode];
  if (cfg.box && !BOX[cfg.box]){
    $("msResults").innerHTML = ""; $("msDetail").innerHTML = "";
    $("msInfo").textContent = `Menyiapkan data ${cfg.label}…`;
    try { await loadBox(cfg.box); }
    catch(e){ $("msInfo").textContent = "Gagal memuat data: " + e.message; return; }
  }
  $("msInfo").textContent = "";
  msSearch();
}
function msSource(){
  const mode = MS.mode, f = $("msField").value;
  if (mode === "atm") {
    const ms = D.atm.machines;
    return {n:ms.length, area:i=>ms[i].a, text:i => f==="id" ? ms[i].id.toLowerCase() : ms[i].nm.toLowerCase(), num:false,
            score:i => sum(ms[i].f), total:D.atm.machines.length};
  }
  const m = BOX[MS_MODES[mode].box]; m._lc = m._lc || {};
  const isNum = f==="mid" || f==="rek";
  if (!isNum && !m._lc[f]) m._lc[f] = m[f].map(x => (x||"").toLowerCase());
  if (mode === "edc"){
    const iY = m.labels.length-3;
    return {n:m.n, area:i=>m.a[i], text: isNum ? i=>m[f][i] : i=>m._lc[f][i], num:isNum, score:i => mv(m,"sv",iY,i)||0};
  }
  return {n:m.n, area:i=>cv(m.a,i), text: f==="mid" ? i=>m.mid[i]+" "+m.mid2[i] : isNum ? i=>m[f][i] : i=>m._lc[f][i], num:isNum, score:i=>m.svy[i]};
}
function msSearch(){
  const mode = MS.mode, f = $("msField").value, src = msSource();
  const raw = $("msQ").value.trim(), q = src.num ? digits(raw) : raw.toLowerCase();
  const what = {edc:"MID merchant EDC & e-commerce", lvm:"merchant Livin'", atm:"mesin ATM & CRM"}[mode];
  if (q.length < (mode==="atm" ? 2 : 3)){
    $("msResults").innerHTML = `<p class="note">Ketik minimal ${mode==="atm"?2:3} karakter untuk mencari di antara ${fN(src.n)} ${what}${AREA?` di ${title(AREA)}`:""}.</p>`;
    if (!MS.sel) $("msDetail").innerHTML = "";
    return;
  }
  let hits = [];
  for (let i=0;i<src.n;i++){ if (!inArea(src.area(i))) continue; const t = src.text(i); if (t && t.includes(q)) hits.push(i); }
  hits.sort((x,y) => src.score(y) - src.score(x));
  let items, cols;
  const m = mode==="atm" ? null : BOX[MS_MODES[mode].box];
  if (mode==="edc" && f==="on"){            // grup per official name
    const g = new Map();
    for (const i of hits){ const k = (m.on[i]||"").toUpperCase(); if (!g.has(k)) g.set(k, []); g.get(k).push(i); }
    items = [...g.entries()].map(([k,idx]) => ({kind:"grp", key:k, idx, sv:sum(idx, i=>src.score(i))})).sort((a,b)=>b.sv-a.sv);
    cols = [["Official name", x=>esc(m.on[x.idx[0]])], ["Jumlah MID", x=>fN(x.idx.length), 1],
            ["Cabang pengelola", x=>{ const cs=[...new Set(x.idx.map(i=>m.c[i]))]; return cs.length>1 ? `${cs.length} cabang` : esc(cs[0]+" - "+bn(cs[0])); }],
            ["Alamat", x=>{ const a = [...new Set(x.idx.map(i=>m.al?m.al[i]:"").filter(Boolean))]; return `<span class="addr" title="${esc(a.join(" | "))}">${esc(a[0]||"–")}${a.length>1?` <small>+${a.length-1}</small>`:""}</span>`; }],
            ["SV YTD W"+m.week, x=>fC(x.sv), 1]];
  } else if (mode==="edc"){
    items = hits.map(i => ({kind:"edc", i}));
    cols = [["Nama merchant", x=>esc(m.nm[x.i]||"–")], ["MID", x=>m.mid[x.i]||"–"], ["Official name", x=>esc(m.on[x.i]||"–")],
            ["Cabang pengelola", x=>esc(m.c[x.i]+" - "+bn(m.c[x.i]))], ["Alamat", x=>`<span class="addr" title="${esc(m.al?m.al[x.i]:"")}">${esc(m.al?m.al[x.i]:""||"–")}</span>`], ["SV YTD W"+m.week, x=>fC(src.score(x.i)), 1]];
  } else if (mode==="lvm"){
    items = hits.map(i => ({kind:"lvm", i}));
    cols = [["Nama merchant", x=>esc(m.nm[x.i]||"–")], ["MID", x=>m.mid[x.i]||"–"], ["Cabang pengelola", x=>esc(m.c[x.i]+" - "+bn(m.c[x.i]))],
            ["Grading", x=>esc(cv(m.g,x.i))], ["Alamat", x=>`<span class="addr" title="${esc(m.al?m.al[x.i]:"")}">${esc(m.al?m.al[x.i]:""||"–")}</span>`], ["SV YTD", x=>fC(m.svy[x.i]), 1]];
  } else {
    const ms = D.atm.machines;
    items = hits.map(i => ({kind:"atm", i}));
    cols = [["ID mesin", x=>esc(ms[x.i].id)], ["Nama lokasi", x=>esc(ms[x.i].nm)], ["Jenis", x=>`<span class="pill">${ms[x.i].j}</span>`],
            ["Cabang pengelola", x=>esc(ms[x.i].c+" - "+bn(ms[x.i].c))], ["Alamat", x=>`<span class="addr" title="${esc(ms[x.i].al)}">${esc(ms[x.i].al||"–")}</span>`], ["FBI YTD", x=>fC(sum(ms[x.i].f)), 1]];
  }
  const key = x => x.kind==="grp" ? "g:"+x.key : x.kind+":"+x.i;
  const pages = Math.max(1, Math.ceil(items.length/MS_PER)); MS.page = Math.min(MS.page, pages-1);
  const shown = items.slice(MS.page*MS_PER, MS.page*MS_PER+MS_PER);
  const unit = mode==="edc" && f==="on" ? "official name" : "hasil";
  $("msResults").innerHTML = !items.length ? `<p class="note">Tidak ada yang cocok. Periksa ejaan, atau ganti jenis pencarian di sebelah kiri kolom.</p>` :
    `<p class="note">${fN(items.length)} ${unit}${mode==="edc"&&f==="on"?` (${fN(hits.length)} MID)`:""}, diurutkan dari ${mode==="atm"?"FBI":"sales volume"} terbesar. Klik baris untuk melihat performance lengkap.</p>
    <div class="tbl-wrap full"><table class="ms-list"><thead><tr>${cols.map(c=>`<th class="${c[2]?"num":""}">${c[0]}</th>`).join("")}</tr></thead>
    <tbody>${shown.map((x,n)=>`<tr data-n="${MS.page*MS_PER+n}" class="${MS.sel && key(MS.sel)===key(x)?"on":""}">${cols.map(c=>`<td class="${c[2]?"num":""}">${c[1](x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    ${pages>1?`<div class="pager"><button data-mp="-1" ${MS.page?"":"disabled"}>‹</button> Hal ${MS.page+1} / ${fN(pages)} <button data-mp="1" ${MS.page<pages-1?"":"disabled"}>›</button></div>`:""}`;
  $("msResults").querySelectorAll("[data-mp]").forEach(b => b.onclick = () => { MS.page += +b.dataset.mp; msSearch(); });
  $("msResults").querySelectorAll("tr[data-n]").forEach(tr => tr.onclick = () => {
    MS.sel = items[+tr.dataset.n]; msSearch(); $("msDetail").scrollIntoView({behavior:"smooth", block:"start"}); });
  if (items.length === 1 && (!MS.sel || key(MS.sel)!==key(items[0]))) MS.sel = items[0];
  if (MS.sel && MS.sel.kind !== {edc:(f==="on"?"grp":"edc"), lvm:"lvm", atm:"atm"}[mode] && !(mode==="edc" && MS.sel.kind==="edc")) MS.sel = null;
  msShow();
}
function msShow(){
  const x = MS.sel; if (!x) { $("msDetail").innerHTML = ""; return; }
  if (x.kind === "edc") edcDetail([x.i], null);
  else if (x.kind === "grp") edcDetail(x.idx, x.key);
  else if (x.kind === "lvm") lvmDetail(x.i);
  else atmDetail(D.atm.machines[x.i]);
}

/* ---- EDC & e-commerce: satu MID, atau grup official name ---- */
const mv = (m,k,j,i) => (m[k][j] ? m[k][j][i] : null);
function mdrList(m, idx){
  const a = [...new Set(idx.map(i=>m.mc[i]).filter(v=>v!=null))], b = [...new Set(idx.map(i=>m.mq[i]).filter(v=>v!=null))];
  const f = arr => arr.length ? arr.sort((x,y)=>x-y).map(v=>String(v).replace(".",",")+"%").join(" / ") : null;
  const p = []; if (f(a)) p.push(`Off-us kartu kredit ${f(a)}`); if (f(b)) p.push(`QRIS off-us ${f(b)}`);
  return p.join("; ") || "–";
}
function listText(arr, fmt=v=>v){
  const u = [...new Set(arr.filter(Boolean))];
  if (!u.length) return "–";
  return u.slice(0,3).map(v=>esc(fmt(v))).join("<br>") + (u.length>3 ? `<small>dan ${u.length-3} lainnya</small>` : "");
}
function edcDetail(idx, groupKey){
  const m = BOX.merchant, L = m.labels.length, iY = L-3, iP = L-4, iW = L-1, iW1 = L-2, w = m.week, y = m.year;
  const single = idx.length === 1 && !groupKey, i0 = idx[0];
  // jumlahkan per label; avg funding dihitung sekali per rekening
  const tot = {};
  for (const k of ["sv","tx","md","fd"]) tot[k] = m.labels.map((_,j) => {
    if (!m[k][j]) return null;
    if (k !== "fd") return sum(idx, i => m[k][j][i]);
    const seen = new Set(); let s = 0;
    for (const i of idx){ const r = m.rek[i]; if (r && seen.has(r)) continue; if (r) seen.add(r); s += m[k][j][i]; }
    return s; });
  const val = (k,j) => tot[k][j];
  const wk = (k,fmt) => `W${w}: ${fmt(val(k,iW)||0)} ${grHtml(val(k,iW)||0, val(k,iW1)||0, `vs W${w-1}`)}`;
  const areasTxt = [...new Set(idx.map(i=>m.a[i]))].map(title).join(", ");
  const head = single
    ? `<h2>${esc(m.nm[i0]||"–")}</h2><span class="pill">${esc(areasTxt)}</span>`
    : `<h2>${esc(m.on[i0]||groupKey)}</h2><span class="pill">${fN(idx.length)} MID</span><span class="pill">${esc(areasTxt)}</span>`;
  const fields = single ? [
      ["Nama merchant", esc(m.nm[i0]||"–")], ["MID", m.mid[i0]||"–"], ["Official name", esc(m.on[i0]||"–")],
      ["Cabang pengelola", esc(m.c[i0]+" - "+bn(m.c[i0]))], ["Segment", esc(m.s[i0]||"–")],
      ["LOB", esc(m.l[i0]||"–") + (m.l5[i0] && m.l5[i0]!=="Lainnya" ? `<small>LOB fokus: ${esc(m.l5[i0])}</small>` : "")],
      ["MDR", mdrList(m,[i0])], ["No. rekening", m.rek[i0]||"–"], ["Jumlah EDC", fN(m.edc[i0])], ["Alamat", esc((m.al&&m.al[i0])||"–")]]
    : [
      ["Official name", esc(m.on[i0]||"–")], ["Jumlah MID", fN(idx.length)],
      ["Jumlah nama merchant", fN(new Set(idx.map(i=>m.nm[i])).size)],
      ["Cabang pengelola", listText(idx.map(i=>m.c[i]), c=>c+" - "+bn(c))], ["Segment", listText(idx.map(i=>m.s[i]))],
      ["LOB", listText(idx.map(i=>m.l[i]))], ["MDR", mdrList(m,idx)], ["Alamat", m.al ? listText(idx.map(i=>m.al[i])) : "–"],
      ["No. rekening", `${fN(new Set(idx.map(i=>m.rek[i]).filter(Boolean)).size)} rekening`], ["Jumlah EDC", fN(sum(idx,i=>m.edc[i]))]];
  const members = single ? "" : `<div class="panel"><div class="panel-head"><h3>Merchant dalam official name ini</h3><p>Klik baris untuk melihat performance per MID</p></div><div id="msMembers"></div></div>`;
  $("msDetail").innerHTML = `
    <div class="panel ms-head"><div class="ms-title">${head}</div><dl class="ms-fields">${fields.map(f=>fieldHtml(f[0],f[1])).join("")}</dl></div>
    <div class="kpis">
      ${kpi(`Sales volume YTD W${w} ${y}`, fRp(val("sv",iY)||0), grHtml(val("sv",iY)||0, val("sv",iP)||0, `dibanding ${y-1}`) + "<br>" + wk("sv",fRp))}
      ${kpi(`Frekuensi YTD W${w} ${y}`, fN(val("tx",iY)||0), grHtml(val("tx",iY)||0, val("tx",iP)||0, `dibanding ${y-1}`) + "<br>" + wk("tx",fN))}
      ${kpi(`MDFG YTD W${w} ${y}`, fRp(val("md",iY)||0), grHtml(val("md",iY)||0, val("md",iP)||0, `dibanding ${y-1}`) + "<br>" + wk("md",fRp))}
      ${kpi(`Avg funding W${w} ${y}`, fRp(val("fd",iY)||0), grHtml(val("fd",iY)||0, val("fd",iP)||0, `dibanding W${w} ${y-1}`) + (single?"":"<br>dihitung sekali per rekening"))}
    </div>
    <div class="grid g2">
      ${[["sv","Sales volume (SV)"],["tx","Frekuensi transaksi"],["md","MDFG"],["fd","Avg funding"]].map(([k,t]) =>
        `<div class="panel"><div class="panel-head"><h3>${t}</h3><p>Full year per tahun, lalu YTD minggu ${w} ${y-1} dan ${y}</p></div><div class="chart sm"><div id="msc_${k}" class="mc"></div></div></div>`).join("")}
    </div>${members}`;
  const labs = m.labels.slice(0, L-2).map(l => l.replace(`YTD W${w} `, "YTD "));
  const colr = labs.map((_,j) => j === L-3 ? C.s2 : j === L-4 ? C.prev : "#f5b49a");
  for (const k of ["sv","tx","md","fd"])
    drawChart($("msc_"+k), {labels:labs, fmt:k==="tx"?fN:fC, series:[S_({sv:"Sales volume",tx:"Frekuensi",md:"MDFG",fd:"Avg funding"}[k], labs.map((_,j)=>val(k,j)), colr)]});
  if (!single){
    table($("msMembers"), {sort:"sv", page:15, full:true, search:idx.length>15, csv:"merchant_"+(m.on[i0]||"grup").slice(0,30), rows:idx.map(i=>({i, nm:m.nm[i], mid:m.mid[i], c:m.c[i], s:m.s[i], sv:mv(m,"sv",iY,i)||0, svp:mv(m,"sv",iP,i)||0, md:mv(m,"md",iY,i)||0})), cols:[
      {k:"nm",l:"Nama merchant"}, {k:"mid",l:"MID"}, {k:"cb",l:"Cabang pengelola",v:x=>x.c+" - "+bn(x.c)}, {k:"s",l:"Segment"},
      {k:"svp",l:`SV YTD ${y-1}`,num:1,f:fC}, {k:"sv",l:`SV YTD ${y}`,num:1,f:fC}, {k:"g",l:"Growth",num:1,v:x=>gr(x.sv,x.svp),h:(x,v)=>gtag(v)}, {k:"md",l:"MDFG YTD",num:1,f:fC}]});
    $("msMembers").addEventListener("click", e => { const tr = e.target.closest("tbody tr"); if (!tr) return;
      const mid = tr.children[1].textContent, i = idx.find(i => m.mid[i]===mid); if (i==null) return;
      MS.sel = {kind:"edc", i}; msShow(); $("msDetail").scrollIntoView({behavior:"smooth", block:"start"}); });
  }
}

/* ---- Livin' Merchant ---- */
function lvmDetail(i){
  const m = BOX.lvm, [y,mo,d] = m.asof.split("-").map(Number);
  const prevM = BLN[(mo+10)%12] + " " + (mo===1?y-1:y), curM = `${BLN[mo-1]} ${y}`, lyM = `${BLN[mo-1]} ${y-1}`;
  const pct = (g, now) => (now-g) ? g/(now-g) : null;
  const fields = [
    ["Nama merchant", esc(m.nm[i]||"–")], ["MID static", m.mid[i]||"–"], ["MID dynamic", m.mid2[i]||"–"], ["No. rekening", m.rek[i]||"–"],
    ["Cabang pengelola", esc(m.c[i]+" - "+bn(m.c[i]))], ["LOB", esc(cv(m.lob,i))], ["Alamat", esc((m.al && m.al[i]) || "–")],
    ["Kecamatan", m.kec ? esc(cv(m.kec,i)) : "–"], ["Kabupaten/kota", esc(cv(m.kab,i))],
    ["Tanggal registrasi", m.d[i] ? m.d[i].split("-").reverse().join("-") : "–"], ["Jenis usaha", esc(cv(m.ct,i))], ["Tipe akun", esc(cv(m.ta,i))],
    ["Status transaksi", esc(cv(m.st,i))], ["Grading", esc(cv(m.g,i))], ["USAK", m.u[i] ? "Ya" : "Tidak"],
    ["Status rekening", esc(cv(m.sr,i))], ["Card dongle", esc(cv(m.dg,i))], ["Tagging akuisisi", esc(cv(m.tg,i))]];
  const dongle = m.dsvy[i] || m.dfqy[i];
  $("msDetail").innerHTML = `
    <div class="panel ms-head"><div class="ms-title"><h2>${esc(m.nm[i]||"–")}</h2><span class="pill">${esc(title(cv(m.a,i)))}</span><span class="pill">${esc(cv(m.g,i))}</span></div>
      <dl class="ms-fields">${fields.map(f=>fieldHtml(f[0],f[1])).join("")}</dl></div>
    <div class="kpis">
      ${kpi("Frekuensi YTD", fN(m.fqy[i]), `MTD ${BLN[mo-1]}: ${fN(m.fqm[i])}` + (dongle?`<br>Card dongle YTD: ${fN(m.dfqy[i])}`:""))}
      ${kpi("Sales volume YTD", fRp(m.svy[i]), `MTD ${BLN[mo-1]}: ${fRp(m.svm[i])}` + (dongle?`<br>Card dongle YTD: ${fRp(m.dsvy[i])}`:""))}
      ${kpi("Fee based income YTD", fRp(m.fby[i]), `MTD ${BLN[mo-1]}: ${fRp(m.fbm[i])}` + (dongle?`<br>Card dongle YTD: ${fRp(m.dfby[i])}`:""))}
      ${kpi("Avg balance tabungan", fRp(m.bal[i]), `${gtag(pct(m.balm[i],m.bal[i]))} MoM<br>${gtag(pct(m.baly[i],m.bal[i]))} YoY`)}
      ${kpi("Avg balance CIF", fRp(m.cif[i]), `${gtag(pct(m.cifm[i],m.cif[i]))} MoM<br>${gtag(pct(m.cify[i],m.cif[i]))} YoY`)}
    </div>
    <div class="grid g2">
      <div class="panel"><div class="panel-head"><h3>Avg balance tabungan</h3><p>${lyM}, ${prevM}, dan ${curM}</p></div><div class="chart sm"><div id="msl_bal" class="mc"></div></div></div>
      <div class="panel"><div class="panel-head"><h3>Avg balance CIF</h3><p>${lyM}, ${prevM}, dan ${curM}</p></div><div class="chart sm"><div id="msl_cif" class="mc"></div></div></div>
    </div>`;
  const labs = [lyM, prevM, curM], cols = [C.prev, "#86d9b9", C.s3];
  drawChart($("msl_bal"), {labels:labs, fmt:fC, series:[S_("Avg balance tabungan", [m.bal[i]-m.baly[i], m.bal[i]-m.balm[i], m.bal[i]], cols)]});
  drawChart($("msl_cif"), {labels:labs, fmt:fC, series:[S_("Avg balance CIF", [m.cif[i]-m.cify[i], m.cif[i]-m.cifm[i], m.cif[i]], cols)]});
}

/* ---- ATM / CRM per ID mesin ---- */
function atmDetail(x, host="msDetail", pfx="msa_"){
  const A = D.atm, n = A.last+1, L = BLN[A.last];
  const k = (lbl, key, fmt) => kpi(`${lbl} YTD ${A.year}`, fmt(sum(x[key])), `${L}: ${fmt(x[key][n-1])} ${n>1?grHtml(x[key][n-1], x[key][n-2], "MoM"):""}`);
  const crm = x.j === "CRM";
  $(host).innerHTML = `
    <div class="panel ms-head"><div class="ms-title"><h2>${esc(x.nm)}</h2><span class="pill">${x.j}</span><span class="pill">${esc(title(x.a))}</span>${host!=="msDetail"?`<button class="btn-sm ms-close" data-close>Tutup</button>`:""}</div>
      <dl class="ms-fields">${[["ID mesin", esc(x.id)], ["Nama lokasi", esc(x.nm)], ["Jenis", x.j], ["Tipe mesin", esc(x.ms||"–")],
        ["Lokasi", esc(title(x.g))], ["Kota", esc(x.kt||"–")], ["Cabang pengelola", esc(x.c+" - "+bn(x.c))], ["Area", esc(title(x.a))],
        [crm?`Kuadran ${L}`:`Tier ${L}`, qChip(x.q)], ["Jenis lokasi", esc(title(x.jl||"–"))], ["Alamat", esc(x.al||"–")],
        ["Koordinat", x.ll ? `<a href="https://www.google.com/maps?q=${x.ll[0]},${x.ll[1]}" target="_blank" rel="noopener">${x.ll[0].toFixed(5)}, ${x.ll[1].toFixed(5)}</a>` : "–"]].map(f=>fieldHtml(f[0],f[1])).join("")}</dl></div>
    <div class="panel"><div class="panel-head"><h3>Series kuadran</h3><p>Posisi kuadran mesin ini setiap bulan, Januari–${L} ${A.year}</p></div>
      <div class="q-series">${(x.qs||[]).map((q,i)=>`<div><span>${BLN[i]}</span>${qChip(q)}</div>`).join("")}</div></div>
    <div class="kpis">${k("Transaksi","t",fN)}${k("Volume","v",fRp)}${k("Fee based income","f",fRp)}${crm ? k("Volume setor tunai","vs",fRp) + k("Transaksi setor tunai","ts",fN) : ""}</div>
    <div class="grid g2">
      ${[["t","Transaksi per bulan"],["v","Volume per bulan"],["f","Fee based income per bulan"]].concat(crm?[["vs","Volume setor tunai per bulan"]]:[]).map(([kk,t]) =>
        `<div class="panel"><div class="panel-head"><h3>${t}</h3><p>Januari–${L} ${A.year}</p></div><div class="chart sm"><div id="${pfx}${kk}" class="mc"></div></div></div>`).join("")}
    </div>`;
  for (const kk of ["t","v","f"].concat(crm?["vs"]:[]))
    drawChart($(pfx+kk), {labels:BLN.slice(0,n), fmt:kk==="t"?fN:fC, series:[S_("Nilai", x[kk], C.s1)]});
  const cl = $(host).querySelector("[data-close]"); if (cl) cl.onclick = () => { $(host).innerHTML = ""; if (MAP.sel) { MAP.sel = null; mapMarkers(); } };
}

/* ---- Kuadran: warna & series ---- */
const Q_STYLE = {A:["#dff3e6","#0c6a36"], B:["#e1edfb","#1d5fae"], C:["#e3f4f6","#127080"], D:["#fbe4e3","#b42a2a"], E:["#fdeeda","#a2560b"], F:["#eceef1","#5b6672"],
                 "Tier 1":["#dff3e6","#0c6a36"], "Tier 2":["#e1edfb","#1d5fae"], "Tier 3":["#fdf1d3","#8a5a00"], "Tier 4":["#fbe4e3","#b42a2a"]};
const Q_NAME = {A:"Best performance", B:"FBI driven", C:"Trx driven", D:"Non performing", E:"Under performing", F:"Kategori khusus",
                "Tier 1":"Tier 1, terbaik", "Tier 2":"Tier 2", "Tier 3":"Tier 3", "Tier 4":"Tier 4, terendah"};
function qChip(q){
  const st = Q_STYLE[q]; if (!st) return `<span class="qchip">${esc(q||"–")}</span>`;
  return `<span class="qchip" style="background:${st[0]};color:${st[1]}" title="${esc(Q_NAME[q]||q)}">${esc(q.replace("Tier ","T"))}</span>`;
}
const qStrip = qs => `<span class="qstrip">${(qs||[]).map((q,i)=>`<i style="background:${(Q_STYLE[q]||["#eceef1"])[0]};color:${(Q_STYLE[q]||[0,"#5b6672"])[1]}" title="${BLN[i]}: ${esc(q)}">${esc(String(q).replace("Tier ","").slice(0,1))}</i>`).join("")}</span>`;
function renderQSeries(ms, n){
  const jenis = [...new Set(ms.map(m => m.j))].filter(j => j==="CRM" || j==="ATM").sort((a,b) => a==="CRM" ? -1 : 1);
  const ORDER = ["A","B","C","D","E","F","Tier 1","Tier 2","Tier 3","Tier 4","-"];
  $("atmQSeries").innerHTML = jenis.map(j => {
    const g = ms.filter(m => m.j === j);
    const cats = ORDER.filter(q => g.some(m => (m.qs||[]).includes(q)));
    const cnt = (q,i) => g.filter(m => (m.qs||[])[i] === q).length;
    const head = `<tr><th>${j==="CRM"?"CRM":"ATM tunai"} (${fN(g.length)} mesin)</th>${BLN.slice(0,n).map(b=>`<th class="num">${b}</th>`).join("")}</tr>`;
    const body = cats.map(q => `<tr><td>${qChip(q)} <span class="qname">${esc(Q_NAME[q] || (q==="-"?"Tanpa kuadran":""))}</span></td>${
      Array.from({length:n},(_,i)=>{ const c = cnt(q,i), share = g.length ? c/g.length : 0;
        const al = Math.min(.85, share*1.15);
        return `<td class="num qcell" style="background:rgba(42,120,214,${al.toFixed(3)})${al>.5?";color:#fff":""}" title="${BLN[i]}: ${fN(c)} mesin (${fP(share)})">${c?fN(c):"·"}</td>`; }).join("")}</tr>`).join("");
    return `<div class="tbl-wrap full q-tbl"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }).join("") || `<p class="note">Tidak ada mesin untuk filter ini.</p>`;
}

/* ---- Peta ATM (Leaflet + OpenStreetMap, dimuat saat dibutuhkan) ---- */
const MAP = {L:null, map:null, layer:null, sel:null, loading:null, ms:[]};
function loadLeaflet(){
  if (window.L) return Promise.resolve(window.L);
  if (MAP.loading) return MAP.loading;
  MAP.loading = new Promise((ok, no) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css"; document.head.appendChild(css);
    const js = document.createElement("script"); js.src = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js";
    js.onload = () => ok(window.L); js.onerror = () => { MAP.loading = null; no(new Error("library peta tidak bisa dimuat")); };
    document.head.appendChild(js);
    setTimeout(() => { if (!window.L) { MAP.loading = null; no(new Error("waktu habis memuat library peta")); } }, 15000);
  });
  return MAP.loading;
}
async function renderAtmMap(ms){
  MAP.ms = ms;
  const box = $("atmMap"), note = $("atmMapNote");
  const withLL = ms.filter(m => m.ll);
  note.textContent = `${fN(withLL.length)} mesin di peta${withLL.length < ms.length ? `, ${fN(ms.length - withLL.length)} tanpa koordinat` : ""}. Klik titik untuk melihat performance lengkap.`;
  let L;
  try { L = await loadLeaflet(); }
  catch(e){ box.innerHTML = `<div class="map-fail">Peta tidak bisa ditampilkan: ${esc(e.message)}. Kemungkinan jaringan memblokir cdn.jsdelivr.net atau tile.openstreetmap.org.</div>`; return; }
  if (!MAP.map){
    box.innerHTML = "";
    MAP.map = L.map(box, {zoomControl:true, scrollWheelZoom:false, preferCanvas:true}).setView([-8.6, 117.5], 7);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'}).addTo(MAP.map);
    MAP.map.on("focus", () => MAP.map.scrollWheelZoom.enable());
    MAP.map.on("blur", () => MAP.map.scrollWheelZoom.disable());
  }
  setTimeout(() => MAP.map.invalidateSize(), 0);
  mapMarkers(true);
}
const PIN_CACHE = {};
function pinIcon(color, big){       // ikon lokasi (pin) berwarna sesuai jenis mesin
  const k = color + big; if (PIN_CACHE[k]) return PIN_CACHE[k];
  const w = big ? 34 : 24, h = Math.round(w * 1.33);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 24 32"><path d="M12 0.8C5.8 0.8 0.8 5.7 0.8 11.9c0 8.3 9.6 18.3 10.4 19.1a1.1 1.1 0 0 0 1.6 0c.8-.8 10.4-10.8 10.4-19.1C23.2 5.7 18.2.8 12 .8Z" fill="${color}" stroke="${big?"#0e2a47":"#fff"}" stroke-width="${big?2:1.6}"/><circle cx="12" cy="11.8" r="4.3" fill="#fff"/></svg>`;
  return PIN_CACHE[k] = window.L.divIcon({className:"atm-pin", html:svg, iconSize:[w,h], iconAnchor:[w/2,h-1], tooltipAnchor:[0,0]});
}
function mapMarkers(fit){
  const L = window.L; if (!L || !MAP.map) return;
  if (MAP.layer) MAP.layer.remove();
  MAP.layer = L.featureGroup();
  const n = D.atm.last + 1;
  for (const m of MAP.ms){
    if (!m.ll) continue;
    const on = MAP.sel === m.id;
    const mk = L.marker(m.ll, {icon:pinIcon(m.j==="CRM"?C.s2:C.s1, on), zIndexOffset:on?1000:0, riseOnHover:true, keyboard:false});
    mk.bindTooltip(`<b>${esc(m.nm)}</b><br>${esc(m.id)} · ${m.j} · kuadran ${esc(m.q)}<br>FBI YTD ${fRp(sum(m.f))}`, {direction:"top", offset:[0, on?-38:-28]});
    mk.on("click", () => { MAP.sel = m.id; mapMarkers(); atmDetail(m, "atmMapDetail", "mpa_"); $("atmMapDetail").scrollIntoView({behavior:"smooth", block:"start"}); });
    MAP.layer.addLayer(mk);
  }
  MAP.layer.addTo(MAP.map);
  if (fit && MAP.layer.getLayers().length) MAP.map.fitBounds(MAP.layer.getBounds(), {padding:[24,24], maxZoom:13});
}

/* ================================================================== KELOLA PENGGUNA (admin) */
let US_ROWS = [];
const avatarHtml = (foto, nama, cls="") => foto
  ? `<span class="avatar ${cls}" style="background-image:url(${foto})"></span>`
  : `<span class="avatar ${cls}"><span>${esc(String(nama||"?").trim().split(/\s+/).slice(0,2).map(w=>w[0]||"").join("").toUpperCase())}</span></span>`;
async function loadUsers(){
  US_ROWS = await sb("/rest/v1/profiles?select=id,username,nama,jabatan,unit_kerja,foto,status,role,akses,created_at&order=created_at.desc") || [];
  const pend = US_ROWS.filter(u => u.status === "menunggu").length;
  $("pendBadge").hidden = !pend; $("pendBadge").textContent = pend;
}
async function renderUsers(){
  if (USER.role !== "admin") { $("usList").innerHTML = `<p class="note">Menu ini hanya untuk admin.</p>`; return; }
  $("usList").innerHTML = `<p class="note">Memuat daftar pengguna…</p>`;
  try { await loadUsers(); } catch(e){ $("usList").innerHTML = `<p class="note">Gagal memuat: ${esc(e.message)}</p>`; return; }
  drawUsers();
}
const ROLE_OPTS = [["user","Pengguna"],["yokke","Marketing Yokke"],["outbranch","Outbranch"],["admin","Admin"]];
function drawUsers(){
  const st = $("usStatus").value, rows = US_ROWS.filter(u => !st || u.status === st);
  const opt = (vals, cur) => vals.map(([v,l]) => `<option value="${v}" ${v===cur?"selected":""}>${l}</option>`).join("");
  const AKS = [["REGION","Seluruh Region XI"], ...D.areas.map(a=>[a, title(a)])];
  $("usList").innerHTML = !rows.length ? `<p class="note">Tidak ada pengguna dengan status ini.</p>` :
    `<div class="tbl-wrap full"><table class="us-tbl"><thead><tr><th>Pegawai</th><th>Jabatan</th><th>Unit kerja</th><th>Username</th><th>Terdaftar</th><th>Status</th><th>Akses</th><th>Peran</th><th></th></tr></thead><tbody>
    ${rows.map(u => `<tr data-id="${u.id}">
      <td><div class="us-who">${avatarHtml(u.foto, u.nama, "sm")}<b>${esc(u.nama)}</b></div></td>
      <td>${esc(u.jabatan||"–")}</td><td>${esc(u.unit_kerja||"–")}</td><td>${esc(u.username)}</td>
      <td>${new Date(u.created_at).toLocaleDateString("id-ID",{day:"numeric",month:"short",year:"numeric"})}</td>
      <td><select data-f="status" class="st-${u.status}">${opt([["menunggu","Menunggu"],["aktif","Aktif"],["nonaktif","Nonaktif"]], u.status)}</select></td>
      <td><select data-f="akses">${opt(AKS, u.akses)}</select></td>
      <td><select data-f="role">${opt(ROLE_OPTS, u.role)}</select></td>
      <td class="us-act"><button class="btn-sm pri" data-act="save">Simpan</button><button class="btn-sm danger" data-act="del" title="Hapus akun">Hapus</button></td>
    </tr>`).join("")}</tbody></table></div>`;
  $("usList").querySelectorAll("tr[data-id]").forEach(tr => {
    const id = tr.dataset.id, u = US_ROWS.find(x => x.id === id);
    tr.querySelector('[data-act="save"]').onclick = async ev => {
      const b = ev.target, val = f => tr.querySelector(`[data-f="${f}"]`).value;
      b.disabled = true; b.textContent = "Menyimpan…";
      try { await sb("/rest/v1/rpc/admin_set_user", {method:"POST", body:{uid:id, p_status:val("status"), p_akses:val("akses"), p_role:val("role")}});
            Object.assign(u, {status:val("status"), akses:val("akses"), role:val("role")}); b.textContent = "Tersimpan";
            const pend = US_ROWS.filter(x => x.status === "menunggu").length; $("pendBadge").hidden = !pend; $("pendBadge").textContent = pend;
            setTimeout(drawUsers, 700); }
      catch(e){ alert("Gagal menyimpan: " + e.message); b.disabled = false; b.textContent = "Simpan"; }
    };
    tr.querySelector('[data-act="del"]').onclick = async () => {
      if (!confirm(`Hapus akun ${u.username} (${u.nama})? Akun yang dihapus tidak bisa dikembalikan.`)) return;
      try { await sb("/rest/v1/rpc/admin_delete_user", {method:"POST", body:{uid:id}}); US_ROWS = US_ROWS.filter(x => x.id !== id); drawUsers(); }
      catch(e){ alert("Gagal menghapus: " + e.message); }
    };
  });
}
$("usStatus").addEventListener("change", drawUsers);
$("usReload").addEventListener("click", renderUsers);

/* ================================================================== RINGKASAN */
function prodPanel({tab, color, name, per, lbl, val, cmp, subs, spark, sl}){
  return `<button class="prod" data-go="${tab}" style="--pc:${color}">
    <div class="p-top"><span class="p-name">${name}</span><span class="p-per">${per}</span></div>
    <div class="p-lbl">${lbl}</div><div class="p-val">${val}</div><div class="p-cmp">${cmp}</div>
    <div class="spark-l">${sl||""}</div><div class="spark" data-spark="${spark}"></div>
    <div class="p-sub">${subs.map(s=>`<div><b>${s[1]}</b><span>${s[0]}</span></div>`).join("")}</div>
    <div class="p-go">Lihat detail ${name}</div></button>`;
}
function renderSummary(){
  renderOvDrops();
  const A = D.atm, E = D.edc, L = D.lvm, n = A.last+1;
  const at = atmSummary(AREA), ed = edcSummary(AREA), lv = lvmSummary(AREA);
  const {y,m,d} = lvmDate();
  const lvP = lv.tgt.akYtd ? lv.akY/lv.tgt.akYtd : null;
  $("sumProducts").innerHTML =
    prodPanel({tab:"atm", color:C.s1, name:"ATM & CRM", per:`Jan–${BLN[A.last]} ${A.year}`, lbl:"Fee based income YTD", sl:"FBI per bulan",
      val:fRp(at.f), cmp:grHtml(at.f,at.fp,`dibanding ${A.year-1}`), spark:"atm",
      subs:[["Transaksi YTD", fC(at.t)], ["Jumlah mesin", fN(at.n)]]}) +
    prodPanel({tab:"edc", color:C.s2, name:"e-Channel", per:`s.d. minggu ${E.week} ${E.year}`, lbl:"Sales volume YTD", sl:"Sales volume per tahun",
      val:fRp(ed.sv), cmp:grHtml(ed.sv,ed.svp,`dibanding ${E.year-1}`), spark:"edc",
      subs:[["MDFG YTD", fRp(ed.md)], ["Merchant", fN(ed.merch)]]}) +
    prodPanel({tab:"lvm", color:C.s3, name:"Livin' Merchant", per:`s.d. ${d} ${BLN[m-1]} ${y}`, lbl:"Akuisisi merchant baru YTD", sl:"Akuisisi per bulan",
      val:fN(lv.akY), cmp:`${pctHtml(lvP)} dari target s.d. hari ini (${fN(lv.tgt.akYtd)})`, spark:"lvm",
      subs:[["Merchant USAK", `${fN(lv.usak)} <small class="${pctCls(lv.tgt.usak?lv.usak/lv.tgt.usak:null)}">${fP(lv.tgt.usak?lv.usak/lv.tgt.usak:null)}</small>`], ["Sales volume YTD", fRp(lv.svy)]]});
  // sparklines: nilai di atas batang, bulan/tahun di bawah
  const atmMs = A.machines.filter(x => inArea(x.a));
  drawChart(document.querySelector('[data-spark=atm]'), {spark:true, labels:BLN.slice(0,n), cats:BLN.slice(0,n), values:fShort, fmt:fRp,
    series:[S_("FBI", Array.from({length:n},(_,i)=>sum(atmMs,x=>x.f[i])), C.s1)]});
  const yrs = Object.keys(E.hist);
  drawChart(document.querySelector('[data-spark=edc]'), {spark:true, labels:yrs, cats:yrs.map(yy => yy.includes("YTD") ? "YTD" : "'"+yy.slice(2)), values:fShort, fmt:fRp,
    series:[S_("Sales volume", yrs.map(yy => sum(areas(), a => E.hist[yy][a]||0)), yrs.map(yy=>yy.includes("YTD")?C.s2:"#f5b49a"))]});
  const acq = L.acq.filter(r => inArea(BAREA[r[0]]));
  drawChart(document.querySelector('[data-spark=lvm]'), {spark:true, labels:BLN.slice(0,m), cats:BLN.slice(0,m), values:fShort, fmt:fN,
    series:[S_("Akuisisi", Array.from({length:m},(_,i)=>sum(acq.filter(r=>r[1]===y&&r[2]===i+1),r=>r[3])), C.s3)]});
  document.querySelectorAll("[data-go]").forEach(b => b.onclick = () => goTab(b.dataset.go));

  // ---- posisi data terakhir
  const atmEnd = new Date(A.year, A.last+1, 0);
  $("sumAsOf").innerHTML = `<span class="asof-t">Posisi data terakhir</span>
    <span class="asof-i"><i class="dot d-atm"></i>ATM &amp; CRM <b>${atmEnd.getDate()} ${BLN[A.last]} ${A.year}</b></span>
    <span class="asof-i"><i class="dot d-edc"></i>e-Channel <b>Minggu ke-${E.week} ${E.year}</b></span>
    <span class="asof-i"><i class="dot d-lvm"></i>Livin' Merchant <b>${d} ${BLN[m-1]} ${y}</b></span>
    ${D.duta?`<span class="asof-i"><i class="dot d-duta"></i>Duta Transaksi <b>${esc(D.duta.asof)}</b> <button class="head-btn asof-btn" id="goDuta">Buka Duta Transaksi</button></span>`:""}
    <span class="asof-i upd">Diperbarui ${esc(D.generated)}</span>`;
  if ($("goDuta")) $("goDuta").onclick = () => goTab("duta");

  // ---- Ringkasan KPI (kartu per produk)
  renderKpiCards();

  // ---- pie chart
  const tot = at.f + ed.md + lv.fby;
  drawPie($("cSumPie1"), {fmt:fRp, center:["total FBI", fRp(tot).replace("Rp ","")], items:[
    {label:"ATM & CRM", value:at.f, color:C.s1}, {label:"e-Channel", value:ed.md, color:C.s2}, {label:"Livin' Merchant", value:lv.fby, color:C.s3}]});
  const PAL = [C.s1, C.s2, C.s3, C.s4, "#7b61d1", "#d1559b"], OTHER = C.prev;
  const groups = AREA ? branchSlices() : areas().map((a,i) => ({label:title(a).replace("Area ",""), color:AREA_COLOR[a]||PAL[i%PAL.length], fbi:(x=>x.at.f+x.ed.md+x.lv.fby)({at:atmSummary(a), ed:edcSummary(a), lv:lvmSummary(a)}),
                                                                 ak:lvmSummary(a).akY, tak:lvmSummary(a).tgt.akYtd}));
  $("sumPie2T").textContent = AREA ? `Fee based income per cabang, ${title(AREA)}` : "Fee based income per area";
  $("sumPie3T").textContent = AREA ? `Akuisisi Livin' Merchant per cabang, ${title(AREA)}` : "Akuisisi Livin' Merchant per area";
  const fbiSum = sum(groups, g=>g.fbi), akSum = sum(groups, g=>g.ak);
  drawPie($("cSumPie2"), {fmt:fRp, center:[AREA?"total area":"total region", fRp(fbiSum).replace("Rp ","")], items:groups.map(g => ({label:g.label, value:g.fbi, color:g.color}))});
  drawPie($("cSumPie3"), {fmt:fN, center:["merchant baru", fN(akSum)], items:groups.map(g => ({label:g.label, value:g.ak, color:g.color, note:g.tak?`${fP(g.ak/g.tak)} target`:""}))});
}
function branchSlices(){            // 5 cabang terbesar + lainnya, untuk area terpilih
  const R = {}, g = c => R[c] || (R[c] = {c, fbi:0, ak:0});
  for (const m of D.atm.machines) if (inArea(m.a)) g(m.c).fbi += sum(m.f);
  const EI = Object.fromEntries(D.edc.cols.map((c,i)=>[c,i]));
  for (const r of D.edc.cube) if (inArea(r[0])) g(r[1]).fbi += r[EI.md];
  for (const r of D.lvm.cube) if (inArea(r[0])) { const o = g(r[1]); o.fbi += r[13]; if (r[3].startsWith("New Akuisisi")) o.ak += r[4]; }
  const rows = Object.values(R).filter(o => o.c).sort((a,b) => b.fbi - a.fbi);
  const PAL = [C.s1, C.s2, C.s3, C.s4, "#7b61d1"];
  const top = rows.slice(0,5).map((o,i) => ({label:bn(o.c), color:PAL[i], fbi:o.fbi, ak:o.ak, tak:tgtFor([o.c]).akYtd}));
  const rest = rows.slice(5);
  if (rest.length) top.push({label:`${rest.length} cabang lainnya`, color:C.prev, fbi:sum(rest,o=>o.fbi), ak:sum(rest,o=>o.ak), tak:tgtFor(rest.map(o=>o.c)).akYtd});
  return top;
}


/* ================================================================== WPR (Weekly Performance Report) */
const WPR = {sel:-1};
const wl = w => "W" + w;
function wprIdx(){
  const W = BOX.wpr, seg = $("wSeg").value, env = $("wEnv").value, cab = $("wCab").value, out = [];
  for (let i=0;i<W.n;i++){
    if (!inArea(W.a[i])) continue;
    if (seg && W.s[i] !== seg) continue;
    if (env && !W.e[i].split("/").includes(env)) continue;
    if (cab && W.c[i] !== cab) continue;
    out.push(i);
  }
  return out;
}
function wprFilters(){
  const W = BOX.wpr, inA = []; for (let i=0;i<W.n;i++) if (inArea(W.a[i])) inA.push(i);
  opts($("wSeg"), [...new Set(inA.map(i=>W.s[i]).filter(Boolean))].sort(), "Semua segmen");
  opts($("wEnv"), [...new Set(inA.flatMap(i=>W.e[i].split("/")).filter(Boolean))].sort(), "Semua");
  cabOptions($("wCab"), inA.map(i=>W.c[i]));
}
async function renderWPR(){
  if (!D.wpr){ $("wInfo").textContent = "Belum ada data WPR. Taruh file Performance_WPR_... di folder data lalu jalankan update."; $("wBody").hidden = true; return; }
  if (!BOX.wpr){
    $("wBody").hidden = true; $("wInfo").textContent = "Menyiapkan data WPR…";
    try { await loadBox("wpr"); } catch(e){ $("wInfo").textContent = "Gagal memuat data WPR: " + e.message; return; }
    if (TAB !== "wpr") return;
  }
  const W = BOX.wpr, K = W.weeks.length, last = K-1, prev = K-2, LW = wl(W.weeks[last]), PW = wl(W.weeks[prev]);
  wprFilters();
  const idx = wprIdx();
  $("wBody").hidden = false;
  $("wInfo").textContent = `${fN(idx.length)} merchant (dari ${fN(W.nmids)} MID; nama merchant yang sama sudah digabung).`;
  const tot = (k,j) => sum(idx, i => W[k][j][i]), ytd = k => sum(idx, i => W[k][i]);
  const act = idx.filter(i => W.sv[last][i] > 0).length, actP = idx.filter(i => W.sv[prev][i] > 0).length;
  const avg4 = sum(W.weeks.map((_,j) => tot("sv",j))) / K;
  $("wKpis").innerHTML =
    kpi(`Sales volume ${LW}`, fRp(tot("sv",last)), grHtml(tot("sv",last), tot("sv",prev), `vs ${PW}`)) +
    kpi(`Frekuensi ${LW}`, fN(tot("fq",last)), grHtml(tot("fq",last), tot("fq",prev), `vs ${PW}`)) +
    kpi(`Fee based income ${LW}`, fRp(tot("fb",last)), grHtml(tot("fb",last), tot("fb",prev), `vs ${PW}`)) +
    kpi(`Rata-rata SV 4 minggu`, fRp(avg4), `${LW} ${grHtml(tot("sv",last), avg4, "vs rata-rata")}`) +
    kpi(`Merchant aktif ${LW}`, fN(act), `${fP(idx.length ? act/idx.length : 0)} dari ${fN(idx.length)}<br>${PW}: ${fN(actP)}`) +
    kpi(`Sales volume YTD`, fRp(ytd("svy")), `Frek ${fC(ytd("fqy"))}`) +
    kpi(`Fee based income YTD`, fRp(ytd("fby")), `rata-rata ${fRp(ytd("fby")/Math.max(1, W.weeks[last]))}/minggu`);
  const labs = W.weeks.map(wl);
  for (const [k, fmt, col] of [["sv",fC,C.s2],["fq",fN,C.s1],["fb",fC,C.s3]])
    drawChart($("cW_"+k), {labels:labs, fmt, series:[S_({sv:"Sales volume",fq:"Frekuensi",fb:"FBI"}[k], labs.map((_,j)=>tot(k,j)), labs.map((_,j)=> j===last ? col : col+"88"))]});

  // per segmen
  const bySeg = {};
  for (const i of idx){ const g = bySeg[W.s[i]||"Lainnya"] || (bySeg[W.s[i]||"Lainnya"] = {s:W.s[i]||"Lainnya", n:0, w:W.weeks.map(()=>0), y:0, fb:0});
    g.n++; W.weeks.forEach((_,j) => g.w[j] += W.sv[j][i]); g.y += W.svy[i]; g.fb += W.fby[i]; }
  const ySum = ytd("svy");
  const wkCols = W.weeks.map((w,j) => ({k:"w"+j, l:`SV ${wl(w)}`, num:1, v:x=>x.w[j], f:fC}));
  const segRows = Object.values(bySeg);
  $("tWSeg")._st = null;
  table($("tWSeg"), {rows:segRows, sort:"y", search:false, full:true, page:20, csv:"wpr_segmen", cols:[
    {k:"s",l:"Segmen"}, {k:"n",l:"Merchant",num:1,f:fN}, ...wkCols,
    {k:"g",l:`${LW} vs ${PW}`,num:1,v:x=>gr(x.w[last],x.w[prev]),h:(x,v)=>growthTag(v)},
    {k:"y",l:"SV YTD",num:1,f:fC}, {k:"sh",l:"Porsi YTD",num:1,v:x=>ySum?x.y/ySum:0,f:fP}, {k:"fb",l:"FBI YTD",num:1,f:fC}],
    foot: r => ["Total", fN(sum(r,x=>x.n)), ...W.weeks.map((_,j)=>fC(sum(r,x=>x.w[j]))), growthTag(gr(sum(r,x=>x.w[last]), sum(r,x=>x.w[prev]))), fC(sum(r,x=>x.y)), "", fC(sum(r,x=>x.fb))]});

  // naik / turun
  const mvRow = i => ({i, nm:W.nm[i], cb:W.c[i]+" - "+bn(W.c[i]), s:W.s[i], nmid:W.nmid[i], p:W.sv[prev][i], c:W.sv[last][i], d:W.sv[last][i]-W.sv[prev][i]});
  const moved = idx.map(mvRow);
  $("wMoveT").textContent = `Naik & turun terbesar ${LW} vs ${PW}`;
  const mvCols = [{k:"rk",l:"#",num:1}, {k:"nm",l:"Merchant"}, {k:"cb",l:"Cabang"}, {k:"s",l:"Segmen"},
    {k:"p",l:`SV ${PW}`,num:1,f:fC}, {k:"c",l:`SV ${LW}`,num:1,f:fC}, {k:"d",l:"Selisih",num:1,h:(x,v)=>`<span class="${v>=0?"up":"down"}">${v>=0?"+":""}${fC(v)}</span>`}];
  const mkMv = (el, rows) => { el._st = null; table(el, {rows:rows.map((x,n)=>({...x, rk:n+1})), cols:mvCols, page:10, search:false, full:true,
    rowKey:x=>x.i, onRow:k => wprDetail(+k)}); };
  mkMv($("tWUp"), moved.filter(x=>x.d>0).sort((a,b)=>b.d-a.d).slice(0,10));
  mkMv($("tWDown"), moved.filter(x=>x.d<0).sort((a,b)=>a.d-b.d).slice(0,10));

  // per cabang
  const byC = {};
  for (const i of idx){ const g = byC[W.c[i]] || (byC[W.c[i]] = {c:W.c[i], a:W.a[i], n:0, w:W.weeks.map(()=>0), y:0, fb:0, fq:0});
    g.n++; W.weeks.forEach((_,j) => g.w[j] += W.sv[j][i]); g.y += W.svy[i]; g.fb += W.fby[i]; g.fq += W.fqy[i]; }
  $("tWCab")._st = null;
  table($("tWCab"), {rows:Object.values(byC), sort:"y", full:true, page:25, csv:"wpr_cabang", cols:[
    {k:"cb",l:"Cabang",v:x=>x.c+" - "+bn(x.c)}, {k:"a",l:"Area",f:title}, {k:"n",l:"Merchant",num:1,f:fN}, ...wkCols,
    {k:"g",l:`${LW} vs ${PW}`,num:1,v:x=>gr(x.w[last],x.w[prev]),h:(x,v)=>growthTag(v)},
    {k:"y",l:"SV YTD",num:1,f:fC}, {k:"fb",l:"FBI YTD",num:1,f:fC}, {k:"fq",l:"Frek YTD",num:1,f:fN}]});

  // daftar merchant (pivot per nama)
  table($("tWMer"), {rows:idx.map(i => ({i, nm:W.nm[i], nmid:W.nmid[i], cb:W.c[i]+" - "+bn(W.c[i]), s:W.s[i], e:W.e[i], l:W.l[i],
      w:W.weeks.map((_,j)=>W.sv[j][i]), y:W.svy[i], fb:W.fby[i], fq:W.fqy[i], mids:W.mids[i]})),
    sort:"y", page:25, full:true, freeze:2, csv:"wpr_merchant", rowKey:x=>x.i, onRow:k => wprDetail(+k),
    needQuery:`Ketik nama merchant, MID, cabang, atau segmen di kolom pencarian untuk menampilkan data (${fN(idx.length)} merchant tersedia).`, cols:[
    {k:"nm",l:"Merchant"}, {k:"nmid",l:"MID",num:1,f:fN}, {k:"cb",l:"Cabang"}, ...wkCols,
    {k:"g",l:`${LW} vs ${PW}`,num:1,v:x=>gr(x.w[last],x.w[prev]),h:(x,v)=>growthTag(v)},
    {k:"y",l:"SV YTD",num:1,f:fC}, {k:"fb",l:"FBI YTD",num:1,f:fC}, {k:"fq",l:"Frek YTD",num:1,f:fN},
    {k:"s",l:"Segmen"}, {k:"e",l:"Business env"}, {k:"l",l:"LOB"}, {k:"mids",l:"Daftar MID",h:(x,v)=>`<span class="mids">${esc(v)}</span>`}]});
  if (WPR.sel >= 0 && idx.includes(WPR.sel)) wprDetail(WPR.sel, true); else { WPR.sel = -1; $("wDetail").innerHTML = ""; }
}
function wprDetail(i, quiet){
  const W = BOX.wpr, K = W.weeks.length, last = K-1, prev = K-2, LW = wl(W.weeks[last]), PW = wl(W.weeks[prev]);
  WPR.sel = i;
  const labs = W.weeks.map(wl);
  $("wDetail").innerHTML = `
    <div class="panel ms-head"><div class="ms-title"><h2>${esc(W.nm[i])}</h2><span class="pill">${fN(W.nmid[i])} MID</span><span class="pill">${esc(title(W.a[i]))}</span><button class="btn-sm ms-close" data-close>Tutup</button></div>
      <dl class="ms-fields">${[["Official name", esc(W.on[i]||"–")], ["Cabang pengelola", esc(W.c[i]+" - "+bn(W.c[i]))], ["Segmen", esc(W.s[i]||"–")],
        ["Business env", esc(W.e[i]||"–")], ["LOB", esc(W.l[i]||"–")], ["Jumlah rekening", fN(W.nrek[i])], ["Alamat", esc(W.al[i]||"–")],
        ["MID", `<span class="mids">${esc(W.mids[i])}</span>`]].map(f=>fieldHtml(f[0],f[1])).join("")}</dl></div>
    <div class="kpis">
      ${kpi(`Sales volume ${LW}`, fRp(W.sv[last][i]), grHtml(W.sv[last][i], W.sv[prev][i], `vs ${PW}`))}
      ${kpi(`Frekuensi ${LW}`, fN(W.fq[last][i]), grHtml(W.fq[last][i], W.fq[prev][i], `vs ${PW}`))}
      ${kpi(`FBI ${LW}`, fRp(W.fb[last][i]), grHtml(W.fb[last][i], W.fb[prev][i], `vs ${PW}`))}
      ${kpi("Sales volume YTD", fRp(W.svy[i]), `Frek ${fN(W.fqy[i])}`)}
      ${kpi("FBI YTD", fRp(W.fby[i]), "")}
    </div>
    <div class="grid g3">${[["sv","Sales volume"],["fq","Frekuensi"],["fb","Fee based income"]].map(([k,t]) =>
      `<div class="panel"><div class="panel-head"><h3>${t} per minggu</h3></div><div class="chart sm"><div id="wd_${k}" class="mc"></div></div></div>`).join("")}</div>`;
  for (const [k, fmt, col] of [["sv",fC,C.s2],["fq",fN,C.s1],["fb",fC,C.s3]])
    drawChart($("wd_"+k), {labels:labs, fmt, series:[S_(k, labs.map((_,j)=>W[k][j][i]), labs.map((_,j)=> j===last ? col : col+"88"))]});
  $("wDetail").querySelector("[data-close]").onclick = () => { WPR.sel = -1; $("wDetail").innerHTML = ""; };
  if (!quiet) $("wDetail").scrollIntoView({behavior:"smooth", block:"start"});
}

/* ================================================================== OVERVIEW: TOP 10 DROP */
async function renderOvDrops(){
  // ATM & CRM: volume bulan terakhir vs bulan sebelumnya, per mesin
  const A = D.atm, n = A.last+1, Lm = BLN[A.last], Pm = BLN[A.last-1];
  const ms = A.machines.filter(m => inArea(m.a) && n > 1 && m.v[n-2] > 0 && m.v[n-1] < m.v[n-2])
    .map(m => ({id:m.id, nm:m.nm, j:m.j, cb:m.c+" - "+bn(m.c), p:m.v[n-2], c:m.v[n-1], d:m.v[n-1]-m.v[n-2], g:gr(m.v[n-1], m.v[n-2])}))
    .sort((a,b) => a.d - b.d).slice(0,10).map((x,i) => ({...x, rk:i+1}));
  $("ovAtmT").textContent = `Top 10 volume drop ATM & CRM, ${Lm} vs ${Pm} ${A.year}`;
  $("ovAtmInfo").textContent = "Data per mesin hanya tersedia per bulan tahun berjalan, jadi pembandingnya bulan sebelumnya. Klik baris untuk performance lengkap.";
  $("tOvAtmDrop")._st = null;
  table($("tOvAtmDrop"), {rows:ms, search:false, full:true, page:10, csv:"top10_drop_atm", rowKey:x=>x.id, onRow:id => openInSearch("atm","id",id), cols:[
    {k:"rk",l:"#",num:1}, {k:"id",l:"ID mesin"}, {k:"nm",l:"Nama lokasi"}, {k:"j",l:"Jenis",h:(x,v)=>`<span class="pill">${v}</span>`}, {k:"cb",l:"Cabang"},
    {k:"p",l:`Volume ${Pm}`,num:1,f:fC}, {k:"c",l:`Volume ${Lm}`,num:1,f:fC}, {k:"d",l:"Penurunan",num:1,h:(x,v)=>`<span class="down">${fC(v)}</span>`}, {k:"g",l:"%",num:1,h:(x,v)=>growthTag(v)}]});

  // e-Channel: SV YTD vs tahun lalu, per nama merchant (MID dengan nama sama digabung)
  if (!BOX.merchant){
    $("ovEdcInfo").textContent = "Menyiapkan data merchant…";
    try { await loadBox("merchant"); } catch(e){ $("ovEdcInfo").textContent = "Gagal memuat data merchant: " + e.message; return; }
    if (TAB !== "ringkasan") return;
  }
  const m = BOX.merchant, L = m.labels.length, iY = L-3, iP = L-4;
  const segs = new Set(); for (let i=0;i<m.n;i++) if (inArea(m.a[i]) && m.s[i]) segs.add(m.s[i]);
  opts($("ovEdcSeg"), [...segs].sort(), "Semua segmen");
  const seg = $("ovEdcSeg").value, G = new Map();
  for (let i=0;i<m.n;i++){
    if (!inArea(m.a[i]) || (seg && m.s[i] !== seg)) continue;
    const k = (m.nm[i]||("MID "+m.mid[i])).toUpperCase().replace(/\s+/g," ").trim();
    const g = G.get(k) || (G.set(k, {nm:m.nm[i]||k, idx:[], c:0, p:0}), G.get(k));
    g.idx.push(i); g.c += mv(m,"sv",iY,i)||0; g.p += mv(m,"sv",iP,i)||0;
  }
  const rows = [...G.values()].filter(g => g.p > 0 && g.c < g.p).map(g => {
      const top = g.idx.reduce((a,b) => ((mv(m,"sv",iP,b)||0) > (mv(m,"sv",iP,a)||0) ? b : a));
      return {nm:g.nm, nmid:g.idx.length, cb:m.c[top]+" - "+bn(m.c[top]), s:m.s[top], p:g.p, c:g.c, d:g.c-g.p, g:gr(g.c,g.p)}; })
    .sort((a,b) => a.d - b.d).slice(0,10).map((x,i) => ({...x, rk:i+1}));
  $("ovEdcInfo").textContent = `Sales volume YTD minggu ke-${m.week} ${m.year} dibanding minggu yang sama ${m.year-1}, per nama merchant (MID dengan nama sama digabung). Klik baris untuk performance lengkap.`;
  $("tOvEdcDrop")._st = null;
  table($("tOvEdcDrop"), {rows, search:false, full:true, page:10, csv:"top10_sv_drop_edc", rowKey:x=>x.nm, onRow:nm => openInSearch("edc","nm",nm), cols:[
    {k:"rk",l:"#",num:1}, {k:"nm",l:"Merchant"}, {k:"nmid",l:"MID",num:1,f:fN}, {k:"cb",l:"Cabang"}, {k:"s",l:"Segmen"},
    {k:"p",l:`SV ${m.year-1}`,num:1,f:fC}, {k:"c",l:`SV ${m.year}`,num:1,f:fC}, {k:"d",l:"Penurunan",num:1,h:(x,v)=>`<span class="down">${fC(v)}</span>`}, {k:"g",l:"%",num:1,h:(x,v)=>growthTag(v)}]});
}

/* ================================================================== app */

/* ================================================================== DUTA TRANSAKSI (sub-page Overview) */
const p90Cls = p => p==null ? "" : p>=.9 ? "good" : p>=.8 ? "mid" : "bad";
const p90Html = p => `<span class="${p90Cls(p)}">${fP(p)}</span>`;
const fJt = v => fRp((v||0)*1e6);
function renderDuta(){
  const T = D.duta;
  if (!T){ $("dtKpis").innerHTML = `<p class="note">File Duta Transaksi belum ada di folder data.</p>`; return; }
  // unit: [area, unit, peg, part, on, off, pctOn, svOn, svOff, p90, pctP90, poin, rank]
  const units = T.units.filter(u => inArea(u[0]));
  const t = AREA ? {peg:sum(units,u=>u[2]), part:sum(units,u=>u[3]), on:sum(units,u=>u[4]), off:sum(units,u=>u[5]), svOn:sum(units,u=>u[7]), svOff:sum(units,u=>u[8]), p90:sum(units,u=>u[9])}
                 : {peg:T.tot[0], part:T.tot[1], on:T.tot[2], off:T.tot[3], svOn:T.tot[4], svOff:T.tot[5], p90:T.tot[6]};
  const trx = t.on + t.off;
  $("dtKpis").innerHTML =
    kpi("Total pegawai", fN(t.peg), `${fN(t.part)} berpartisipasi (${fP(t.peg?t.part/t.peg:0)})`, "", t.peg?t.part/t.peg:null) +
    kpi("Transaksi On Us", fN(t.on), `${fP(trx?t.on/trx:0)} dari total frekuensi<br>SV ${fJt(t.svOn)}`) +
    kpi("Transaksi Off Us", fN(t.off), `${fP(trx?t.off/trx:0)} dari total frekuensi<br>SV ${fJt(t.svOff)}`) +
    kpi("Pegawai On Us min 90%", fN(t.p90), `${p90Html(t.peg?t.p90/t.peg:null)} dari total pegawai<br>GAP ${fN(t.p90 - t.peg)} pegawai`, "", t.peg?t.p90/t.peg:null);

  // grafik per unit bisnis (area + unit region)
  const ar = T.areas.filter(a => inArea(a[0])).map(a => ({n:a[1], p:a[2]?a[8]/a[2]:0})).sort((x,y)=>y.p-x.p);
  chart("cDtArea", {labels:ar.map(a=>a.n), fmt:fP, values:fP, horizontal:true, series:[
    S_("% pegawai On Us ≥90%", ar.map(a=>a.p), ar.map(a=>a.p>=.9?C.s3:a.p>=.8?C.s4:C.s2))]});
  drawPie($("cDtPie"), {fmt:fN, center:["transaksi", fN(trx)], items:[{label:"On Us", value:t.on, color:C.s1, note:fP(trx?t.on/trx:0)}, {label:"Off Us", value:t.off, color:C.s2, note:fP(trx?t.off/trx:0)}]});

  // bottom 5 per area
  const areas = AREA ? [AREA] : D.areas;
  $("dtBotT").textContent = AREA ? "Bottom 10 unit kerja pegawai On Us 90%" : "Bottom 5 unit kerja pegawai On Us 90%";
  $("dtBottom").className = "grid bot-grid " + (AREA ? "g1" : "g4");
  $("dtBottom").innerHTML = areas.map(a => {
    const list = T.units.filter(u => u[0]===a && u[2]>0).sort((x,y) => x[10]-y[10] || y[2]-x[2]).slice(0, AREA?10:5);
    return `<div class="bot"><h4>${esc(title(a))}</h4><ol>${list.map(u => `<li><span>${esc(u[1])}</span><b class="${p90Cls(u[10])}">${fP(u[10])}</b><small>${u[9]} dari ${u[2]} pegawai</small></li>`).join("") || "<li>Tidak ada data</li>"}</ol></div>`;
  }).join("");

  table($("tDtUnit"), {csv:"duta_transaksi_unit", sort:"pp", dir:1, page:15, rows:units.map(u => ({a:u[0], n:u[1], peg:u[2], part:u[3], on:u[4], off:u[5], po:u[6], sv:u[7], p90:u[9], pp:u[10], poin:u[11], rk:u[12]||null})), cols:[
    {k:"a",l:"Area",f:a=>a==="REGION"?"Region":title(a).replace("Area ","")}, {k:"n",l:"Unit kerja"}, {k:"peg",l:"Pegawai",num:1,f:fN}, {k:"part",l:"Partisipasi",num:1,f:fN},
    {k:"on",l:"Frek On Us",num:1,f:fN}, {k:"off",l:"Frek Off Us",num:1,f:fN}, {k:"po",l:"% On Us",num:1,f:p90Html}, {k:"sv",l:"SV On Us",num:1,f:fJt},
    {k:"p90",l:"Pegawai ≥90%",num:1,f:fN}, {k:"pp",l:"% pegawai ≥90%",num:1,f:p90Html}, {k:"poin",l:"Poin program",num:1,f:fN}, {k:"rk",l:"Rank di area",num:1,f:v=>v?fN(v):"–"}],
    foot: r => { const s_ = k => sum(r,x=>x[k]); return ["","Total",fN(s_("peg")),fN(s_("part")),fN(s_("on")),fN(s_("off")),p90Html(s_("on")+s_("off")?s_("on")/(s_("on")+s_("off")):null),fJt(s_("sv")),fN(s_("p90")),p90Html(s_("peg")?s_("p90")/s_("peg"):null),fN(s_("poin")),""]; }});

  // pegawai: [nama, area, unit, part, on, off, pctOn, poin, need, p90]
  const st = $("dtStat").value;
  const peg = T.peg.filter(x => inArea(x[1]) && (st==="" || (st==="np" ? !x[3] : String(x[9])===st)));
  table($("tDtPeg"), {csv:"duta_transaksi_pegawai", sort:"need", page:15, rows:peg.map(x => ({nm:x[0], a:x[1], u:x[2], on:x[4], off:x[5], po:x[6], poin:x[7], need:x[8], ok:x[9], part:x[3]})), cols:[
    {k:"nm",l:"Nama pegawai"}, {k:"u",l:"Unit kerja"}, {k:"a",l:"Area",f:a=>a==="REGION"?"Region":title(a).replace("Area ","")},
    {k:"on",l:"Frek On Us",num:1,f:fN}, {k:"off",l:"Frek Off Us",num:1,f:fN}, {k:"po",l:"% On Us",num:1,f:(v,x)=>x.part?p90Html(v):"–"},
    {k:"need",l:"Kebutuhan tambahan",num:1,f:v=>v?`<b class="bad">${fN(v)}</b>`:"0"}, {k:"poin",l:"Poin program",num:1,f:fN},
    {k:"ok",l:"Status",f:(v,x)=>!x.part?`<span class="tag bad">Belum partisipasi</span>`:v?`<span class="tag good">Sudah 90%</span>`:`<span class="tag mid">Belum 90%</span>`}]});

  $("dtNotes").innerHTML = `<h3>Catatan</h3><ol>${T.notes.map(n=>`<li>${esc(n)}</li>`).join("")}</ol><p class="note">Sumber: ${esc(T.file)}</p>`;
}

/* ================================================================== USAK (sub-page Livin' Merchant) */
const usCls = p => p==null ? "" : p>=.7 ? "good" : p>=.56 ? "mid" : "bad";
const usHtml = p => `<span class="${usCls(p)}">${fP(p)}</span>`;
const tgt70 = rows => { const a = {}; for (const r of rows) a[r.a] = (a[r.a]||0) + r.n; return sum(Object.values(a), v => Math.ceil(v*.7 - 1e-9)); };
function renderUsak(){
  const U = D.usak;
  if (!U){ $("usKpis").innerHTML = `<p class="note">File Dashboard USAK belum ada di folder data.</p>`; return; }
  // cab: [kode, nama, kelas, area, n[3], u[3], sv, fr, tgt]
  const cabs = U.cab.filter(c => inArea(c[3]));
  const sel = $("usCab"), cur = sel.value;
  sel.innerHTML = `<option value="">Semua unit${AREA?` ${title(AREA)}`:" Region XI"}</option>` + [...cabs].sort((x,y)=>x[1].localeCompare(y[1])).map(c => `<option value="${esc(c[0])}">${esc(c[1])}${/^\d+$/.test(c[0])?" ("+c[0]+")":""}</option>`).join("");
  sel.value = cabs.some(c => c[0]===cur) ? cur : "";
  const cab = sel.value, cs = cabs.filter(c => !cab || c[0]===cab);
  const n = sum(cs, c => c[4][0]+c[4][1]+c[4][2]), u = sum(cs, c => c[5][0]+c[5][1]+c[5][2]);
  // target 70% dihitung per area (sama dengan file sumber), atau per unit saat satu unit dipilih
  const byA = {}; for (const c of cs) byA[c[3]] = (byA[c[3]]||0) + c[4][0]+c[4][1]+c[4][2];
  const tgt = cab ? cs[0][8] : sum(Object.values(byA), v => Math.ceil(v*.7 - 1e-9));
  const ms = U.m.filter(m => cs.some(c => c[0]===m[3]));
  const pegs = new Set(ms.map(m => m[2]));
  $("usKpis").innerHTML =
    kpi("Merchant diakuisisi (UREG)", fN(n), `oleh ${fN(pegs.size)} pegawai`) +
    kpi("Sudah USAK", fN(u), `${usHtml(n?u/n:null)} dari UREG (target 70%)`, "", n?u/n:null) +
    kpi("Belum USAK", fN(n-u), `${fP(n?(n-u)/n:0)} dari UREG`) +
    kpi("Target realisasi 70%", fN(tgt), `GAP <b class="${u>=tgt?"good":"bad"}">${fN(u-tgt)}</b> merchant`, "", tgt?u/tgt:null) +
    kpi("Sales volume", fRp(sum(cs,c=>c[6])), `Frekuensi ${fN(sum(cs,c=>c[7]))} transaksi`);

  // grafik per area (atau per unit di area terpilih)
  const grp = {};
  const key = AREA ? (c => c[1]) : (c => c[3]);
  for (const c of cs){ const g = grp[key(c)] || (grp[key(c)] = {n:0,u:0,t:0}); const k = c[4][0]+c[4][1]+c[4][2]; g.n += k; g.u += c[5][0]+c[5][1]+c[5][2]; g.t += AREA ? c[8] : 0; }
  if (!AREA) for (const a in grp) grp[a].t = Math.ceil(grp[a].n*.7 - 1e-9);
  let gl = Object.keys(grp);
  if (AREA) gl = gl.sort((x,y)=>grp[y].n-grp[x].n).slice(0,12);
  else gl.sort((x,y) => (D.areas.indexOf(x)+1||99) - (D.areas.indexOf(y)+1||99));
  $("usChT").textContent = AREA ? `USAK per unit kerja, 12 UREG terbanyak ${title(AREA)}` : "USAK per area";
  const lbl = g => AREA ? g : g==="REGION" ? "Region" : title(g).replace("Area ","");
  chart("cUsArea", {labels:gl.map(lbl), fmt:fN, series:[S_("UREG", gl.map(g=>grp[g].n), C.prev), S_("USAK", gl.map(g=>grp[g].u), C.s3), S_("Target 70%", gl.map(g=>grp[g].t), C.s2)]});
  const pn = [0,1,2].map(i => sum(cs,c=>c[4][i])), pu = [0,1,2].map(i => sum(cs,c=>c[5][i]));
  chart("cUsPrio", {labels:["Prio 1","Prio 2","Prio 3"], fmt:fN, series:[S_("UREG", pn, C.prev), S_("USAK", pu, C.s3)]});

  const unitRow = c => { const k = c[4][0]+c[4][1]+c[4][2], v = c[5][0]+c[5][1]+c[5][2];
    return {kd:c[0], nm:c[1], kl:c[2]||"–", a:c[3], n:k, u:v, b:k-v, p:k?v/k:null, p1:c[4][0], p2:c[4][1], p3:c[4][2], t:c[8], gap:v-c[8], sv:c[6]}; };
  table($("tUsCab"), {csv:"usak_unit_kerja", sort:"gap", dir:1, page:15, rows:cabs.map(unitRow), rowKey:x=>x.kd, onRow:k => { $("usCab").value = k; renderUsak(); $("usKpis").scrollIntoView({behavior:"smooth", block:"start"}); }, cols:[
    {k:"a",l:"Area",f:a=>a==="REGION"?"Region":title(a).replace("Area ","")}, {k:"kl",l:"Kelas"}, {k:"kd",l:"Kode",f:v=>/^\d+$/.test(v)?v:"–"}, {k:"nm",l:"Unit kerja"},
    {k:"n",l:"UREG",num:1,f:fN}, {k:"u",l:"USAK",num:1,f:fN}, {k:"b",l:"Belum USAK",num:1,f:fN}, {k:"p",l:"% USAK",num:1,f:usHtml},
    {k:"p1",l:"Prio 1",num:1,f:fN}, {k:"p2",l:"Prio 2",num:1,f:fN}, {k:"p3",l:"Prio 3",num:1,f:fN},
    {k:"t",l:"Target 70%",num:1,f:fN}, {k:"gap",l:"GAP",num:1,f:v=>`<b class="${v>=0?"good":"bad"}">${fN(v)}</b>`}, {k:"sv",l:"Sales volume",num:1,f:fC}],
    foot: r => { const s_ = k => sum(r,x=>x[k]), t = tgt70(r); return ["","","","Total",fN(s_("n")),fN(s_("u")),fN(s_("b")),usHtml(s_("n")?s_("u")/s_("n"):null),fN(s_("p1")),fN(s_("p2")),fN(s_("p3")),fN(t),`<b class="${s_("u")>=t?"good":"bad"}">${fN(s_("u")-t)}</b>`,fC(s_("sv"))]; }});

  // peg: [nama, unit, area, tipe, n, usak, sv, fr, kode]
  const pg = U.peg.filter(p => inArea(p[2]) && (!cab || p[8]===cab));
  table($("tUsPeg"), {csv:"usak_pegawai", sort:"u", page:15, rows:pg.map(p => ({nm:p[0], un:p[1], ty:p[3], n:p[4], u:p[5], p:p[4]?p[5]/p[4]:null, sv:p[6], fr:p[7]})), cols:[
    {k:"nm",l:"Nama pegawai"}, {k:"un",l:"Unit kerja"}, {k:"ty",l:"Tipe",f:v=>v?title(v).replace("Tad","TAD"):"–"},
    {k:"n",l:"UREG",num:1,f:fN}, {k:"u",l:"USAK",num:1,f:fN}, {k:"p",l:"% USAK",num:1,f:usHtml}, {k:"fr",l:"Frekuensi",num:1,f:fN}, {k:"sv",l:"Sales volume",num:1,f:fC}]});

  // m: [merchant, mid, pegIdx, kode, usak, prio, frek, sv, kurangFrek, kurangSv, milestone, alamat]
  const pr = $("usPrio").value;
  const bu = ms.filter(m => !m[4] && (!pr || String(m[5])===pr));
  const unitNm = Object.fromEntries(U.cab.map(c => [c[0], c[1]]));
  table($("tUsMer"), {csv:"merchant_belum_usak", sort:"dist", dir:1, page:15, rows:bu.map(m => ({nm:m[0], mid:m[1], pg:U.peg[m[2]][0], un:unitNm[m[3]]||m[3], pr:m[5], fr:m[6], sv:m[7], kf:m[8], ks:m[9],
      dist:(m[8]>0?1:0)+(m[9]>0?1:0)+m[8]/100+m[9]/1e7, al:m[11]})),
    rowKey:x=>x.mid ? "mid:"+x.mid : "nm:"+x.nm, onRow:k => openInSearch("lvm", k.slice(0,k.indexOf(":")), k.slice(k.indexOf(":")+1)), cols:[
    {k:"nm",l:"Merchant",f:(v,x)=>`<span class="nm-cut" title="${esc(v)}${x.mid?" · MID "+x.mid:""}">${esc(v)}</span>`}, {k:"pg",l:"Pegawai (unit kerja)",f:(v,x)=>`${esc(v)} <small class="muted">${esc(x.un)}</small>`}, {k:"pr",l:"Prio",f:v=>"Prio "+v},
    {k:"fr",l:"Frekuensi",num:1,f:fN}, {k:"sv",l:"Sales volume",num:1,f:fRp},
    {k:"kf",l:"Kurang frek",num:1,f:v=>v?`<b class="bad">${fN(v)}</b>`:`<span class="good">✓</span>`}, {k:"ks",l:"Kurang SV",num:1,f:v=>v?`<b class="bad">${fRp(v)}</b>`:`<span class="good">✓</span>`}]});

  $("usNotes").innerHTML = `<h3>Keterangan</h3><ol>${U.gates.map(g=>`<li>${esc(g)}</li>`).join("")}<li>Target realisasi = 70% dari jumlah merchant UREG; GAP negatif berarti USAK masih di bawah target.</li></ol><p class="note">Sumber: ${esc(U.file)}</p>`;
}


/* ================================================================== SENATOR */
const SN_ROW = c => ({kd:c[0], nm:c[1], kl:c[2]||"–", a:c[3], pic:c[4], uni:c[5], gold:c[6], pg:c[5]?c[6]/c[5]:Infinity, sep:c[7], okt:c[8], w1:c[9], w2:c[10],
  cbg:c[11], usak:c[12], pu:c[11]?c[12]/c[11]:null, fr:c[13], sv:c[14], fbi:c[15], cap:c[21], fu:c[22]});
const pctPlain = (p, good=.5) => `<span class="${p==null?"":p>=good?"good":p>=good*.8?"mid":"bad"}">${fP(p)}</span>`;
function botList(el, titleTxt, rows, val, sub){
  el.innerHTML = `<h4>${esc(titleTxt)}</h4><ol>${rows.map(r => `<li><span>${esc(r.nm)}</span><b class="bad">${val(r)}</b><small>${sub(r)}</small></li>`).join("") || "<li>Tidak ada data</li>"}</ol>`;
}
function renderSenator(){
  const S = D.senator;
  if (!S){ $("snKpis").innerHTML = `<p class="note">File Dashboard Monitoring Senator belum ada di folder data.</p>`; return; }
  const rows = S.cab.filter(c => inArea(c[3])).map(SN_ROW);
  const t = k => sum(rows, r => r[k]);
  const uni = t("uni"), gold = t("gold"), cbg = t("cbg"), usak = t("usak");
  const g = gr(t("w2"), t("okt"));
  $("snKpis").innerHTML =
    kpi("Universe Senator", fN(uni), `${fN(rows.length)} cabang`) +
    kpi("Klaim Gold", fN(gold), `${fP(uni?gold/uni:0)} dari universe<br>${fN(uni-gold)} masih Blue`, "", uni?gold/uni:null) +
    kpi(`Klaim Gold ${S.plbl[3]||""}`, fN(t("w2")), `${growthTag(g)} dibanding ${S.plbl[1]||"bulan lalu"} (${fN(t("okt"))})`) +
    kpi("Akuisisi CBG", fN(cbg), `Sales volume YTD ${fRp(t("sv"))}`) +
    kpi("USAK LVM Senator", fN(usak), `${pctPlain(cbg?usak/cbg:null)} dari akuisisi CBG`, "", cbg?usak/cbg:null);

  chart("cSnProg", {labels:S.plbl, fmt:fN, series:[S_("Klaim Gold", [t("sep"), t("okt"), t("w1"), t("w2")], C.s4)]});
  const grp = {}; const key = AREA ? (r => r.nm) : (r => r.a);
  for (const r of rows){ const o = grp[key(r)] || (grp[key(r)] = {uni:0,gold:0,cbg:0,usak:0}); o.uni+=r.uni; o.gold+=r.gold; o.cbg+=r.cbg; o.usak+=r.usak; }
  let gl = Object.keys(grp);
  if (AREA) gl = gl.sort((x,y)=>grp[y].uni-grp[x].uni).slice(0,12); else gl.sort((x,y)=>(D.areas.indexOf(x)+1||99)-(D.areas.indexOf(y)+1||99));
  $("snAreaT").textContent = AREA ? `Klaim Gold dan USAK, 12 cabang universe terbesar ${title(AREA)}` : "Klaim Gold dan USAK per area";
  chart("cSnArea", {labels:gl.map(x => AREA ? x : title(x).replace("Area ","")), fmt:fP, values:fP, series:[
    S_("% klaim Gold", gl.map(x => grp[x].uni ? grp[x].gold/grp[x].uni : 0), C.s4), S_("% USAK", gl.map(x => grp[x].cbg ? grp[x].usak/grp[x].cbg : 0), C.s3)]});

  botList($("snBotGold"), "Klaim Gold terendah", rows.filter(r=>r.uni>0).sort((a,b)=>a.pg-b.pg).slice(0,10), r=>fP(r.pg), r=>`${fN(r.gold)} dari ${fN(r.uni)} universe`);
  botList($("snBotUsak"), "USAK Senator terendah", rows.filter(r=>r.cbg>0).sort((a,b)=>a.pu-b.pu).slice(0,10), r=>fP(r.pu), r=>`${fN(r.usak)} dari ${fN(r.cbg)} akuisisi CBG`);

  table($("tSnCab"), {csv:"senator_cabang", sort:"pg", dir:1, page:15, rows, rowKey:x=>x.kd, onRow:k => { $("snCab").value = k; $("snUniPanel").scrollIntoView({behavior:"smooth"}); renderSenatorUni(); }, cols:[
    {k:"a",l:"Area",f:a=>title(a).replace("Area ","")}, {k:"kl",l:"Kelas"}, {k:"kd",l:"Kode"}, {k:"nm",l:"Cabang"}, {k:"pic",l:"PIC"},
    {k:"uni",l:"Universe",num:1,f:fN}, {k:"gold",l:"Gold",num:1,f:fN}, {k:"pg",l:"% Gold",num:1,f:p=>pctPlain(p,.15)},
    {k:"okt",l:S.plbl[1]||"Bulan lalu",num:1,f:fN}, {k:"w2",l:S.plbl[3]||"Terakhir",num:1,f:fN},
    {k:"cbg",l:"Akuisisi CBG",num:1,f:fN}, {k:"usak",l:"USAK",num:1,f:fN}, {k:"pu",l:"% USAK",num:1,f:p=>pctPlain(p)}, {k:"sv",l:"SV YTD",num:1,f:fC}, {k:"fu",l:"Follow up",num:1,f:fN}],
    foot: r => { const s_ = k => sum(r,x=>x[k]); return ["","","","Total","",fN(s_("uni")),fN(s_("gold")),pctPlain(s_("uni")?s_("gold")/s_("uni"):null,.15),fN(s_("okt")),fN(s_("w2")),fN(s_("cbg")),fN(s_("usak")),pctPlain(s_("cbg")?s_("usak")/s_("cbg"):null),fC(s_("sv")),fN(s_("fu"))]; }});

  const sel = $("snCab"), cur = sel.value;
  sel.innerHTML = `<option value="">Semua cabang${AREA?` ${title(AREA)}`:""}</option>` + [...rows].sort((a,b)=>a.nm.localeCompare(b.nm)).map(r => `<option value="${r.kd}">${esc(r.nm)} (${r.kd})</option>`).join("");
  sel.value = rows.some(r => r.kd===cur) ? cur : "";
  renderSenatorUni();
  $("snNotes").innerHTML = `<h3>Catatan</h3><ol>${S.notes.map(n=>`<li>${esc(n)}</li>`).join("")}<li>Posisi data Senator ${esc(S.posisi)}${S.cbg?`; akuisisi CBG ${esc(S.cbg)}`:""}.</li></ol><p class="note">Sumber: ${esc(S.file)}</p>`;
}
async function renderSenatorUni(){
  const el = $("tSnUni");
  if (!BOX.senator){
    $("snUniInfo").textContent = "Menyiapkan daftar merchant universe…";
    try { await loadBox("senator"); } catch(e){ $("snUniInfo").textContent = "Daftar merchant universe belum tersedia."; return; }
    if (TAB !== "senator") return;
    $("snUniInfo").textContent = "Merchant di sekitar cabang. Klik nama untuk membuka lokasinya di Google Maps.";
  }
  const cab = $("snCab").value, st = $("snStat").value;
  const nm = Object.fromEntries(D.senator.cab.map(c => [c[0], c[1]])), ar = Object.fromEntries(D.senator.cab.map(c => [c[0], c[3]]));
  const rows = BOX.senator.u.filter(u => (cab ? u[1]===cab : inArea(ar[u[1]])) && (st==="" || String(u[2])===st))
    .map(u => ({nm:u[0], kd:u[1], cb:nm[u[1]]||u[1], g:u[2], ty:u[3], al:u[4], pid:u[5], mid:u[6]}));
  el._st = el._st && el._st.key === cab+"|"+st ? el._st : null;
  table(el, {csv:"universe_senator", sort:"g", dir:1, page:15, rows, cols:[
    {k:"nm",l:"Nama merchant",f:(v,x)=>x.pid?`<a class="map-a" href="https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(x.pid)}" target="_blank" rel="noopener">${esc(v)}</a>`:esc(v)},
    {k:"ty",l:"Jenis usaha"}, {k:"al",l:"Alamat",f:v=>`<span class="addr" title="${esc(v)}">${esc(v)}</span>`}, {k:"cb",l:"Cabang"},
    {k:"g",l:"Status",f:(v,x)=>v?`<span class="tag good">Gold</span>${x.mid?` <small class="muted">MID ${esc(x.mid)}</small>`:""}`:`<span class="tag mid">Blue</span>`}]});
  el._st.key = cab+"|"+st;
}

/* ================================================================== AKUISISI EDC */
function renderAkuisisi(){
  const Q = D.akuisisi;
  if (!Q){ $("aqKpis").innerHTML = `<p class="note">File Dashboard Akuisisi EDC belum ada di folder data.</p>`; return; }
  const kls = [...new Set(Q.cab.map(c => c[2]).filter(Boolean))].sort();
  const ks = $("aqKelas"), kv = ks.value;
  ks.innerHTML = `<option value="">Semua</option>` + kls.map(k => `<option>${esc(k)}</option>`).join(""); ks.value = kls.includes(kv) ? kv : "";
  const dt = new Date(Q.posisi), mi = isNaN(dt) ? Q.months.length-2 : dt.getMonth()+1;   // indeks bulan berjalan pada deret (0 = Des tahun lalu)
  const mName = Q.months[mi] || "MTD", dStr = isNaN(dt) ? Q.posisi : `${dt.getDate()} ${BLN[dt.getMonth()]} ${dt.getFullYear()}`;
  // cab: [kode, nama, kelas, area, months[13], nihilBln, mtdReg, mtdAob, mtd, tgtMtd, close, nett, tgtYtd, frek, sv, fbi, avbal, newCif]
  const rows = Q.cab.filter(c => inArea(c[3]) && (!ks.value || c[2]===ks.value)).map(c => ({kd:c[0], nm:c[1], kl:c[2]||"–", a:c[3], m:c[4], nb:c[5],
    reg:c[6], aob:c[7], mtd:c[8], tm:c[9], pm:c[9]?c[8]/c[9]:null, gm:c[8]-c[9], cl:c[10], net:c[11], ty:c[12], py:c[12]?c[11]/c[12]:null, gy:c[11]-c[12],
    gross:c[4].slice(1, mi+1).reduce((x,y)=>x+y,0), fr:c[13], sv:c[14], fbi:c[15], cif:c[17]}));
  const t = k => sum(rows, r => r[k]);
  const nihil = rows.filter(r => r.mtd === 0);
  $("aqKpis").innerHTML =
    kpi(`Akuisisi MTD ${mName}`, fN(t("mtd")), `${pctHtml(t("tm")?t("mtd")/t("tm"):null)} dari target ${fN(t("tm"))}<br>GAP ${fN(t("mtd")-t("tm"))}`, "", t("tm")?t("mtd")/t("tm"):null) +
    kpi("Nett akuisisi YTD", fN(t("net")), `${pctHtml(t("ty")?t("net")/t("ty"):null)} dari target ${fN(t("ty"))}<br>GAP ${fN(t("net")-t("ty"))}`, "", t("ty")?t("net")/t("ty"):null) +
    kpi("Akuisisi YTD (gross)", fN(t("gross")), `${fN(t("cl"))} EDC close YTD`) +
    kpi("Sales volume YTD", fRp(t("sv")), `FBI YTD ${fRp(t("fbi"))}`) +
    kpi("Cabang nihil MTD", fN(nihil.length), `dari ${fN(rows.length)} cabang`);

  const labels = Q.months.slice(0, mi+1);
  chart("cAqMon", {labels, fmt:fN, series:[S_("Akuisisi", labels.map((_,i) => sum(rows, r => r.m[i])), labels.map((_,i)=> i===mi ? C.s2 : i===0 ? C.prev : C.s1))]});
  const grp = {}; const key = AREA ? (r => r.nm) : (r => r.a);
  for (const r of rows){ const o = grp[key(r)] || (grp[key(r)] = {m:0,t:0}); o.m += r.mtd; o.t += r.tm; }
  let gl = Object.keys(grp);
  if (AREA) gl = gl.sort((x,y)=>grp[y].t-grp[x].t).slice(0,12); else gl.sort((x,y)=>(D.areas.indexOf(x)+1||99)-(D.areas.indexOf(y)+1||99));
  $("aqAreaT").textContent = AREA ? `Akuisisi MTD, 12 cabang target terbesar ${title(AREA)}` : "Akuisisi MTD per area";
  chart("cAqArea", {labels:gl.map(x => AREA ? x : title(x).replace("Area ","")), fmt:fN, series:[S_("Target MTD", gl.map(x=>grp[x].t), C.prev), S_("Akuisisi MTD", gl.map(x=>grp[x].m), C.s1)]});

  const byK = {}; for (const r of rows) (byK[r.kl] || (byK[r.kl] = [])).push(r);
  const kk = Object.keys(byK).sort();
  const line = r => `<li><span>${esc(r.kl)} · ${esc(r.nm)}</span><b class="${pctCls(r.pm)}">${fP(r.pm)}</b><small>${fN(r.mtd)} dari target ${fN(r.tm)}, GAP ${fN(r.gm)}</small></li>`;
  const ord = (a,b) => (a.pm??-1)-(b.pm??-1) || a.mtd-b.mtd;
  $("aqKelasBox").innerHTML =
    `<div class="bot"><h4>Tertinggi per kelas</h4><ol class="nonum">${kk.map(k => line([...byK[k]].sort(ord).pop())).join("")}</ol></div>` +
    `<div class="bot"><h4>Terendah per kelas</h4><ol class="nonum">${kk.map(k => line([...byK[k]].sort(ord)[0])).join("")}</ol></div>`;

  const n3 = rows.filter(r => mi >= 3 && r.m[mi]===0 && r.m[mi-1]===0 && r.m[mi-2]===0);
  $("aqNihilP").textContent = `Posisi ${dStr}`;
  const chip = r => `<li><span>${esc(r.nm)}</span><b>${esc(r.kl)}</b><small>${title(r.a)}</small></li>`;
  $("aqNihil").innerHTML = `<div class="bot"><h4>Nihil MTD ${esc(mName)} (${nihil.length})</h4><ol class="nonum cols2">${nihil.map(chip).join("") || "<li>Tidak ada</li>"}</ol></div>` +
    `<div class="bot"><h4>Nihil 3 bulan terakhir, ${esc(Q.months[mi-2]||"")}–${esc(mName)} (${n3.length})</h4><ol class="nonum cols2">${n3.map(chip).join("") || "<li>Tidak ada</li>"}</ol></div>`;

  table($("tAqCab"), {csv:"akuisisi_edc_cabang", sort:"pm", page:20, rows, cols:[
    {k:"a",l:"Area",f:a=>title(a).replace("Area ","")}, {k:"kl",l:"Kelas"}, {k:"kd",l:"Kode"}, {k:"nm",l:"Cabang"},
    {k:"reg",l:"MTD Reg",num:1,f:fN}, {k:"aob",l:"MTD AOB",num:1,f:fN}, {k:"mtd",l:"MTD",num:1,f:fN}, {k:"tm",l:"Target MTD",num:1,f:fN}, {k:"pm",l:"% MTD",num:1,f:pctHtml}, {k:"gm",l:"GAP MTD",num:1,f:v=>`<b class="${v>=0?"good":"bad"}">${fN(v)}</b>`},
    {k:"net",l:"Nett YTD",num:1,f:fN}, {k:"ty",l:"Target YTD",num:1,f:fN}, {k:"py",l:"% YTD",num:1,f:pctHtml}, {k:"cl",l:"Close YTD",num:1,f:fN},
    {k:"sv",l:"SV YTD",num:1,f:fC}, {k:"cif",l:"New CIF",num:1,f:fN}],
    foot: r => { const s_ = k => sum(r,x=>x[k]); return ["","","","Total",fN(s_("reg")),fN(s_("aob")),fN(s_("mtd")),fN(s_("tm")),pctHtml(s_("tm")?s_("mtd")/s_("tm"):null),fN(s_("mtd")-s_("tm")),fN(s_("net")),fN(s_("ty")),pctHtml(s_("ty")?s_("net")/s_("ty"):null),fN(s_("cl")),fC(s_("sv")),fN(s_("cif"))]; }});
}


/* ------------------------------------------------------------------ Ringkasan KPI (Overview) */
let KC_PROD = "edc", KC_LAST = null;
const kcBadge = (c, p, unit="%") => {            // pertumbuhan YoY -> {cls, txt}
  if (unit === "pp"){ if (c==null || p==null) return null; const d = (c-p)*100; return {cls:d>=0?"up":"down", txt:`${d>=0?"▲":"▼"} ${d>=0?"+":""}${d.toLocaleString("id-ID",{minimumFractionDigits:2,maximumFractionDigits:2})} pp YoY`}; }
  const g = gr(c,p); return g==null ? null : {cls:g>=0?"up":"down", txt:`${g>=0?"▲":"▼"} ${fP(Math.abs(g))} YoY`};
};
const kcTgt = (c, t) => { const p = t ? c/t : null; return p==null ? null : {cls:p>=1?"up":p>=.8?"mid":"down", txt:`${fP(p)} dari target`}; };
const fNum = v => fC(v).replace(/^Rp\s*/,"");
// rincian per kategori untuk kartu KPI: rows = [{k, ...nilai}], fv = format nilai, fb = badge
function kcBreak(groups, val, fmt, badge, limit=7){
  let list = Object.entries(groups).map(([k,o]) => ({k, o, v:val(o)})).filter(x => x.v != null && isFinite(x.v) && (x.v || (badge && badge(x.o))));
  list.sort((x,y) => y.v - x.v);
  return list.slice(0, limit).map(x => ({l:title(x.k), v:fmt(x.v), b:badge ? badge(x.o) : null}));
}
const kcShort = b => b ? {cls:b.cls, txt:b.txt.replace(" YoY","").replace(" dari target","")} : null;
function kpiCardsData(){
  const E = D.edc, A = D.atm, W = `W${E.week} ${E.year}`;
  const scope = AREA ? title(AREA) : "Region XI";
  if (KC_PROD === "edc"){
    const s = edcSummary(AREA), I = Object.fromEntries(E.cols.map((c,i)=>[c,i]));
    const seg = {};
    for (const r of E.cube) if (!AREA || r[0]===AREA){ const o = seg[r[2]] || (seg[r[2]] = {}); for (const k of ["sv","svp","tx","txp","md","mdp","fd","fdp","merch","edc"]) o[k] = (o[k]||0) + r[I[k]]; }
    const B = (val, fmt, cur, prev, unit) => kcBreak(seg, val, fmt, cur ? (o => kcShort(kcBadge(cur(o), prev(o), unit))) : null);
    const fj = {}; for (const [a,j,v,vp,n,nf] of E.fundj || []) if (!AREA || a===AREA){ const o = fj[j] || (fj[j] = {v:0,vp:0,n:0,nf:0}); o.v+=v; o.vp+=vp; o.n+=n||0; o.nf+=nf||0; }
    const fts = s.sv ? s.fd/(s.sv*52/E.week) : null, ftsp = s.svp ? s.fdp/(s.svp*52/E.week) : null;
    const rows = Object.values(E.nrows || {}).length ? (AREA ? (E.nrows[AREA]||0) : sum(Object.values(E.nrows), v=>v)) : null;
    const tk = s.tx ? s.sv/s.tx : 0, tkp = s.txp ? s.svp/s.txp : 0, mdr = s.sv ? s.md/s.sv : null, mdrp = s.svp ? s.mdp/s.svp : null;
    const pct2 = v => (v*100).toLocaleString("id-ID",{minimumFractionDigits:2,maximumFractionDigits:2})+"%";
    const nRek = sum(Object.values(fj), o=>o.n);
    return {info:`${rows!=null?fN(rows)+" baris rekening, ":""}${scope}`, file:`ringkasan_kpi_echannel_${W.replace(" ","_")}`, cards:[
      {l:"Total sales volume", v:fNum(s.sv), sub:`YTD ${W}`, b:kcBadge(s.sv,s.svp), lt:"Per segmen", list:B(o=>o.sv, fNum, o=>o.sv, o=>o.svp)},
      {l:"Total frekuensi", v:fNum(s.tx), sub:`YTD ${W}`, b:kcBadge(s.tx,s.txp), lt:"Per segmen", list:B(o=>o.tx, fNum, o=>o.tx, o=>o.txp)},
      {l:"Total fee based income", v:fNum(s.md), sub:`YTD ${W} (MDFG)`, b:kcBadge(s.md,s.mdp), lt:"Per segmen", list:B(o=>o.md, fNum, o=>o.md, o=>o.mdp)},
      {l:"Total average balance", v:fNum(s.fd), sub:`Posisi ${W}, Count For Funding = 1. FTS ${fP(fts)} (${ftsp!=null?((fts-ftsp)*100>=0?"+":"")+((fts-ftsp)*100).toLocaleString("id-ID",{maximumFractionDigits:2})+" pp YoY":"–"})`, b:kcBadge(s.fd,s.fdp),
       lt:"Per jenis rekening", tbl:{h:["Jenis","Rek.","Saldo","YoY"], rows:Object.entries(fj).filter(([,o])=>o.v||o.vp||o.n).sort((x,y)=>y[1].v-x[1].v)
         .map(([j,o]) => [j, fN(o.n), fNum(o.v), kcShort(kcBadge(o.v,o.vp))]),
         note:`Total ${fN(nRek)} rekening (Count For Funding = 1), ${fN(sum(Object.values(fj),o=>o.nf))} di antaranya bersaldo. Rata-rata ${fNum(nRek ? s.fd/nRek : 0)} per rekening.`}},
      {l:"Merchant aktif (MID)", v:fN(s.merch), sub:`Snapshot ${W}, merch = 1`, lt:"Per segmen", list:B(o=>o.merch, fN)},
      {l:"Jumlah EDC", v:fN(s.edc), sub:`Snapshot ${W}`, lt:"Per segmen", list:B(o=>o.edc, fN)},
      {l:"Average ticket size", v:"Rp "+fN(Math.round(tk)), sub:`YTD ${W}, SV ÷ frekuensi`, b:kcBadge(tk,tkp), lt:"Per segmen (Rp)", list:B(o=>o.tx?o.sv/o.tx:null, v=>fN(Math.round(v)), o=>o.tx?o.sv/o.tx:null, o=>o.txp?o.svp/o.txp:null)},
      {l:"MDR blended", v:mdr==null?"–":pct2(mdr), sub:`YTD ${W}, FBI ÷ SV`, b:kcBadge(mdr,mdrp,"pp"), lt:"Per segmen", list:B(o=>o.sv?o.md/o.sv:null, pct2, o=>o.sv?o.md/o.sv:null, o=>o.svp?o.mdp/o.svp:null, "pp")}]};
  }
  if (KC_PROD === "atm"){
    const s = atmSummary(AREA), P = `Jan–${BLN[A.last]} ${A.year}`, n = A.last+1;
    const ms = A.machines.filter(m => !AREA || m.a===AREA), pv = A.prev.filter(p => !AREA || p.a===AREA);
    const grp = (key) => { const g = {};
      for (const m of ms){ const o = g[m[key]||"Lainnya"] || (g[m[key]||"Lainnya"] = {n:0,t:0,v:0,f:0,vs:0,ts:0,tp:0,vp:0,fp:0}); o.n++; o.t+=mYtd(m,"t"); o.v+=mYtd(m,"v"); o.f+=mYtd(m,"f"); o.vs+=mYtd(m,"vs"); o.ts+=mYtd(m,"ts"); }
      for (const p of pv){ const o = g[p[key]||"Lainnya"] || (g[p[key]||"Lainnya"] = {n:0,t:0,v:0,f:0,vs:0,ts:0,tp:0,vp:0,fp:0}); o.tp+=ytd(p.t,n); o.vp+=ytd(p.v,n); o.fp+=ytd(p.f,n); }
      return g; };
    const gl = grp("g"), gj = grp("j");
    const yb = (c,p) => o => kcShort(kcBadge(c(o), p(o)));
    const tk = s.t ? s.v/s.t : 0, tkp = s.tp ? s.vp/s.tp : 0;
    const keep = t => x => ({...x, l:t(x.l)});
    const up = l => l.length <= 4 ? l.toUpperCase() : l;
    return {info:`${fN(s.n)} mesin, ${scope}`, file:`ringkasan_kpi_atm_${A.year}_${A.last+1}`, cards:[
      {l:"Total transaksi", v:fNum(s.t), sub:`YTD ${P}`, b:kcBadge(s.t,s.tp), lt:"Per lokasi", list:kcBreak(gl, o=>o.t, fNum, yb(o=>o.t,o=>o.tp))},
      {l:"Total volume transaksi", v:fNum(s.v), sub:`YTD ${P}`, b:kcBadge(s.v,s.vp), lt:"Per lokasi", list:kcBreak(gl, o=>o.v, fNum, yb(o=>o.v,o=>o.vp))},
      {l:"Total fee based income", v:fNum(s.f), sub:`YTD ${P}`, b:kcBadge(s.f,s.fp), lt:"Per lokasi", list:kcBreak(gl, o=>o.f, fNum, yb(o=>o.f,o=>o.fp))},
      {l:"Volume setor tunai", v:fNum(s.vs), sub:`YTD ${P}, ${fC(s.ts)} transaksi setor`, lt:"Per lokasi", list:kcBreak(gl, o=>o.vs, fNum)},
      {l:"Jumlah mesin", v:fN(s.n), sub:`Posisi ${BLN[A.last]} ${A.year}`, lt:"Per jenis dan lokasi", list:[...kcBreak(gj, o=>o.n, fN).map(keep(up)), ...kcBreak(gl, o=>o.n, fN)]},
      {l:"Rata-rata nominal per transaksi", v:"Rp "+fN(Math.round(tk)), sub:`YTD ${P}, volume ÷ transaksi`, b:kcBadge(tk,tkp), lt:"Per jenis mesin (Rp)", list:kcBreak(gj, o=>o.t?o.v/o.t:null, v=>fN(Math.round(v)), yb(o=>o.t?o.v/o.t:null, o=>o.tp?o.vp/o.tp:null)).map(keep(up))},
      {l:"Transaksi per mesin per bulan", v:fN(Math.round(s.n ? s.t/s.n/n : 0)), sub:`Rata-rata ${P}`, lt:"Per jenis mesin", list:kcBreak(gj, o=>o.n?o.t/o.n/n:null, v=>fN(Math.round(v))).map(keep(up))},
      {l:"FBI per mesin", v:fNum(s.n ? s.f/s.n : 0), sub:`YTD ${P}`, lt:"Per jenis mesin", list:kcBreak(gj, o=>o.n?o.f/o.n:null, fNum).map(keep(up))}]};
  }
  const s = lvmSummary(AREA), {y,m,d} = lvmDate(), asof = `${d} ${BLN[m-1]} ${y}`;
  const rows = D.lvm.cube.filter(r => !AREA || r[0]===AREA);
  const byG = {}; for (const r of rows){ (byG[r[2]] || (byG[r[2]] = [])).push(r); }
  const gr_ = Object.fromEntries(Object.entries(byG).map(([k,v]) => [k, lvmAgg(v)]));
  const byK = {}; for (const r of rows){ const k = KELAS[r[1]] || "Lainnya"; (byK[k] || (byK[k] = {rows:[], codes:new Set()})); byK[k].rows.push(r); byK[k].codes.add(r[1]); }
  const kl = Object.fromEntries(Object.entries(byK).map(([k,v]) => [k, {...lvmAgg(v.rows), t:tgtFor([...v.codes].filter(c => D.targets[c]))}]));
  const kOrd = list => list.sort((a,b) => a.l.localeCompare(b.l));
  const kT = (val, tg) => kOrd(Object.entries(kl).map(([k,o]) => ({l:k, v:fN(val(o)), b:kcShort(kcTgt(val(o), tg(o)))})));
  const G = val => kcBreak(gr_, val, fNum);
  return {info:`${fN(s.n)} merchant terdaftar, ${scope}`, file:`ringkasan_kpi_lvm_${y}_${m}_${d}`, cards:[
    {l:"Merchant terdaftar", v:fN(s.n), sub:`Posisi ${asof}`, lt:"Per grading transaksi", list:kcBreak(gr_, o=>o.n, fN)},
    {l:"Merchant aktif bertransaksi", v:fN(s.act), sub:`${fP(s.n?s.act/s.n:0)} dari merchant terdaftar`, lt:"Per grading transaksi", list:kcBreak(gr_, o=>o.act, fN)},
    {l:"Akuisisi YTD", v:fN(s.akY), sub:`Target s.d. ${asof}: ${fN(s.tgt.akYtd)}`, b:kcTgt(s.akY, s.tgt.akYtd), lt:"Per kelas cabang, pencapaian target", list:kT(o=>o.akY, o=>o.t.akYtd)},
    {l:`Akuisisi MTD ${BLN[m-1]}`, v:fN(s.akM), sub:`Target s.d. ${asof}: ${fN(s.tgt.akMtdP)}`, b:kcTgt(s.akM, s.tgt.akMtdP), lt:"Per kelas cabang, pencapaian target", list:kT(o=>o.akM, o=>o.t.akMtdP)},
    {l:"Merchant USAK", v:fN(s.usak), sub:`Target ${fN(s.tgt.usak)}`, b:kcTgt(s.usak, s.tgt.usak), lt:"Per kelas cabang, pencapaian target", list:kT(o=>o.usak, o=>o.t.usak)},
    {l:"Total sales volume", v:fNum(s.svy), sub:`YTD, MTD ${BLN[m-1]} ${fNum(s.svm)}`, lt:"Per grading transaksi", list:G(o=>o.svy)},
    {l:"Total fee based income", v:fNum(s.fby), sub:`YTD, MTD ${BLN[m-1]} ${fNum(s.fbm)}`, lt:"Per grading transaksi", list:G(o=>o.fby)},
    {l:"Avg balance tabungan", v:fNum(s.bal), sub:`${fN(s.cls)} rekening merchant closed`, lt:"Per grading transaksi", list:G(o=>o.bal)}]};
}
function renderKpiCards(){
  const K = KC_LAST = kpiCardsData();
  $("kcInfo").textContent = K.info;
  document.querySelectorAll("#kcProd button").forEach(b => { b.classList.toggle("on", b.dataset.p===KC_PROD); b.setAttribute("aria-selected", b.dataset.p===KC_PROD); });
  const badge = b => b ? `<span class="kc-b ${b.cls}">${esc(b.txt)}</span>` : "";
  const mini = b => b ? `<i class="${b.cls}">${esc(b.txt)}</i>` : "<i></i>";
  $("kcGrid").innerHTML = K.cards.map(c => `<div class="kc">
      <div class="kc-l">${esc(c.l)}</div><div class="kc-v">${esc(c.v)}</div><div class="kc-s">${esc(c.sub||"")}</div>${badge(c.b)}
      ${c.list && c.list.length ? `<div class="kc-list"><div class="kc-lt">${esc(c.lt||"")}</div>${c.list.map(x=>`<div><span title="${esc(x.l)}">${esc(x.l)}</span><b>${esc(x.v)}</b>${mini(x.b)}</div>`).join("")}</div>` : ""}
      ${c.tbl ? `<div class="kc-list"><div class="kc-lt">${esc(c.lt||"")}</div><table class="kc-tbl"><thead><tr>${c.tbl.h.map((h,i)=>`<th${i?' class="n"':""}>${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>${c.tbl.rows.map(r=>`<tr><td>${esc(r[0])}</td><td class="n">${esc(r[1])}</td><td class="n"><b>${esc(r[2])}</b></td><td class="n">${mini(r[3])}</td></tr>`).join("")}</tbody></table>
        ${c.tbl.note?`<div class="kc-note">${esc(c.tbl.note)}</div>`:""}</div>` : ""}
    </div>`).join("");
}
function kcDownloadXls(){
  const K = KC_LAST; if (!K) return;
  const rows = [["Indikator","Nilai","Keterangan","Perubahan"]];
  for (const c of K.cards){ rows.push([c.l, c.v, c.sub||"", c.b?c.b.txt:""]);
    for (const x of c.list||[]) rows.push(["   "+(c.lt||"")+": "+x.l, x.v, "", x.b?x.b.txt:""]);
    if (c.tbl) for (const r of c.tbl.rows) rows.push(["   "+r[0], r[2], `${r[1]} rekening`, r[3]?r[3].txt:""]); }
  const html = `<html><head><meta charset="utf-8"></head><body><table border="1"><caption>Ringkasan KPI, ${esc(K.info)}</caption>${rows.map((r,i)=>`<tr>${r.map(v=>i?`<td>${esc(v)}</td>`:`<th>${esc(v)}</th>`).join("")}</tr>`).join("")}</table></body></html>`;
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([html], {type:"application/vnd.ms-excel"})); a.download = K.file + ".xls"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function kcDownloadPng(){
  const K = KC_LAST; if (!K) return;
  const cols = 4, cw = 330, gap = 16, pad = 24, rowsN = Math.ceil(K.cards.length/cols);
  const items = c => c.tbl ? c.tbl.rows.map(r => ({l:`${r[0]} (${r[1]} rek.)`, v:r[2], b:r[3]})) : (c.list || []);
  const ch = c => 166 + (items(c).length ? items(c).length*22 + 36 : 0);
  const rowH = Array.from({length:rowsN}, (_,r) => Math.max(...K.cards.slice(r*cols, r*cols+cols).map(ch)));
  const W = pad*2 + cols*cw + (cols-1)*gap, H = pad*2 + 50 + rowH.reduce((a,b)=>a+b+gap, 0), sc = 2;
  const cv = document.createElement("canvas"); cv.width = W*sc; cv.height = H*sc; const g = cv.getContext("2d"); g.scale(sc, sc);
  const F = getComputedStyle(document.body).fontFamily || "sans-serif";
  g.fillStyle = "#ffffff"; g.fillRect(0,0,W,H);
  g.fillStyle = "#0e2a47"; g.font = `700 18px ${F}`; g.fillText("Ringkasan KPI", pad, pad+16);
  g.fillStyle = "#4f5d6b"; g.font = `13px ${F}`; g.fillText(`${{edc:"e-Channel",atm:"ATM & CRM",lvm:"Livin' Merchant"}[KC_PROD]}, ${K.info}`, pad, pad+38);
  const rr = (x,y,w,h,r) => { g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); };
  let y0 = pad + 56;
  K.cards.forEach((c,i) => {
    const col = i % cols, row = Math.floor(i/cols); if (col===0 && row>0) y0 += rowH[row-1] + gap;
    const x = pad + col*(cw+gap), h = rowH[row];
    rr(x,y0,cw,h,12); g.fillStyle="#fff"; g.fill(); g.strokeStyle="#dfe4ea"; g.lineWidth=1; g.stroke();
    const gr_ = g.createLinearGradient(0,y0,0,y0+h); gr_.addColorStop(0,"#f5b800"); gr_.addColorStop(1,"#0e2a47"); g.fillStyle = gr_; g.fillRect(x, y0+6, 4, h-12);
    g.fillStyle="#4f5d6b"; g.font=`700 12px ${F}`; g.fillText(c.l.toUpperCase(), x+22, y0+30);
    g.fillStyle="#0e2a47"; g.font=`800 26px ${F}`; g.fillText(c.v, x+22, y0+66);
    g.fillStyle="#8693a0"; g.font=`12px ${F}`;
    const lines = []; let cur = "";
    for (const w of String(c.sub||"").split(" ")){ const t = cur ? cur+" "+w : w; if (g.measureText(t).width > cw-44 && cur){ lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    lines.slice(0,2).forEach((ln,k) => g.fillText(k===1 && lines.length>2 ? ln+"…" : ln, x+22, y0+90+k*16));
    const by = y0 + 104 + (Math.min(lines.length,2)-1)*16;
    if (c.b){ g.font=`700 12px ${F}`; const tw = g.measureText(c.b.txt).width + 18; rr(x+22, by, tw, 24, 12);
      g.fillStyle = c.b.cls==="up" ? "#e3f3e8" : c.b.cls==="mid" ? "#fdf1d3" : "#fbe4e3"; g.fill();
      g.fillStyle = c.b.cls==="up" ? "#0c7a3e" : c.b.cls==="mid" ? "#8a5a00" : "#b42a2a"; g.fillText(c.b.txt, x+31, by+16); }
    const its = items(c);
    if (its.length){ g.strokeStyle="#dfe4ea"; g.setLineDash([3,3]); g.beginPath(); g.moveTo(x+22, y0+150); g.lineTo(x+cw-22, y0+150); g.stroke(); g.setLineDash([]);
      g.font=`700 11px ${F}`; g.fillStyle="#8693a0"; g.fillText((c.lt||"").toUpperCase(), x+22, y0+170); }
    its.forEach((it,j) => { const yy = y0 + 194 + j*22; g.font=`13px ${F}`; g.fillStyle="#4f5d6b";
      let lb = it.l; while (g.measureText(lb).width > 150 && lb.length > 3) lb = lb.slice(0,-2); g.fillText(lb + (lb!==it.l?"…":""), x+22, yy);
      g.font=`700 13px ${F}`; g.fillStyle="#0e2a47"; const vw = g.measureText(it.v).width; g.fillText(it.v, x+cw-110-vw, yy);
      if (it.b){ const t = it.b.txt; g.font=`700 12px ${F}`; g.fillStyle = it.b.cls==="up" ? "#0c7a3e" : it.b.cls==="mid" ? "#8a5a00" : "#b42a2a"; g.fillText(t, x+cw-22-g.measureText(t).width, yy); } });
  });
  cv.toBlob(bl => { const a = document.createElement("a"); a.href = URL.createObjectURL(bl); a.download = K.file + ".png"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
}
$("kcProd").addEventListener("click", e => { const b = e.target.closest("button[data-p]"); if (!b) return; KC_PROD = b.dataset.p; renderKpiCards(); });
$("kcXls").addEventListener("click", kcDownloadXls);
$("kcPng").addEventListener("click", kcDownloadPng);

const RENDER = {ringkasan:renderSummary, atm:renderATM, edc:renderEDC, lvm:renderLVM, cabang:renderCabang, merchant:renderMerchant, users:renderUsers, wpr:renderWPR, duta:renderDuta, usak:renderUsak, senator:renderSenator, akuisisi:renderAkuisisi};
let TAB = "ringkasan";
const TITLES = {ringkasan:"Overview", atm:"ATM & CRM", edc:"EDC Merchant", lvm:"Livin' Merchant", cabang:"Scorecard cabang", merchant:"Pencarian", users:"Kelola pengguna", wpr:"Weekly Performance Report", duta:"Dashboard GMM Duta Transaksi", usak:"Dashboard GMM USAK Livin' Merchant Fase 3", senator:"Dashboard Monitoring Senator", akuisisi:"Dashboard Akuisisi EDC"};
const PARENT = {duta:"ringkasan", usak:"lvm"};        // halaman turunan: tidak punya menu sendiri
function subTitle(){
  if (USER.lim) return `Cari merchant e-Channel atau Livin' Merchant, lalu lihat performance lengkapnya`;
  const {y,m,d} = lvmDate();
  return {
    ringkasan:`Kinerja Transaction Banking Retail Region XI: ATM & CRM, e-Channel, dan Livin' Merchant`,
    atm:`Januari–${BLN[D.atm.last]} ${D.atm.year}, dibanding periode yang sama ${D.atm.year-1}`,
    edc:`Year to date minggu ${D.edc.week} ${D.edc.year}, dibanding minggu yang sama ${D.edc.year-1}`,
    lvm:`Data sampai ${d} ${BLN[m-1]} ${y}`,
    cabang:`ATM ${BLN[D.atm.last]}, EDC minggu ${D.edc.week}, Livin' Merchant ${d} ${BLN[m-1]} ${y}`,
    merchant: USER.lim ? `Cari merchant e-Channel atau Livin' Merchant, lalu lihat performance lengkapnya` : `Cari merchant e-Channel, Livin' Merchant, atau mesin ATM, lalu lihat performance lengkapnya`,
    users:`Setujui pendaftaran, atur akses area, dan nonaktifkan akun`,
    duta: D.duta ? `Region XI Bali & Nusra, posisi ${D.duta.asof}${D.duta.since?`, dihitung sejak ${D.duta.since}`:""}` : "",
    usak: D.usak ? `Akuisisi Livin' Merchant oleh pegawai${D.usak.period?`, ${D.usak.period}`:""}${D.usak.asof && !D.usak.period.endsWith(D.usak.asof)?`, posisi USAK ${D.usak.asof}`:""}` : "",
    senator: D.senator ? `Region XI Bali & Nusra, posisi ${D.senator.posisi} (tarikan EDA)` : "",
    akuisisi: D.akuisisi ? `Akuisisi new merchant EDC channel cabang (mass retail), posisi ${(() => { const d = new Date(D.akuisisi.posisi); return isNaN(d) ? D.akuisisi.posisi : d.getDate()+" "+BLN[d.getMonth()]+" "+d.getFullYear(); })()}` : "",
    wpr: D.wpr ? `Merchant e-Channel, minggu ke-${D.wpr.weeks[0]} sampai ${D.wpr.weeks[D.wpr.weeks.length-1]} ${D.wpr.year} dan year to date. Sumber: ${D.wpr.file}` : ""}[TAB];
}
function renderTab(){
  const hb = {lvm: D.usak ? `<button class="head-btn" data-go="usak">Dashboard USAK</button>` : ""}[TAB] || "";
  $("headBtn").innerHTML = hb; $("headBtn").querySelectorAll("[data-go]").forEach(b => b.onclick = () => goTab(b.dataset.go));
  $("pageTitle").textContent = TAB === "edc" ? `Merchant W${D.edc.week} ${D.edc.year}` : TAB === "wpr" && D.wpr ? `WPR W${D.wpr.weeks[D.wpr.weeks.length-1]} ${D.wpr.year}` : TITLES[TAB]; $("pageSub").textContent = subTitle();
  try { RENDER[TAB](); } catch(e){ console.error(e); }
}
function goTab(t){
  if (USER.lim) t = "merchant";
  TAB = t;
  document.querySelectorAll("#tabs button[data-tab]").forEach(x => x.classList.toggle("active", x.dataset.tab===t));
  if (["duta","usak","senator","akuisisi"].includes(t)) setWeekly(true);
  document.querySelectorAll(".tab").forEach(s => s.hidden = s.id !== "tab-"+t);
  window.scrollTo(0,0); renderTab();
}
function renderPills(scope){
  const list = scope ? [scope] : ["", ...D.areas];
  $("areaPills").innerHTML = list.map(a => `<button data-a="${a}" class="${a===AREA?"on":""}" ${scope?"disabled":""}>${a ? title(a).replace("Area ","") : "Region XI"}</button>`).join("");
  $("areaPills").querySelectorAll("button").forEach(b => b.onclick = () => { if (scope) return; AREA = b.dataset.a; renderPills(scope); renderTab(); });
}
function start(){
  const lim = USER.lim;
  const ORD = ["AREA DENPASAR","AREA KUTA","AREA MATARAM","AREA KUPANG"];
  D.areas.sort((x,y) => (ORD.indexOf(x)+1||99) - (ORD.indexOf(y)+1||99));
  const scope = USER.akses && USER.akses !== "REGION" ? USER.akses : "";
  if (scope) AREA = scope; else if (!D.areas.includes(AREA)) AREA = "";
  renderPills(scope);
  document.querySelectorAll("#tabs button").forEach(b => b.hidden = lim && b.dataset.tab !== "merchant");
  if (!lim){
    prep();
    opts($("edcSeg"), [...new Set(D.edc.cube.map(r=>r[2]))].sort());
    opts($("edcLob"), [...new Set(D.edc.cube.map(r=>r[3]))].sort());
    opts($("edcTipe"), [...new Set(D.edc.cube.map(r=>r[4]))].filter(v=>v!=="-").sort());
    opts($("lvmKelas"), [...new Set(Object.values(KELAS))].sort());
    $("navEdc").innerHTML = `<i class="dot d-edc"></i>Merchant W${D.edc.week}`;
    $("navWpr").hidden = !D.wpr;
    $("navDuta").hidden = !D.duta; $("navUsak").hidden = !D.usak; $("navSenator").hidden = !D.senator; $("navAkq").hidden = !D.akuisisi;
    if (D.wpr) $("navWpr").innerHTML = `<i class="dot d-wpr"></i>WPR W${D.wpr.weeks[D.wpr.weeks.length-1]} ${D.wpr.year}`;
  }
  $("userLine").textContent = USER.nama;
  $("roleLine").textContent = [lim ? LIMITED_ROLES[USER.role] : USER.jabatan, USER.unit].filter(Boolean).join(", ");
  $("meFoto").outerHTML = avatarHtml(USER.foto, USER.nama, "sm").replace('class="avatar sm"', 'class="avatar sm" id="meFoto"');
  $("navUsers").hidden = USER.role !== "admin";
  $("navWeekly").hidden = lim || !(D.duta || D.usak || D.senator || D.akuisisi);
  if (USER.role === "admin") loadUsers().catch(e => console.warn(e));
  else if (TAB === "users") TAB = "ringkasan";
  if (lim) { TAB = "merchant"; MS.sel = null; }
  $("footLine").textContent = `Data diperbarui ${D.generated}`;
  $("footLine").title = "Sumber: " + Object.values(D.sources).filter(Boolean).join(", ");
  $("login").hidden = true; $("app").hidden = false;
  goTab(TAB);
}
function setWeekly(open){
  $("navWeekly").classList.toggle("open", open);
  $("navWeeklyBtn").setAttribute("aria-expanded", open ? "true" : "false");
}
$("navWeeklyBtn").addEventListener("click", () => setWeekly(!$("navWeekly").classList.contains("open")));
$("tabs").addEventListener("click", e => { const b = e.target.closest("button[data-tab]"); if (b) goTab(b.dataset.tab); });
["atmJenis","atmGroup","atmMetric","edcSeg","edcLob","edcTipe","lvmKelas"].forEach(id => $(id).addEventListener("change", renderTab));
$("lobArea").addEventListener("change", () => { $("lobCab").value = ""; renderEdcLob(); });
$("edcRankCab").addEventListener("change", renderEdcRank);
$("lvmUsakCab").addEventListener("change", renderLvmUsak);
["dtStat","usCab","usPrio","aqKelas"].forEach(id => $(id).addEventListener("change", renderTab));
["snCab","snStat"].forEach(id => $(id).addEventListener("change", renderSenatorUni));
$("ovEdcSeg").addEventListener("change", renderOvDrops);
["wSeg","wEnv"].forEach(id => $(id).addEventListener("change", () => { $("wCab").value = ""; renderWPR(); }));
$("wCab").addEventListener("change", renderWPR);
$("lobCab").addEventListener("change", renderEdcLob);
let msT; $("msQ").addEventListener("input", () => { clearTimeout(msT); msT = setTimeout(() => { MS.sel = null; MS.page = 0; msSearch(); }, 200); });
$("msField").addEventListener("change", () => { MS.sel = null; MS.page = 0; msSearch(); $("msQ").focus(); });
const toTop = $("toTop");
window.addEventListener("scroll", () => { toTop.classList.toggle("show", window.scrollY > 500); }, {passive:true});
toTop.addEventListener("click", () => window.scrollTo({top:0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"}));
})();
