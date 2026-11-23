/* MiniChart — grafik batang/garis SVG ringan tanpa library eksternal.
 * drawChart(el, {labels, series:[{label,data,color,type:"bar"|"line",dash}], fmt, horizontal, stacked, legend})
 */
(function(){
"use strict";
const NS = "http://www.w3.org/2000/svg";
const GRID = "#ecebe7", AXIS = "#d9d8d3", INK2 = "#52514e", SURF = "#fcfcfb";
const mk = (t, a={}) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
function nice(max){
  if (!(max > 0)) return {step:1, top:1};
  const raw = max/5, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw/p;
  const step = (m<=1?1:m<=2?2:m<=2.5?2.5:m<=5?5:10)*p;
  return {step, top:Math.ceil(max/step)*step};
}
function roundBar(x, y, w, h, r, horiz){
  // rounded at the data end only
  if (w <= 0 || h <= 0) return "";
  r = Math.min(r, horiz ? h/2 : w/2, horiz ? w : h);
  if (horiz) return `M${x},${y}H${x+w-r}Q${x+w},${y} ${x+w},${y+r}V${y+h-r}Q${x+w},${y+h} ${x+w-r},${y+h}H${x}Z`;
  return `M${x},${y+h}V${y+r}Q${x},${y} ${x+r},${y}H${x+w-r}Q${x+w},${y} ${x+w},${y+r}V${y+h}Z`;
}
function cshort(v){                  // label ringkas: 7,1M · 28,9T · 4,5rb · 143
  const a = Math.abs(v||0), f = (x,u) => x.toLocaleString("id-ID",{maximumFractionDigits:x<10?1:0}) + u;
  if (a >= 1e12) return f(v/1e12,"T"); if (a >= 1e9) return f(v/1e9,"M"); if (a >= 1e6) return f(v/1e6,"Jt"); if (a >= 1e4) return f(v/1e3,"rb");
  return (v||0).toLocaleString("id-ID",{maximumFractionDigits:1});
}
let tip;
function tooltip(){
  if (!tip){ tip = document.createElement("div"); tip.className = "mc-tip"; document.body.appendChild(tip); }
  return tip;
}
function render(el){
  const cfg = el._cfg; if (!cfg) return;
  const W = el.clientWidth, H = el.clientHeight; if (!W || !H) return;
  const {labels, series, fmt = v => v, horizontal = false, stacked = false} = cfg;
  el.innerHTML = "";
  const SP = !!cfg.spark;
  const showLegend = !SP && cfg.legend !== false && series.length > 1;
  if (showLegend){
    const lg = document.createElement("div"); lg.className = "mc-legend";
    lg.innerHTML = series.map(s => `<span><i style="background:${Array.isArray(s.color)?s.color[0]:s.color};${s.type==="line"?"height:3px;border-radius:2px":""}"></i>${s.label}</span>`).join("");
    el.appendChild(lg);
  }
  const lgH = showLegend ? el.firstChild.offsetHeight + 6 : 0;
  const svg = mk("svg", {width:W, height:H-lgH, role:"img"}); el.appendChild(svg);
  const h = H - lgH, n = labels.length;
  const bars = series.filter(s => s.type !== "line"), lines = series.filter(s => s.type === "line");
  let max = 0;
  if (stacked) for (let i=0;i<n;i++) max = Math.max(max, bars.reduce((a,s)=>a+(+s.data[i]||0),0));
  else for (const s of bars) for (const v of s.data) max = Math.max(max, +v||0);
  for (const s of lines) for (const v of s.data) max = Math.max(max, +v||0);
  const {step, top} = nice(max);
  const ticks = []; for (let v=0; v<=top+step/1e6; v+=step) ticks.push(v);
  const maxLab = Math.max(...labels.map(l => String(l).length));
  const tickW = Math.max(...ticks.map(t => String(fmt(t)).length)) * 6.6 + 10;
  const SHOWV = cfg.values !== false && !stacked;                     // angka di atas setiap batang
  const dense = !horizontal && bars.length > 1 && ((W - tickW) / n) * 0.72 / bars.length < 22;
  const m = SP ? {l:0, r:0, t:cfg.values?16:2, b:cfg.cats?17:1} : horizontal ? {l:Math.min(170, maxLab*6.6+12), r:SHOWV?62:16, t:6, b:24} : {l:tickW, r:10, t:SHOWV?(dense?36:22):8, b: maxLab*6.6 > (W-tickW)/n ? 44 : 24};
  const vfmt = typeof cfg.values === "function" ? cfg.values : cshort;
  const pw = W - m.l - m.r, ph = h - m.t - m.b;
  if (pw <= 10 || ph <= 10) return;
  const vs = v => (v/top) * (horizontal ? pw : ph);
  const g = mk("g"); svg.appendChild(g);
  // grid + ticks
  if (!SP) for (const t of ticks){
    if (horizontal){
      const x = m.l + vs(t);
      g.appendChild(mk("line",{x1:x,x2:x,y1:m.t,y2:m.t+ph,stroke:GRID}));
      const tx = mk("text",{x, y:h-6, "text-anchor":"middle", class:"mc-t"}); tx.textContent = fmt(t); g.appendChild(tx);
    } else {
      const y = m.t + ph - vs(t);
      g.appendChild(mk("line",{x1:m.l,x2:m.l+pw,y1:y,y2:y,stroke:GRID}));
      const tx = mk("text",{x:m.l-8, y:y+4, "text-anchor":"end", class:"mc-t"}); tx.textContent = fmt(t); g.appendChild(tx);
    }
  }
  const band = (horizontal ? ph : pw) / n;
  const k = stacked ? 1 : bars.length;
  const bw = Math.max(2, Math.min(34, band*0.72/k));
  const gap = k > 1 ? 2 : 0;
  const groupW = bw*k + gap*(k-1);
  for (let i=0;i<n;i++){
    const c0 = (horizontal ? m.t : m.l) + band*i + (band-groupW)/2;
    let acc = 0;
    bars.forEach((s, si) => {
      const v = s.data[i]; if (v == null || !(+v > 0)) { return; }
      const len = vs(+v), col = Array.isArray(s.color) ? s.color[i % s.color.length] : s.color;
      const off = stacked ? 0 : si*(bw+gap);
      let d;
      if (horizontal){
        const x = m.l + vs(acc), y = c0 + off;
        d = stacked ? `M${x},${y}h${Math.max(0,len-(si<bars.length-1?2:0))}v${bw}h${-Math.max(0,len-(si<bars.length-1?2:0))}Z` : roundBar(x, y, len, bw, 4, true);
      } else {
        const base = m.t + ph - vs(acc), y = base - len, x = c0 + off;
        const isTop = !stacked || bars.slice(si+1).every(o => !(+o.data[i] > 0));
        d = isTop ? roundBar(x, y, bw, len - (stacked && si>0 ? 0 : 0), 4, false) : `M${x},${base}V${y+2}H${x+bw}V${base}Z`;
      }
      if (stacked) acc += +v;
      g.appendChild(mk("path",{d, fill:col}));
      if (SHOWV && (cfg.values || !SP)){            // nilai di atas batang (atau di ujung batang horizontal)
        const tv = horizontal
          ? mk("text",{x:m.l + vs(+v) + 4, y:c0 + off + bw/2 + 3.5, "text-anchor":"start", class:"mc-sv"})
          : bw < 22 && k > 1
            ? mk("text",{x:c0 + off + bw/2 + 3, y:m.t + ph - vs(+v) - 4, "text-anchor":"start", class:"mc-sv tight", transform:`rotate(-90 ${c0 + off + bw/2 + 3} ${m.t + ph - vs(+v) - 4})`})
            : mk("text",{x:c0 + off + bw/2, y:m.t + ph - vs(+v) - 4, "text-anchor":"middle", class:"mc-sv" + (bw < 16 ? " tight" : "")});
        tv.textContent = vfmt(+v); g.appendChild(tv);
      }
    });
    // category label
    const lab = String(labels[i]);
    if (SP) {
      if (cfg.cats){                               // label bulan/tahun di bawah batang
        const t = mk("text",{x:m.l + band*i + band/2, y:h - 3, "text-anchor":"middle", class:"mc-sl"}); t.textContent = cfg.cats[i] ?? lab; g.appendChild(t);
      }
    } else if (horizontal){
      const t = mk("text",{x:m.l-8, y:c0+groupW/2+4, "text-anchor":"end", class:"mc-l"}); t.textContent = lab.length>26?lab.slice(0,25)+"…":lab; g.appendChild(t);
    } else {
      const cx = m.l + band*i + band/2;
      const rot = m.b > 30;
      const t = mk("text",{x:cx, y:m.t+ph+16, "text-anchor":rot?"end":"middle", class:"mc-l", transform:rot?`rotate(-30 ${cx} ${m.t+ph+16})`:""}); t.textContent = lab.length>18?lab.slice(0,17)+"…":lab; g.appendChild(t);
    }
  }
  // baseline
  g.appendChild(horizontal ? mk("line",{x1:m.l,x2:m.l,y1:m.t,y2:m.t+ph,stroke:AXIS}) : mk("line",{x1:m.l,x2:m.l+pw,y1:m.t+ph,y2:m.t+ph,stroke:AXIS}));
  // lines (vertical charts)
  for (const s of lines){
    const pts = s.data.map((v,i) => v==null ? null : [m.l + band*i + band/2, m.t + ph - vs(+v)]).filter(Boolean);
    if (pts.length === 1) pts.unshift([m.l, pts[0][1]]), pts.push([m.l+pw, pts[1][1]]);
    if (s.flat && pts.length) { pts[0][0] = m.l; pts[pts.length-1][0] = m.l + pw; }
    g.appendChild(mk("polyline",{points:pts.map(p=>p.join(",")).join(" "), fill:"none", stroke:s.color, "stroke-width":2, "stroke-dasharray":s.dash?"5 4":"", "stroke-linejoin":"round"}));
  }
  // hover layer
  const hl = mk("rect",{fill:"rgba(11,42,85,.05)", visibility:"hidden"}); g.insertBefore(hl, g.firstChild);
  for (let i=0;i<n;i++){
    const r = horizontal ? mk("rect",{x:m.l, y:m.t+band*i, width:pw, height:band, fill:"transparent"})
                         : mk("rect",{x:m.l+band*i, y:m.t, width:band, height:ph, fill:"transparent"});
    r.addEventListener("mousemove", e => {
      hl.setAttribute("visibility","visible"); for (const a of ["x","y","width","height"]) hl.setAttribute(a, r.getAttribute(a));
      const T = tooltip();
      T.innerHTML = `<b>${labels[i]}</b>` + series.map(s => { const v = s.data[i]; if (v==null) return "";
        const col = Array.isArray(s.color) ? s.color[i % s.color.length] : s.color;
        return `<div><i style="background:${col}"></i>${s.label}<span>${fmt(+v)}</span></div>`; }).join("");
      T.style.display = "block";
      const tx = Math.min(window.innerWidth - T.offsetWidth - 8, e.clientX + 14), ty = Math.max(8, e.clientY - T.offsetHeight - 10);
      T.style.left = tx + "px"; T.style.top = ty + "px";
    });
    r.addEventListener("mouseleave", () => { hl.setAttribute("visibility","hidden"); tooltip().style.display = "none"; });
    g.appendChild(r);
  }
}
window.drawChart = function(el, cfg){
  el._cfg = cfg; render(el);
  if (!el._ro && window.ResizeObserver){ let w = el.clientWidth; el._ro = new ResizeObserver(() => { if (el.clientWidth !== w){ w = el.clientWidth; render(el); } }); el._ro.observe(el); }
};

/* ---- Pie / donut: drawPie(el, {items:[{label,value,color,note}], fmt, center:[label,value]}) ---- */
window.drawPie = function(el, cfg){
  el._pie = cfg; renderPie(el);
  if (!el._pro && window.ResizeObserver){ let w = el.clientWidth; el._pro = new ResizeObserver(() => { if (el.clientWidth !== w){ w = el.clientWidth; renderPie(el); } }); el._pro.observe(el); }
};
function renderPie(el){
  const {items, fmt = v => v, center} = el._pie;
  const W = el.clientWidth, H = el.clientHeight; if (!W || !H) return;
  el.innerHTML = "";
  const total = items.reduce((a,b) => a + Math.max(0, +b.value || 0), 0);
  const wrap = document.createElement("div"); wrap.className = "pie-wrap"; el.appendChild(wrap);
  const size = Math.max(110, Math.min(H - 8, W * .44, 200)), R = size/2, r0 = R*.62;
  const svg = mk("svg", {width:size, height:size, viewBox:`0 0 ${size} ${size}`, role:"img"}); wrap.appendChild(svg);
  const legend = document.createElement("ul"); legend.className = "pie-legend"; wrap.appendChild(legend);
  let a0 = -Math.PI/2;
  const arc = (a1, a2) => {
    const big = a2 - a1 > Math.PI ? 1 : 0, c = R, p = (rr, a) => [c + rr*Math.cos(a), c + rr*Math.sin(a)];
    const [x1,y1] = p(R,a1), [x2,y2] = p(R,a2), [x3,y3] = p(r0,a2), [x4,y4] = p(r0,a1);
    return `M${x1},${y1}A${R},${R} 0 ${big} 1 ${x2},${y2}L${x3},${y3}A${r0},${r0} 0 ${big} 0 ${x4},${y4}Z`;
  };
  const segs = [];
  items.forEach((it, i) => {
    const v = Math.max(0, +it.value || 0), share = total ? v/total : 0;
    let path = null;
    if (share > 0){
      const a1 = a0, a2 = a0 + share * Math.PI * 2 - (share < 1 ? .012 : 0);   // celah tipis antar irisan
      path = share >= .9999 ? mk("circle",{cx:R, cy:R, r:(R+r0)/2, fill:"none", stroke:it.color, "stroke-width":R-r0})
                            : mk("path",{d:arc(a1, Math.max(a1+.001, a2)), fill:it.color});
      svg.appendChild(path); a0 += share * Math.PI * 2;
    }
    const li = document.createElement("li");
    li.innerHTML = `<i style="background:${it.color}"></i><span class="pl">${it.label}</span><b>${(share*100).toLocaleString("id-ID",{maximumFractionDigits:1,minimumFractionDigits:1})}%</b><span class="pv">${fmt(v)}${it.note?` · ${it.note}`:""}</span>`;
    legend.appendChild(li);
    segs.push({path, li, it, v, share});
  });
  if (center){
    const t1 = mk("text",{x:R, y:R-4, "text-anchor":"middle", class:"pie-c1"}); t1.textContent = center[1]; svg.appendChild(t1);
    const t2 = mk("text",{x:R, y:R+14, "text-anchor":"middle", class:"pie-c2"}); t2.textContent = center[0]; svg.appendChild(t2);
  }
  const on = (s, e) => {
    segs.forEach(o => { if (o.path) o.path.style.opacity = o === s ? 1 : .35; o.li.classList.toggle("dim", o !== s); });
    if (!e) return;
    const T = tooltip();
    T.innerHTML = `<b>${s.it.label}</b><div><i style="background:${s.it.color}"></i>Nilai<span>${fmt(s.v)}</span></div><div><i style="background:transparent"></i>Porsi<span>${(s.share*100).toLocaleString("id-ID",{maximumFractionDigits:1})}%</span></div>${s.it.note?`<div><i style="background:transparent"></i>${s.it.note}</div>`:""}`;
    T.style.display = "block";
    T.style.left = Math.min(window.innerWidth - T.offsetWidth - 8, e.clientX + 14) + "px"; T.style.top = Math.max(8, e.clientY - T.offsetHeight - 10) + "px";
  };
  const off = () => { segs.forEach(o => { if (o.path) o.path.style.opacity = 1; o.li.classList.remove("dim"); }); tooltip().style.display = "none"; };
  segs.forEach(s => {
    if (s.path){ s.path.addEventListener("mousemove", e => on(s, e)); s.path.addEventListener("mouseleave", off); }
    s.li.addEventListener("mouseenter", () => on(s)); s.li.addEventListener("mouseleave", off);
  });
}
})();
