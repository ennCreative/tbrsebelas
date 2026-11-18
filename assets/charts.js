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
  const showLegend = cfg.legend !== false && series.length > 1;
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
  const m = horizontal ? {l:Math.min(170, maxLab*6.6+12), r:16, t:6, b:24} : {l:tickW, r:10, t:8, b: maxLab*6.6 > (W-tickW)/n ? 44 : 24};
  const pw = W - m.l - m.r, ph = h - m.t - m.b;
  if (pw <= 10 || ph <= 10) return;
  const vs = v => (v/top) * (horizontal ? pw : ph);
  const g = mk("g"); svg.appendChild(g);
  // grid + ticks
  for (const t of ticks){
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
    });
    // category label
    const lab = String(labels[i]);
    if (horizontal){
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
})();
