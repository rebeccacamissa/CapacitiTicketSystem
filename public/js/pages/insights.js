import { api } from '../api.js';
import { initPage } from '../layout.js';
import { esc, priorityBadge, statusBadge, avatarHtml, countUp, sparkline, fmtRelative, toast } from '../ui.js';
import { renderTrend } from '../components/trend-chart.js';
import { icon } from '../icons.js';
import { onLive } from '../live.js';

const user = await initPage({ roles: ['support', 'admin'] });
const fmtHours = (h) => (h === null || h === undefined ? '—' : h < 48 ? `${h} h` : `${(h / 24).toFixed(1)} d`);
const BAR = '#9b6ce3';

/** Horizontal bars — single hue (magnitude), direct labels, rounded data ends. */
function bars(rows, { value, label = (r) => esc(r.label), extra = () => '', fmt = (v) => v, link }) {
  const max = Math.max(1, ...rows.map(value));
  return `<ul class="space-y-3">${rows.map((r) => {
    const v = value(r) || 0;
    const inner = `
      <div class="flex items-baseline justify-between gap-3 text-sm"><span class="truncate">${label(r)}</span>
        <span class="shrink-0 font-semibold tabular-nums">${fmt(v)}<span class="font-normal text-white/50">${extra(r)}</span></span></div>
      <div class="mt-1.5 h-2 rounded-full bg-white/[0.07]"><div class="h-full rounded-r-[4px] rounded-l-full transition-[width] duration-1000 ease-out" style="width:0;background:${BAR}" data-w="${(v / max) * 100}%"></div></div>`;
    return `<li title="${esc(typeof r.label === 'string' ? r.label : '')}: ${esc(fmt(v))}">${link ? `<a href="${link(r)}" class="-m-1.5 block rounded-xl p-1.5 transition hover:bg-white/[0.05]">${inner}</a>` : inner}</li>`;
  }).join('')}</ul>`;
}
const growBars = () => requestAnimationFrame(() => setTimeout(() => document.querySelectorAll('[data-w]').forEach((b) => { b.style.width = b.dataset.w; }), 60));

