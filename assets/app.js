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

/* ------------------------------------------------------------------ crypto */
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function unlock(code){
  const enc = await fetch("data/data.enc.json?t="+Date.now(),{cache:"no-store"}).then(r=>{ if(!r.ok) throw new Error("Data tidak ditemukan"); return r.json(); });
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
  const kek = await crypto.subtle.deriveKey({name:"PBKDF2", salt:b64(enc.kdf.salt), iterations:enc.kdf.iter, hash:"SHA-256"},
                                            base, {name:"AES-GCM", length:256}, false, ["decrypt"]);
  let inner = null;
  for (const k of enc.keys){
    try { inner = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM", iv:b64(k.iv)}, kek, b64(k.ct)))); break; }
    catch(e){ /* bukan kunci ini */ }
  }
  if (!inner) throw new Error("Kode login tidak valid");
  const dk = await crypto.subtle.importKey("raw", b64(inner.k), "AES-GCM", false, ["decrypt"]);
  const gz = await crypto.subtle.decrypt({name:"AES-GCM", iv:b64(enc.iv)}, dk, b64(enc.ct));
  const txt = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  return { user:{nama:inner.n, akses:inner.s}, data:JSON.parse(txt) };
}
async function fetchVersion(){
  try { return await fetch("data/version.json?t="+Date.now(),{cache:"no-store"}).then(r=>r.json()); } catch(e){ return null; }
}

/* ------------------------------------------------------------------ login flow */
async function doLogin(code, silent){
  $("loading").hidden = false; $("loginBtn").disabled = true; $("loginMsg").textContent = "";
  try {
    const res = await unlock(code);
    D = res.data; USER = res.user; VERSION = await fetchVersion();
    sessionStorage.setItem("tbr_code", code);
    start();
  } catch(e){
    sessionStorage.removeItem("tbr_code");
    if (!silent) $("loginMsg").textContent = e.message.includes("tidak valid") ? "Kode login tidak valid." : "Gagal memuat data: " + e.message;
    $("login").hidden = false; $("app").hidden = true;
  } finally { $("loading").hidden = true; $("loginBtn").disabled = false; }
}
$("loginForm").addEventListener("submit", e => { e.preventDefault(); doLogin($("code").value.trim()); });
$("logoutBtn").addEventListener("click", () => { sessionStorage.removeItem("tbr_code"); location.reload(); });
$("reloadBtn").addEventListener("click", () => { $("banner").hidden = true; doLogin(sessionStorage.getItem("tbr_code")); });
setInterval(async () => {
  if (!D) return;
  const v = await fetchVersion();
  if (v && VERSION && v.hash !== VERSION.hash) $("banner").hidden = false;
}, POLL_MS);
const saved = sessionStorage.getItem("tbr_code");
if (saved) doLogin(saved, true);

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
function table(el, {cols, rows, page=25, search=true, sort, dir=-1, foot, csv}){
  const st = el._st || (el._st = {q:"", sort, dir, p:0});
  st.cols = cols; st.rows = rows;
  const draw = () => {
    let r = st.rows;
    if (st.q){ const q = st.q.toLowerCase(); r = r.filter(x => cols.some(c => String(c.v ? c.v(x) : x[c.k]).toLowerCase().includes(q))); }
    if (st.sort){ const c = cols.find(c=>c.k===st.sort); const g = c && c.v ? c.v : x=>x[st.sort];
      r = [...r].sort((a,b)=>{ const A=g(a), B=g(b); return (typeof A==="number"||typeof B==="number") ? ((A??-Infinity)-(B??-Infinity))*st.dir : String(A).localeCompare(String(B))*st.dir; }); }
    const pages = Math.max(1, Math.ceil(r.length/page)); st.p = Math.min(st.p, pages-1);
    const vis = r.slice(st.p*page, st.p*page+page);
    const cell = (c,x,i) => { const v = c.v ? c.v(x) : x[c.k]; return `<td class="${c.num?"num":""}">${c.h ? c.h(x,v,i) : c.f ? c.f(v) : esc(v)}</td>`; };
    el.innerHTML = `
      <div class="tbl-tools">${search?`<input type="search" placeholder="Cari…" value="${esc(st.q)}">`:"<span></span>"}
        <span><span class="note">${fN(r.length)} baris</span> ${csv?`<button class="btn" data-csv>Unduh CSV</button>`:""}</span></div>
      <div class="tbl-wrap"><table><thead><tr>${cols.map(c=>`<th class="${c.num?"num":""}" data-k="${c.k}">${c.l}${st.sort===c.k?`<span class="arr">${st.dir>0?"▲":"▼"}</span>`:""}</th>`).join("")}</tr></thead>
      <tbody>${vis.map((x,i)=>`<tr>${cols.map(c=>cell(c,x,st.p*page+i)).join("")}</tr>`).join("") || `<tr><td colspan="${cols.length}" class="note">Tidak ada data</td></tr>`}</tbody>
      ${foot?`<tfoot><tr>${foot(r).map((v,i)=>`<td class="${cols[i]&&cols[i].num?"num":""}">${v??""}</td>`).join("")}</tr></tfoot>`:""}</table></div>
      ${pages>1?`<div class="pager"><button data-p="-1">‹</button> Hal ${st.p+1} / ${pages} <button data-p="1">›</button></div>`:""}`;
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
  return { n: ms.length, f: sum(ms,m=>mYtd(m,"f")), t: sum(ms,m=>mYtd(m,"t")),
           fp: sum(pv,p=>ytd(p.f,n)), tp: sum(pv,p=>ytd(p.t,n)) };
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

  table($("tAtm"), {csv:"mesin_atm", sort:"fy", cols:[
    {k:"id",l:"ID Mesin"}, {k:"nm",l:"Nama Lokasi"}, {k:"j",l:"Jenis", h:(m,v)=>`<span class="pill">${v}</span>`}, {k:"g",l:"Lokasi"},
    {k:"a",l:"Area",f:title}, {k:"cb",l:"Cabang",v:m=>bn(m.c)}, {k:"q",l:`Kuadran ${L}`},
    {k:"ty",l:"Trx YTD",num:1,v:m=>mYtd(m,"t"),f:fN}, {k:"vy",l:"Volume YTD",num:1,v:m=>mYtd(m,"v"),f:fC},
    {k:"fy",l:"FBI YTD",num:1,v:m=>mYtd(m,"f"),f:fC}, {k:"fl",l:`FBI ${L}`,num:1,v:m=>m.f[n-1],f:fC},
    {k:"fm",l:"FBI MoM",num:1,v:m=>gr(m.f[n-1],m.f[n-2]),h:(m,v)=>v==null?"–":`<span class="${v>=0?"up":"down"}">${fP(v)}</span>`}],
    rows:x.ms,
    foot: r => ["Total","","","","","","", fN(sum(r,m=>mYtd(m,"t"))), fC(sum(r,m=>mYtd(m,"v"))), fC(sum(r,m=>mYtd(m,"f"))), fC(sum(r,m=>m.f[n-1])), ""]});
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
  return {sv:t("sv"), svp:t("svp"), md:t("md"), mdp:t("mdp"), merch:t("merch"), edc:t("edc")};
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
  table($("tEdcTop"), {csv:"top_merchant_edc", sort:"sv", page:20, rows:E.top.filter(m=>inArea(m.a) && (!s||m.s===s)), cols:[
    {k:"nm",l:"Merchant"}, {k:"a",l:"Area",f:title}, {k:"cb",l:"Cabang",v:m=>bn(m.c)}, {k:"s",l:"Segmen"}, {k:"l",l:"LOB"},
    {k:"e",l:"EDC",num:1,f:fN}, {k:"svp",l:`SV ${E.year-1}`,num:1,f:fC}, {k:"sv",l:`SV ${E.year}`,num:1,f:fC},
    {k:"g",l:"Growth",num:1,v:m=>gr(m.sv,m.svp),h:(m,v)=>v==null?"–":`<span class="${v>=0?"up":"down"}">${fP(v)}</span>`},
    {k:"md",l:"MDFG",num:1,f:fC}, {k:"tx",l:"Trx",num:1,f:fN}, {k:"fd",l:"Avg Fund",num:1,f:fC}]});

  const lobs = {};
  for (const r of E.lob) if (inArea(r[0])) { const o = lobs[r[1]] || (lobs[r[1]] = {l:r[1], m:0, sv:0, svp:0, md:0}); o.m+=r[2]; o.sv+=r[3]; o.svp+=r[4]; o.md+=r[5]; }
  const totSv = sum(Object.values(lobs), o=>o.sv);
  table($("tEdcLob"), {csv:"lob_edc", sort:"sv", page:15, rows:Object.values(lobs).filter(o=>o.sv||o.m), cols:[
    {k:"l",l:"LOB"}, {k:"m",l:"Merchant",num:1,f:fN}, {k:"svp",l:`SV ${E.year-1}`,num:1,f:fC}, {k:"sv",l:`SV ${E.year}`,num:1,f:fC},
    {k:"g",l:"Growth",num:1,v:o=>gr(o.sv,o.svp),h:(o,v)=>v==null?"–":`<span class="${v>=0?"up":"down"}">${fP(v)}</span>`},
    {k:"sh",l:"Share",num:1,v:o=>totSv?o.sv/totSv:0,f:fP}, {k:"md",l:"MDFG",num:1,f:fC}]});
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

/* ================================================================== RINGKASAN */
function prodPanel({tab, color, name, per, lbl, val, cmp, subs, spark}){
  return `<button class="prod" data-go="${tab}" style="--pc:${color}">
    <div class="p-top"><span class="p-name">${name}</span><span class="p-per">${per}</span></div>
    <div class="p-lbl">${lbl}</div><div class="p-val">${val}</div><div class="p-cmp">${cmp}</div>
    <div class="spark" data-spark="${spark}"></div>
    <div class="p-sub">${subs.map(s=>`<div><b>${s[1]}</b><span>${s[0]}</span></div>`).join("")}</div>
    <div class="p-go">Lihat detail ${name}</div></button>`;
}
function renderSummary(){
  const A = D.atm, E = D.edc, L = D.lvm, n = A.last+1;
  const at = atmSummary(AREA), ed = edcSummary(AREA), lv = lvmSummary(AREA);
  const {y,m,d} = lvmDate();
  const lvP = lv.tgt.akYtd ? lv.akY/lv.tgt.akYtd : null;
  $("sumProducts").innerHTML =
    prodPanel({tab:"atm", color:C.s1, name:"ATM & CRM", per:`Jan–${BLN[A.last]} ${A.year}`, lbl:"Fee based income YTD",
      val:fRp(at.f), cmp:grHtml(at.f,at.fp,`dibanding ${A.year-1}`), spark:"atm",
      subs:[["Transaksi YTD", fC(at.t)], ["Jumlah mesin", fN(at.n)]]}) +
    prodPanel({tab:"edc", color:C.s2, name:"EDC Merchant", per:`s.d. minggu ${E.week} ${E.year}`, lbl:"Sales volume YTD",
      val:fRp(ed.sv), cmp:grHtml(ed.sv,ed.svp,`dibanding ${E.year-1}`), spark:"edc",
      subs:[["MDFG YTD", fRp(ed.md)], ["Merchant", fN(ed.merch)]]}) +
    prodPanel({tab:"lvm", color:C.s3, name:"Livin' Merchant", per:`s.d. ${d} ${BLN[m-1]} ${y}`, lbl:"Akuisisi merchant baru YTD",
      val:fN(lv.akY), cmp:`${pctHtml(lvP)} dari target s.d. hari ini (${fN(lv.tgt.akYtd)})`, spark:"lvm",
      subs:[["Merchant USAK", `${fN(lv.usak)} <small class="${pctCls(lv.tgt.usak?lv.usak/lv.tgt.usak:null)}">${fP(lv.tgt.usak?lv.usak/lv.tgt.usak:null)}</small>`], ["Sales volume YTD", fRp(lv.svy)]]});
  // sparklines
  const atmMs = A.machines.filter(x => inArea(x.a));
  drawChart(document.querySelector('[data-spark=atm]'), {spark:true, labels:BLN.slice(0,n), fmt:fRp,
    series:[S_("FBI", Array.from({length:n},(_,i)=>sum(atmMs,x=>x.f[i])), C.s1)]});
  const yrs = Object.keys(E.hist);
  drawChart(document.querySelector('[data-spark=edc]'), {spark:true, labels:yrs, fmt:fRp,
    series:[S_("Sales volume", yrs.map(yy => sum(areas(), a => E.hist[yy][a]||0)), yrs.map(yy=>yy.includes("YTD")?C.s2:"#f5b49a"))]});
  const acq = L.acq.filter(r => inArea(BAREA[r[0]]));
  drawChart(document.querySelector('[data-spark=lvm]'), {spark:true, labels:BLN.slice(0,m), fmt:fN,
    series:[S_("Akuisisi", Array.from({length:m},(_,i)=>sum(acq.filter(r=>r[1]===y&&r[2]===i+1),r=>r[3])), C.s3)]});
  document.querySelectorAll("[data-go]").forEach(b => b.onclick = () => goTab(b.dataset.go));

  // papan skor
  const cols = [{a:"", t:"Region XI"}, ...D.areas.map(a => ({a, t:title(a).replace("Area ","")}))];
  const S = cols.map(c => ({...c, at:atmSummary(c.a), ed:edcSummary(c.a), lv:lvmSummary(c.a)}));
  const gCls = g => g==null ? "" : g >= 0 ? "good" : "bad";
  const tCls = p => p==null ? "" : p >= 1 ? "good" : p >= .8 ? "mid" : "bad";
  const sg = g => g==null ? "–" : (g>=0?"▲ ":"▼ ") + fP(Math.abs(g));
  const rows = [
    ["FBI ATM", `YoY Jan–${BLN[A.last]}`, s => { const g = gr(s.at.f,s.at.fp); return [gCls(g), sg(g), fRp(s.at.f)]; }],
    ["Transaksi ATM", "YoY", s => { const g = gr(s.at.t,s.at.tp); return [gCls(g), sg(g), fC(s.at.t)]; }],
    ["Sales volume EDC", `YoY W${E.week}`, s => { const g = gr(s.ed.sv,s.ed.svp); return [gCls(g), sg(g), fRp(s.ed.sv)]; }],
    ["MDFG EDC", `YoY W${E.week}`, s => { const g = gr(s.ed.md,s.ed.mdp); return [gCls(g), sg(g), fRp(s.ed.md)]; }],
    ["Akuisisi Livin'", "vs target YTD", s => { const p = s.lv.tgt.akYtd ? s.lv.akY/s.lv.tgt.akYtd : null; return [tCls(p), fP(p), `${fN(s.lv.akY)} / ${fN(s.lv.tgt.akYtd)}`]; }],
    ["USAK Livin'", "vs target", s => { const p = s.lv.tgt.usak ? s.lv.usak/s.lv.tgt.usak : null; return [tCls(p), fP(p), `${fN(s.lv.usak)} / ${fN(s.lv.tgt.usak)}`]; }],
  ];
  const sel = c => (AREA && c.a === AREA ? " sel" : "");
  $("sumBoard").innerHTML = `<div class="board" style="grid-template-columns:150px repeat(${S.length},minmax(0,1fr))">
    <div></div>${S.map(c=>`<div class="bh${c.a?"":" reg"}${sel(c)}">${c.t}</div>`).join("")}
    ${rows.map(([nm,sub,fn]) => `<div class="bm">${nm}<span>${sub}</span></div>` +
      S.map(c => { const [k,big,small] = fn(c); return `<div class="bc ${k}${sel(c)}"><b>${big}</b><span>${small}</span></div>`; }).join("")).join("")}
  </div>`;

  const ar = areas(), SA = ar.map(a => ({a, at:atmSummary(a), ed:edcSummary(a), lv:lvmSummary(a)}));
  const tot = at.f + ed.md + lv.fby;
  $("sumFbiNote").textContent = `Total ${fRp(tot)}: ATM ${fP(tot?at.f/tot:0)}, EDC ${fP(tot?ed.md/tot:0)}, Livin' ${fP(tot?lv.fby/tot:0)}`;
  chart("cSumFbi", {labels:ar.map(title), fmt:fC, stacked:true, series:[
      S_("FBI ATM", SA.map(s=>s.at.f), C.s1), S_("MDFG EDC", SA.map(s=>s.ed.md), C.s2), S_("FBI Livin' Merchant", SA.map(s=>s.lv.fby), C.s3)]});
  chart("cSumTgt", {labels:ar.map(title), fmt:v=>fP(v), series:[
      S_("Akuisisi YTD", SA.map(s=>s.lv.tgt.akYtd?s.lv.akY/s.lv.tgt.akYtd:0), C.s1),
      S_("USAK", SA.map(s=>s.lv.tgt.usak?s.lv.usak/s.lv.tgt.usak:0), C.s3),
      S_("Target 100%", ar.map(()=>1), C.s2, {type:"line", dash:1, flat:1})]});
}

/* ================================================================== app */
const RENDER = {ringkasan:renderSummary, atm:renderATM, edc:renderEDC, lvm:renderLVM, cabang:renderCabang};
let TAB = "ringkasan";
const TITLES = {ringkasan:"Ringkasan kinerja", atm:"ATM & CRM", edc:"EDC Merchant", lvm:"Livin' Merchant", cabang:"Scorecard cabang"};
function subTitle(){
  const {y,m,d} = lvmDate();
  return {
    ringkasan:`Posisi data ATM ${BLN[D.atm.last]} ${D.atm.year}, EDC minggu ${D.edc.week} ${D.edc.year}, Livin' Merchant ${d} ${BLN[m-1]} ${y}`,
    atm:`Januari–${BLN[D.atm.last]} ${D.atm.year}, dibanding periode yang sama ${D.atm.year-1}`,
    edc:`Year to date minggu ${D.edc.week} ${D.edc.year}, dibanding minggu yang sama ${D.edc.year-1}`,
    lvm:`Data sampai ${d} ${BLN[m-1]} ${y}`,
    cabang:`ATM ${BLN[D.atm.last]}, EDC minggu ${D.edc.week}, Livin' Merchant ${d} ${BLN[m-1]} ${y}`}[TAB];
}
function renderTab(){
  $("pageTitle").textContent = TITLES[TAB]; $("pageSub").textContent = subTitle();
  try { RENDER[TAB](); } catch(e){ console.error(e); }
}
function goTab(t){
  TAB = t;
  document.querySelectorAll("#tabs button").forEach(x => x.classList.toggle("active", x.dataset.tab===t));
  document.querySelectorAll(".tab").forEach(s => s.hidden = s.id !== "tab-"+t);
  window.scrollTo(0,0); renderTab();
}
function renderPills(scope){
  const list = scope ? [scope] : ["", ...D.areas];
  $("areaPills").innerHTML = list.map(a => `<button data-a="${a}" class="${a===AREA?"on":""}" ${scope?"disabled":""}>${a ? title(a).replace("Area ","") : "Semua area"}</button>`).join("");
  $("areaPills").querySelectorAll("button").forEach(b => b.onclick = () => { if (scope) return; AREA = b.dataset.a; renderPills(scope); renderTab(); });
}
function start(){
  prep();
  const ORD = ["AREA DENPASAR","AREA KUTA","AREA MATARAM","AREA KUPANG"];
  D.areas.sort((x,y) => (ORD.indexOf(x)+1||99) - (ORD.indexOf(y)+1||99));
  const scope = USER.akses && USER.akses !== "REGION" ? USER.akses : "";
  if (scope) AREA = scope; else if (!D.areas.includes(AREA)) AREA = "";
  renderPills(scope);
  opts($("edcSeg"), [...new Set(D.edc.cube.map(r=>r[2]))].sort());
  opts($("edcLob"), [...new Set(D.edc.cube.map(r=>r[3]))].sort());
  opts($("edcTipe"), [...new Set(D.edc.cube.map(r=>r[4]))].filter(v=>v!=="-").sort());
  opts($("lvmKelas"), [...new Set(Object.values(KELAS))].sort());
  $("userLine").textContent = USER.nama;
  $("footLine").textContent = `Data diperbarui ${D.generated}`;
  $("footLine").title = `Sumber: ${D.sources.atm}, ${D.sources.edc}, ${D.sources.lvm}`;
  $("login").hidden = true; $("app").hidden = false;
  renderTab();
}
$("tabs").addEventListener("click", e => { const b = e.target.closest("button[data-tab]"); if (b) goTab(b.dataset.tab); });
["atmJenis","atmGroup","atmMetric","edcSeg","edcLob","edcTipe","lvmKelas"].forEach(id => $(id).addEventListener("change", renderTab));
})();
