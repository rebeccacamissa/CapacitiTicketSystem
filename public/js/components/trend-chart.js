/**
 * Two-series trend line (created vs resolved) — one shared y-axis, legend + direct
 * end labels, recessive grid, crosshair tooltip on hover/focus, and an sr-only table.
 * Series colours validated for the dark surface (dataviz validator: all checks PASS).
 */
import { esc } from '../ui.js';

const SERIES = [
  { key: 'created', label: 'Created', color: '#9b6ce3' },
  { key: 'resolved', label: 'Resolved', color: '#f25251' },
];
const W = 640, H = 220, PAD = { l: 30, r: 64, t: 14, b: 26 };
const day = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short' });

function smooth(pts) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]; const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return d;
}

export function renderTrend(root, rows) {
  const max = Math.max(2, ...rows.flatMap((r) => [r.created, r.resolved]));
  const ticks = [0, Math.ceil(max / 2), Math.ceil(max)];
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const x = (i) => PAD.l + (i / (rows.length - 1)) * iw;
  const y = (v) => PAD.t + ih - (v / ticks[2]) * ih;

  // End labels: nudge apart so they never collide when both series end on similar values.
  const lastVals = SERIES.map((s) => y(rows[rows.length - 1][s.key]));
  const labelY = [...lastVals];
  if (Math.abs(labelY[0] - labelY[1]) < 14) {
    const mid = (labelY[0] + labelY[1]) / 2;
    const up = rows[rows.length - 1].created >= rows[rows.length - 1].resolved ? 0 : 1;
    labelY[up] = mid - 7;
    labelY[1 - up] = mid + 9;
  }

  const lines = SERIES.map((s, si) => {
    const pts = rows.map((r, i) => [x(i), y(r[s.key])]);
    const last = pts[pts.length - 1];
    return `
      ${s.key === 'created' ? `<path d="${smooth(pts)} L${x(rows.length - 1)},${y(0)} L${x(0)},${y(0)} Z" fill="url(#tg-${s.key})" class="animate-fade-up"/>` : ''}
      <path d="${smooth(pts)}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linecap="round" class="draw" style="--len:1400"/>
      <circle cx="${last[0]}" cy="${last[1]}" r="4.5" fill="${s.color}" stroke="#0d1430" stroke-width="2"/>
      <text x="${last[0] + 9}" y="${labelY[si] + 4}" class="fill-white/80 text-[11px] font-semibold">${s.label} ${rows[rows.length - 1][s.key]}</text>`;
  }).join('');

  root.innerHTML = `
    <div class="mb-3 flex flex-wrap items-center gap-4 text-xs text-white/70" aria-hidden="true">
      ${SERIES.map((s) => `<span class="flex items-center gap-1.5"><span class="h-0.5 w-4 rounded-full" style="background:${s.color}"></span>${s.label}</span>`).join('')}
    </div>
    <div class="relative" data-chart>
      <svg viewBox="0 0 ${W} ${H}" class="w-full overflow-visible" role="img" aria-label="Requests created and resolved per day over the last 14 days">
        <defs>${SERIES.map((s) => `<linearGradient id="tg-${s.key}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".28"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`).join('')}</defs>
        ${ticks.map((t) => `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(t)}" y2="${y(t)}" stroke="rgb(255 255 255 / .07)"/><text x="${PAD.l - 8}" y="${y(t) + 4}" text-anchor="end" class="fill-white/40 text-[10px]">${t}</text>`).join('')}
        ${rows.map((r, i) => (i % 3 === 0 || i === rows.length - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="fill-white/40 text-[10px]">${day.format(new Date(r.date))}</text>` : '')).join('')}
        ${lines}
        <line data-cross x1="0" x2="0" y1="${PAD.t}" y2="${PAD.t + ih}" stroke="rgb(255 255 255 / .35)" stroke-dasharray="3 3" opacity="0"/>
        ${SERIES.map((s) => `<circle data-dot="${s.key}" r="5" fill="${s.color}" stroke="#0d1430" stroke-width="2" opacity="0"/>`).join('')}
        <rect data-hit x="${PAD.l}" y="0" width="${iw}" height="${H}" fill="transparent" tabindex="0" aria-label="Explore daily values with arrow keys"/>
      </svg>
      <div data-tip class="pointer-events-none absolute top-0 z-10 hidden min-w-32 rounded-xl border border-white/15 bg-night/95 px-3 py-2 text-xs shadow-xl backdrop-blur"></div>
    </div>
    <table class="sr-only"><caption>Daily requests</caption><thead><tr><th>Date</th><th>Created</th><th>Resolved</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r.date)}</td><td>${r.created}</td><td>${r.resolved}</td></tr>`).join('')}</tbody></table>`;

  const svg = root.querySelector('svg');
  const hit = root.querySelector('[data-hit]');
  const cross = root.querySelector('[data-cross]');
  const tip = root.querySelector('[data-tip]');
  let idx = rows.length - 1;

  const show = (i) => {
    idx = Math.max(0, Math.min(rows.length - 1, i));
    const r = rows[idx];
    cross.setAttribute('x1', x(idx)); cross.setAttribute('x2', x(idx)); cross.setAttribute('opacity', '1');
    for (const s of SERIES) {
      const dot = root.querySelector(`[data-dot="${s.key}"]`);
      dot.setAttribute('cx', x(idx)); dot.setAttribute('cy', y(r[s.key])); dot.setAttribute('opacity', '1');
    }
    tip.innerHTML = `<p class="mb-1 font-semibold text-white">${day.format(new Date(r.date))}</p>${SERIES.map((s) => `<p class="flex items-center justify-between gap-4 text-white/70"><span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full" style="background:${s.color}"></span>${s.label}</span><span class="font-semibold text-white">${r[s.key]}</span></p>`).join('')}`;
    tip.classList.remove('hidden');
    const px = (x(idx) / W) * svg.clientWidth;
    tip.style.left = `${Math.min(svg.clientWidth - tip.offsetWidth, Math.max(0, px + 12))}px`;
  };
  const hide = () => {
    tip.classList.add('hidden'); cross.setAttribute('opacity', '0');
    root.querySelectorAll('[data-dot]').forEach((d) => d.setAttribute('opacity', '0'));
  };
  hit.addEventListener('pointermove', (e) => {
    const rect = svg.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    show(Math.round(((sx - PAD.l) / iw) * (rows.length - 1)));
  });
  hit.addEventListener('pointerleave', hide);
  hit.addEventListener('focus', () => show(idx));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(idx - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + 1); }
  });
}
