import { api } from '../api.js';
import { initPage } from '../layout.js';
import { esc, countUp, t } from '../ui.js';
import { icon } from '../icons.js';

await initPage({ roles: ['admin', 'facilitator'] });
const fStream = document.getElementById('f-stream');
const fCohort = document.getElementById('f-cohort');
const fmt = (v, unit = '') => (v === null || v === undefined ? '–' : `${v}${unit}`);

function table(columns, rows) {
  return `<table class="w-full text-left text-sm"><thead class="text-xs text-white/50"><tr>${columns.map(([, l]) => `<th scope="col" class="py-2 pr-3 font-medium">${t(l)}</th>`).join('')}</tr></thead>
    <tbody class="divide-y divide-white/10">${rows.map((r) => `<tr>${columns.map(([k, , f]) => `<td class="py-2 pr-3 tabular-nums">${esc(f ? f(r[k], r) : fmt(r[k]))}</td>`).join('')}</tr>`).join('') || `<tr><td class="py-3 text-white/50">${t('No data yet.')}</td></tr>`}</tbody></table>`;
}

function links() {
  const q = new URLSearchParams(Object.entries({ stream: fStream.value, cohort: fCohort.value }).filter(([, v]) => v));
  for (const [id, type] of [['dl-candidates', 'candidates'], ['dl-stages', 'stages'], ['dl-streams', 'streams'], ['dl-cohorts', 'cohorts']]) {
    const qs = new URLSearchParams(q);
    qs.set('type', type);
    document.getElementById(id).href = `/api/reports/programme/export.csv?${qs}`;
  }
}

