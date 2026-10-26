// Small chart library (pure SVG/HTML strings, no external files). Every function returns an HTML string.
const C = { green: '#1ea463', blue: '#1976d2', orange: '#f08c00', red: '#d32f2f', purple: '#7b4fc9', teal: '#00897b', grey: '#78909c', pink: '#d81b60' };
const PALETTE = [C.green, C.blue, C.orange, C.purple, C.teal, C.pink, C.red, C.grey];
const STATUS_COLORS = { Completed: C.green, Booked: C.blue, Waiting: C.orange, 'In consultation': C.purple, 'No-show': C.red, Cancelled: C.grey };
const PRIORITY_COLORS = { emergency: C.red, high: C.orange, mild: C.blue, routine: C.green };
const PRIORITY_NAMES = { emergency: 'Emergency', high: 'High', mild: 'Mild', routine: 'Routine' };
const METHOD_COLORS = { Cash: C.green, UPI: C.purple, Card: C.blue, Other: C.grey };

let chartId = 0;
const fmtNum = n => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 });
const compact = n => (n >= 100000 ? (n / 100000).toFixed(1).replace(/\.0$/, '') + 'L' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(n * 10) / 10));

// 4 evenly spaced grid lines with round numbers
function axis(maxV) {
  const raw = Math.max(maxV, 1) / 4, pow = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / pow;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  return { step, top: step * 4 };
}
const legend = items => `<div class="legend">${items.map(i => `<span><i style="background:${i.color}"></i>${esc(i.name)}</span>`).join('')}</div>`;
const noData = () => '<div class="empty" style="padding:18px">No data for this period yet.</div>';

