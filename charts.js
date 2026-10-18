// Minimal SVG charts – no library, so they work offline and stay tiny.

const W = 340, H = 180, PAD = { l: 34, r: 8, t: 10, b: 22 };

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { lo, hi, ticks };
}

const fmtShort = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** series: [{ name, cls, points: [{ x: ms, y }] }] */
export function lineChart(series, { unit = '' } = {}) {
  const pts = series.flatMap(s => s.points);
  if (pts.length < 2) return '<p class="muted small">Not enough data to chart yet.</p>';
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const { lo, hi, ticks } = niceTicks(Math.min(...ys), Math.max(...ys));
  const sx = x => PAD.l + (x1 === x0 ? 0.5 : (x - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = y => H - PAD.b - (y - lo) / (hi - lo || 1) * (H - PAD.t - PAD.b);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  for (const t of ticks) {
    svg += `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${sy(t)}" y2="${sy(t)}"/>`;
    svg += `<text class="axis" x="${PAD.l - 4}" y="${sy(t) + 3}" text-anchor="end">${t}</text>`;
  }
  svg += `<text class="axis" x="${PAD.l}" y="${H - 6}">${fmtShort(x0)}</text>`;
  svg += `<text class="axis" x="${W - PAD.r}" y="${H - 6}" text-anchor="end">${fmtShort(x1)}</text>`;
  for (const s of series) {
    if (!s.points.length) continue;
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
    svg += `<path class="line ${s.cls}" d="${d}"/>`;
    for (const p of s.points) svg += `<circle class="dot ${s.cls}" cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="2.5"><title>${fmtShort(p.x)}: ${p.y}${unit}</title></circle>`;
  }
  svg += '</svg>';
  const legend = series.map(s => `<span class="key ${s.cls}">${s.name}</span>`).join('');
  return svg + `<div class="legend">${legend}</div>`;
}

/** labels: string[], series: [{ name, cls, values: number[] }] – grouped bars */
export function barChart(labels, series, { unit = '' } = {}) {
  const max = Math.max(0, ...series.flatMap(s => s.values));
  if (!max) return '<p class="muted small">Nothing recorded in this period.</p>';
  const { hi, ticks } = niceTicks(0, max);
  const n = labels.length, g = (W - PAD.l - PAD.r) / n, bw = Math.max(2, (g - 4) / series.length);
  const sy = y => H - PAD.b - y / hi * (H - PAD.t - PAD.b);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  for (const t of ticks) {
    svg += `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${sy(t)}" y2="${sy(t)}"/>`;
    svg += `<text class="axis" x="${PAD.l - 4}" y="${sy(t) + 3}" text-anchor="end">${t}</text>`;
  }
  labels.forEach((lab, i) => {
    series.forEach((s, j) => {
      const v = s.values[i] || 0, x = PAD.l + i * g + 2 + j * bw;
      if (v > 0) svg += `<rect class="bar ${s.cls}" x="${x.toFixed(1)}" y="${sy(v).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${(sy(0) - sy(v)).toFixed(1)}" rx="1.5"><title>${lab} · ${s.name}: ${v}${unit}</title></rect>`;
    });
    if (i % Math.ceil(n / 6) === 0) svg += `<text class="axis" x="${(PAD.l + i * g + g / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${lab}</text>`;
  });
  svg += '</svg>';
  return svg + `<div class="legend">${series.map(s => `<span class="key ${s.cls}">${s.name}</span>`).join('')}</div>`;
}