async function load() {
  const d = await api('/analytics/summary');
  const t = d.totals;
  const hour = new Date().getHours();
  document.getElementById('hero-title').innerHTML = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, <span class="text-gradient">${esc(user.firstName)}</span>`;
  document.getElementById('hero-sub').textContent = `${t.unassigned} ticket${t.unassigned === 1 ? '' : 's'} waiting to be picked up · ${t.overdue} overdue · ${t.waiting} waiting on candidates.`;

  const created = d.trend.map((r) => r.created);
  const resolved = d.trend.map((r) => r.resolved);
  const tiles = [
    ['Total requests', t.total, '', '/requests', created, '#9b6ce3'],
    ['Open', t.open, `${t.unassigned} unassigned`, '/requests?status=Open', null],
    ['In progress', t.in_progress, `${t.waiting} awaiting candidate`, '/requests?status=active', null],
    ['Resolved', t.resolved, 'resolved + closed', '/requests?status=Resolved', resolved, '#f25251'],
    ['Overdue', t.overdue, 'past SLA due date', '/requests?overdue=true', null, null, true],
    t.avg_resolution_hours >= 48
      ? ['Avg. resolution', +(t.avg_resolution_hours / 24).toFixed(1), 'days, created → resolved', null, null, null, false, 1, ' d']
      : ['Avg. resolution', t.avg_resolution_hours, 'hours, created → resolved', null, null, null, false, 1, ' h'],
  ];
  document.getElementById('tiles').innerHTML = tiles.map(([label, val, sub, href, spark, color, warn, dec, suffix = '']) => {
    const tag = href ? 'a' : 'div';
    const hot = warn && t.overdue;
    return `<${tag} ${href ? `href="${href}"` : ''} class="glass lift glow-ring block !rounded-2xl p-4 ${hot ? '!border-warn/40 !bg-warn/10' : ''}">
      <p class="flex items-center gap-1 text-xs font-medium text-white/60">${hot ? `<span class="text-warn">${icon('alert', 'h-3.5 w-3.5')}</span>` : ''}${label}</p>
      <p class="mt-1 font-display text-3xl font-semibold tabular-nums ${hot ? 'text-warn' : ''}" data-count="${val ?? 0}" data-decimals="${dec || 0}" data-suffix="${suffix}">0</p>
      ${spark ? `<div class="mt-1">${sparkline(spark, { stroke: color })}</div>` : `<p class="mt-0.5 text-xs text-white/45">${sub}</p>`}
    </${tag}>`;
  }).join('');
  countUp(document.getElementById('tiles'));

  // Incoming queue with one-click "Assign to me"
  document.getElementById('queue-count').textContent = d.incoming.length;
  document.getElementById('queue').innerHTML = d.incoming.length ? d.incoming.map((r) => `
    <li class="group flex flex-wrap items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-3 transition hover:border-white/15 hover:bg-white/[0.06]">
      ${avatarHtml({ name: r.candidate_name, avatar: r.avatar, id: r.id }, 'h-10 w-10 text-xs')}
      <a href="/request?id=${r.id}" class="min-w-0 flex-1"><span class="block truncate text-sm font-medium group-hover:text-salmon-50">${esc(r.title)}</span>
        <span class="block truncate text-xs text-white/50">${esc(r.reference)} · ${esc(r.candidate_name)} · ${esc(r.category)} · ${fmtRelative(r.created_at)}</span></a>
      ${priorityBadge(r.priority)}
      <button type="button" class="btn btn-primary btn-sm" data-assign="${r.id}">Assign to me</button>
    </li>`).join('') : '<li class="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-ok">Queue is clear. Nice work!</li>';

  const maxActive = Math.max(1, ...d.workload.map((w) => w.active));
  document.getElementById('workload').innerHTML = d.workload.map((w) => `
    <li class="flex items-center gap-3">
      ${avatarHtml({ name: w.name, avatar: w.avatar, id: w.id }, 'h-9 w-9 text-xs')}
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline justify-between gap-2 text-sm"><span class="truncate font-medium">${esc(w.name)}</span>
          <span class="shrink-0 tabular-nums"><strong>${w.active}</strong> <span class="text-white/45">active</span>${w.overdue ? ` <span class="badge ml-1 bg-warn/15 text-warn">${icon('alert', 'h-3 w-3')}${w.overdue}</span>` : ''}</span></div>
        <div class="mt-1.5 h-2 rounded-full bg-white/[0.07]"><div class="h-full rounded-r-[4px] rounded-l-full transition-[width] duration-1000" style="width:0;background:${BAR}" data-w="${(w.active / maxActive) * 100}%"></div></div>
        <p class="mt-1 flex items-center gap-1 text-[0.7rem] text-white/45">${w.resolved} resolved · avg ${fmtHours(w.avg_resolution_hours)}${w.ratings ? ` · <span class="inline-flex items-center gap-0.5 text-warn">${icon('star', 'h-3 w-3')}${w.avg_rating}</span> (${w.ratings})` : ''}</p>
      </div>
    </li>`).join('');

  renderTrend(document.getElementById('trend'), d.trend);

  const catIds = Object.fromEntries((await api('/requests/categories')).categories.map((c) => [c.name, c.id]));
  document.getElementById('by-category').innerHTML = bars(d.byCategory, { value: (r) => r.count, extra: (r) => ` (${r.active || 0})`, link: (r) => (catIds[r.label] ? `/requests?categoryId=${catIds[r.label]}` : '/requests') });
  document.getElementById('by-priority').innerHTML = bars(d.byPriority, { value: (r) => r.count, label: (r) => priorityBadge(r.label), extra: (r) => ` (${r.active || 0})`, link: (r) => `/requests?priority=${r.label}` });
  document.getElementById('by-status').innerHTML = bars(d.byStatus, { value: (r) => r.count, label: (r) => statusBadge(r.label), link: (r) => `/requests?status=${encodeURIComponent(r.label)}` });
  document.getElementById('resolution').innerHTML = d.resolutionByCategory.length
    ? bars(d.resolutionByCategory, { value: (r) => r.avg_hours, fmt: fmtHours, extra: (r) => ` · ${r.resolved} resolved` })
    : '<p class="text-sm text-white/50">No resolved requests yet.</p>';

  document.getElementById('overdue').innerHTML = d.oldestOverdue.length ? d.oldestOverdue.map((r) => `
    <li><a href="/request?id=${r.id}" class="flex items-center gap-3 rounded-2xl border border-warn/20 bg-warn/[0.06] p-3 transition hover:-translate-y-0.5 hover:bg-warn/10">
      <span class="min-w-0 flex-1"><span class="block text-xs font-semibold text-salmon-50">${esc(r.reference)}</span><span class="block truncate text-sm font-medium">${esc(r.title)}</span>
      <span class="block text-xs text-white/50">${r.assignee_name ? esc(r.assignee_name) : 'Unassigned'}</span></span>
      ${priorityBadge(r.priority)}<span class="badge bg-warn/15 text-warn">${fmtHours(r.hours_overdue)} late</span></a></li>`).join('')
    : '<li class="text-sm text-ok">Nothing overdue. Great work!</li>';

  // Satisfaction (CSAT): average, distribution bars, recent comments
  const cs = d.csat;
  const maxN = Math.max(1, ...cs.distribution.map((x) => x.count));
  const stars = (n) => Array.from({ length: 5 }, (_, i) => `<span class="${i < Math.round(n) ? 'text-warn' : 'text-white/20'}">${icon('star', 'h-4 w-4')}</span>`).join('');
  document.getElementById('csat').innerHTML = cs.count ? `
    <div class="grid gap-6 md:grid-cols-[12rem_1fr_1.2fr]">
      <div class="rounded-2xl bg-gradient-to-br from-warn/15 to-salmon/10 p-4 text-center">
        <p class="font-display text-4xl font-semibold" data-count="${cs.avg}" data-decimals="1">0</p>
        <div class="mt-1 flex justify-center">${stars(cs.avg)}</div>
        <p class="mt-1 text-xs text-white/60">${cs.count} rating${cs.count === 1 ? '' : 's'}</p>
      </div>
      <ul class="space-y-1.5">${cs.distribution.map((x) => `<li class="flex items-center gap-2 text-xs"><span class="w-8 tabular-nums text-white/60">${x.rating} ${icon('star', 'inline h-3 w-3')}</span>
        <span class="h-2 flex-1 rounded-full bg-white/[0.07]"><span class="block h-full rounded-r-[4px] rounded-l-full transition-[width] duration-1000" style="width:0;background:${BAR}" data-w="${(x.count / maxN) * 100}%"></span></span><span class="w-6 text-right tabular-nums">${x.count}</span></li>`).join('')}</ul>
      <ul class="space-y-2">${cs.recent.length ? cs.recent.map((r) => `<li class="rounded-xl bg-white/[0.04] p-3"><div class="flex items-center justify-between gap-2"><span class="flex">${stars(r.rating)}</span><a href="/request?id=${r.id}" class="text-xs text-salmon-50 hover:underline">${esc(r.reference)}</a></div><p class="mt-1 text-sm text-white/80">“${esc(r.comment)}”</p><p class="text-xs text-white/45">${esc(r.candidate_name)}</p></li>`).join('') : '<li class="text-sm text-white/50">No comments yet.</li>'}</ul>
    </div>` : '<p class="text-sm text-white/50">No ratings yet. Candidates can rate requests once they are resolved.</p>';
  countUp(document.getElementById('csat'));

  growBars();
}

document.getElementById('queue').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-assign]');
  if (!b) return;
  b.disabled = true;
  try {
    await api(`/workflow/requests/${b.dataset.assign}/assign`, { method: 'POST', body: { assigneeId: user.id } });
    toast('Assigned to you', 'success');
    b.closest('li').animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(40px)' }], { duration: 350, fill: 'forwards' });
    setTimeout(load, 380);
  } catch (err) { toast(err.message, 'error'); b.disabled = false; }
});

await load();
onLive('request', load, 600);