// Line / area chart. series = [{ name, color, values: [..] }], labels = x labels
function lineChart(labels, series, { fmt = fmtNum, height = 240 } = {}) {
  const W = 640, H = height, L = 46, R = 14, T = 14, B = 30, id = 'g' + (++chartId);
  const maxV = Math.max(0, ...series.flatMap(s => s.values));
  if (!labels.length || maxV === 0) return noData();
  const { step, top } = axis(maxV);
  const x = i => L + (labels.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (labels.length - 1));
  const y = v => T + (H - T - B) * (1 - v / top);
  const every = Math.ceil(labels.length / 7);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(s => s.name).join(' and '))} over time" style="width:100%;height:auto">
    <defs>${series.map((s, k) => `<linearGradient id="${id}-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".28"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`).join('')}</defs>`;
  for (let k = 0; k <= 4; k++) {
    const v = step * k;
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#d9ece1"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#55705f">${esc(compact(v))}</text>`;
  }
  labels.forEach((l, i) => { if (i % every === 0 || (i === labels.length - 1 && i % every >= Math.ceil(every / 2))) svg += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#55705f">${esc(l)}</text>`; });
  series.forEach((s, k) => {
    const pts = s.values.map((v, i) => `${x(i)},${y(v)}`);
    if (k === 0 || s.area) svg += `<polygon points="${x(0)},${y(0)} ${pts.join(' ')} ${x(labels.length - 1)},${y(0)}" fill="url(#${id}-${k})"/>`;
    svg += `<polyline points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`;
    s.values.forEach((v, i) => { svg += `<circle cx="${x(i)}" cy="${y(v)}" r="${labels.length > 40 ? 0 : 3.6}" fill="#fff" stroke="${s.color}" stroke-width="2"><title>${esc(labels[i])}: ${esc(s.name)} ${esc(fmt(v))}</title></circle>`; });
  });
  return (series.length > 1 ? legend(series) : '') + svg + '</svg>';
}

// Vertical columns. items = [{ label, value }], the tallest column is highlighted
function columnChart(items, { color = C.green, highlight = C.orange, fmt = fmtNum, height = 230 } = {}) {
  const W = 640, H = height, L = 40, R = 10, T = 18, B = 28;
  const maxV = Math.max(0, ...items.map(i => i.value));
  if (!items.length || maxV === 0) return noData();
  const { step, top } = axis(maxV), slot = (W - L - R) / items.length, bw = Math.min(34, slot * 0.64);
  const y = v => T + (H - T - B) * (1 - v / top);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Column chart" style="width:100%;height:auto">`;
  for (let k = 0; k <= 4; k++) { const v = step * k; svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#d9ece1"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#55705f">${esc(compact(v))}</text>`; }
  items.forEach((it, i) => {
    const cx = L + slot * i + slot / 2, top_ = y(it.value), isMax = it.value === maxV;
    svg += `<rect x="${cx - bw / 2}" y="${top_}" width="${bw}" height="${Math.max(0, y(0) - top_)}" rx="5" fill="${isMax ? highlight : color}"><title>${esc(it.label)}: ${esc(fmt(it.value))}</title></rect>`;
    if (it.value) svg += `<text x="${cx}" y="${top_ - 5}" text-anchor="middle" font-size="11" font-weight="700" fill="#12261b">${esc(compact(it.value))}</text>`;
    svg += `<text x="${cx}" y="${H - 9}" text-anchor="middle" font-size="11" fill="#55705f">${esc(it.label)}</text>`;
  });
  return svg + '</svg>';
}

// Donut with a legend. items = [{ name, value, color }]
function donut(items, { centerValue, centerLabel = 'Total', fmt = fmtNum } = {}) {
  const list = items.filter(i => i.value > 0), total = list.reduce((a, i) => a + i.value, 0);
  if (!total) return noData();
  const r = 62, c = 2 * Math.PI * r;
  let off = 0, arcs = '';
  list.forEach(i => {
    const len = i.value / total * c;
    arcs += `<circle cx="90" cy="90" r="${r}" fill="none" stroke="${i.color}" stroke-width="26" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 90 90)"><title>${esc(i.name)}: ${esc(fmt(i.value))}</title></circle>`;
    off += len;
  });
  return `<div class="donut-wrap"><svg viewBox="0 0 180 180" width="170" height="170" role="img" aria-label="Share by category" style="flex:none">${arcs}
    <text x="90" y="88" text-anchor="middle" font-size="22" font-weight="800" fill="#0a4228">${esc(centerValue ?? compact(total))}</text>
    <text x="90" y="106" text-anchor="middle" font-size="11" fill="#55705f">${esc(centerLabel)}</text></svg>
    <div class="donut-legend">${list.map(i => `<div><i style="background:${i.color}"></i><span>${esc(i.name)}</span><b>${esc(fmt(i.value))}</b><small>${Math.round(i.value / total * 100)}%</small></div>`).join('')}</div></div>`;
}

// Horizontal bars. items = [{ name, value, color?, note? }]
function hbarChart(items, { fmt = fmtNum, color } = {}) {
  if (!items.length) return noData();
  const max = Math.max(1, ...items.map(i => i.value));
  return items.map((i, k) => `<div class="hbar"><span title="${esc(i.name)}">${esc(i.name)}</span>
    <span class="track"><i style="width:${Math.max(3, Math.round(i.value / max * 100))}%;background:${i.color || color || PALETTE[k % PALETTE.length]}"></i></span>
    <b>${esc(fmt(i.value))}${i.note ? ` <small>${esc(i.note)}</small>` : ''}</b></div>`).join('');
}

// One stacked bar, e.g. "today's patient flow". items = [{ name, value, color }]
function stackBar(items) {
  const total = items.reduce((a, i) => a + i.value, 0);
  if (!total) return '<div class="empty" style="padding:14px">No appointments today yet.</div>';
  return `<div class="stack">${items.filter(i => i.value).map(i => `<div style="flex:${i.value};background:${i.color}" title="${esc(i.name)}: ${i.value}">${i.value}</div>`).join('')}</div>${legend(items.map(i => ({ name: `${i.name} (${i.value})`, color: i.color })))}`;
}