async function load() {
  const r = await api('/reports/programme', { query: { stream: fStream.value, cohort: fCohort.value } });
  if (fStream.options.length === 1) fStream.insertAdjacentHTML('beforeend', r.options.streams.map((s) => `<option>${esc(s)}</option>`).join(''));
  if (fCohort.options.length === 1) fCohort.insertAdjacentHTML('beforeend', r.options.cohorts.map((s) => `<option>${esc(s)}</option>`).join(''));
  links();

  const k = [
    ['Candidates', r.totals.candidates, 'users', ''],
    ['Placement rate', r.totals.placementRate, 'trophy', '%'],
    ['Average days to placement', r.velocity.avgDaysToPlaced, 'clock', ''],
    ['Past stage target', r.totals.overdue, 'alert', ''],
  ];
  document.getElementById('kpis').innerHTML = k.map(([label, v, ic, unit]) => `
    <article class="card"><p class="flex items-center gap-2 text-sm text-white/60">${icon(ic, 'h-4 w-4 text-salmon-50')}${t(label)}</p>
      <p class="mt-3 font-display text-4xl font-semibold tabular-nums">${v === null || v === undefined ? '–' : `<span data-count="${v}">0</span>${unit}`}</p>
      ${label === 'Average days to placement' ? `<p class="mt-1 text-xs text-white/50">${t('From joining, {n} placed so far', { n: r.velocity.placedSample })}${r.velocity.avgDaysToCompleted !== null ? ` · ${t('{d} days to complete', { d: r.velocity.avgDaysToCompleted })}` : ''}</p>` : ''}
    </article>`).join('');
  countUp(document.getElementById('kpis'));

  // Average time per stage: one bar per stage (single hue), target as a marker; labels in text colour.
  const max = Math.max(1, ...r.stageTimes.flatMap((s) => [s.avgDays || 0, s.avgDaysSoFar || 0, s.targetDays || 0]));
  document.getElementById('stage-chart').innerHTML = r.stageTimes.map((s) => {
    const val = s.avgDays ?? s.avgDaysSoFar;
    const over = s.targetDays && val > s.targetDays;
    return `<div>
      <div class="flex items-baseline justify-between gap-2 text-sm"><span class="font-medium">${esc(t(s.label))}</span>
        <span class="tabular-nums text-white/80">${val === null ? t('no data') : `${val} ${t('days')}`}${s.avgDays === null && s.avgDaysSoFar !== null ? ` <span class="text-xs text-white/50">(${t('so far')})</span>` : ''}${s.targetDays ? ` <span class="text-xs text-white/50">/ ${t('target {d}', { d: s.targetDays })}</span>` : ''}</span></div>
      <div class="relative mt-1.5 h-2.5 rounded-full bg-white/10" role="img" aria-label="${esc(t(s.label))}: ${val ?? t('no data')} ${t('days')}${s.targetDays ? `, ${t('target {d}', { d: s.targetDays })}` : ''}">
        <div class="h-full rounded-full ${over ? 'bg-salmon' : 'bg-purple-50'}" style="width:${((val || 0) / max) * 100}%"></div>
        ${s.targetDays ? `<span class="absolute -top-1 h-[18px] w-0.5 rounded bg-snow ring-2 ring-night" style="left:calc(${(s.targetDays / max) * 100}% - 1px)" aria-hidden="true"></span>` : ''}
      </div>
      <p class="mt-1 text-xs text-white/50">${t('{n} in this stage now', { n: s.currentlyIn })}${s.overdueNow ? ` · <span class="text-warn">${t('{n} past target', { n: s.overdueNow })}</span>` : ''} · ${t('{n} completed spans', { n: s.completedSpans })}</p>
    </div>`;
  }).join('');
  document.getElementById('stage-table').innerHTML = table([['label', 'Stage'], ['targetDays', 'Target days'], ['avgDays', 'Average days'], ['completedSpans', 'Sample'], ['currentlyIn', 'In stage now'], ['avgDaysSoFar', 'Average so far'], ['overdueNow', 'Past target']], r.stageTimes);

  document.getElementById('stream-chart').innerHTML = r.byStream.map((g) => `
    <div><div class="flex items-baseline justify-between gap-2 text-sm"><span class="font-medium">${esc(g.stream)}</span>
      <span class="tabular-nums text-white/80">${fmt(g.placementRate, '%')} <span class="text-xs text-white/50">(${g.placed} ${t('of')} ${g.candidates})</span></span></div>
      <div class="mt-1.5 h-2.5 rounded-full bg-white/10" role="img" aria-label="${esc(g.stream)}: ${fmt(g.placementRate, '%')}"><div class="h-full rounded-full bg-purple-50" style="width:${g.placementRate || 0}%"></div></div></div>`).join('')
    || `<p class="text-sm text-white/50">${t('No data yet.')}</p>`;
  const groupCols = (key, label) => [[key, label], ['candidates', 'Candidates'], ['workReady', 'Work ready+'], ['placed', 'Placed+'], ['placementRate', 'Placement %', (v) => fmt(v, '%')], ['completionRate', 'Completion %', (v) => fmt(v, '%')], ['overdue', 'Past target']];
  document.getElementById('stream-table').innerHTML = table(groupCols('stream', 'Stream'), r.byStream);
  document.getElementById('cohort-table').innerHTML = table(groupCols('cohort', 'Cohort'), r.byCohort);

  document.getElementById('overdue').innerHTML = r.overdueCandidates.length ? r.overdueCandidates.map((c) => `
    <li class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warn/30 bg-warn/[0.06] p-3 text-sm">
      <span><a class="font-semibold hover:underline" href="/candidates?id=${c.id}">${esc(c.fullName)}</a> <span class="text-xs text-white/55">· ${esc(c.stream || '')} · ${esc(t(c.stage))}</span></span>
      <span class="tabular-nums text-warn">${t('{days} days (target {target})', { days: c.daysInStage, target: c.targetDays })}</span></li>`).join('')
    : `<li class="text-sm text-white/55">${icon('checkCircle', 'h-4 w-4 inline text-ok')} ${t('Everyone is within their stage target.')}</li>`;
}

fStream.addEventListener('change', load);
fCohort.addEventListener('change', load);
await load();
