import { api } from '../api.js';
import { initPage } from '../layout.js';
import { esc, countUp, t } from '../ui.js';
import { icon } from '../icons.js';
import { onLive } from '../live.js';
import { stageBadge, evidenceBar, candidateCell } from '../components/stage-ui.js';

const user = await initPage({ roles: ['facilitator'] });
document.getElementById('fac-hello').textContent = t('Hi {name}, here are your streams', { name: user.firstName });
const filter = document.getElementById('fac-filter');
let data;

async function load() {
  const [list, pipe] = await Promise.all([api('/stages/candidates'), api('/stages/pipeline')]);
  data = list;
  document.getElementById('fac-streams').innerHTML = list.streams?.length
    ? list.streams.map((s) => `<span class="chip mr-1 mb-1">${esc(s)}</span>`).join('')
    : t('You are not assigned to a stream yet. Ask an administrator to assign you.');

  const kpis = [
    ['Candidates', pipe.total, 'users'],
    ['Awaiting review', pipe.awaitingReview, 'hourglass'],
    ['In training', pipe.byStage.training, 'book'],
    ['Work ready', pipe.byStage.work_ready, 'checkCircle'],
  ];
  document.getElementById('fac-kpis').innerHTML = kpis.map(([label, n, ic]) => `
    <article class="card"><p class="flex items-center gap-2 text-sm text-white/60">${icon(ic, 'h-4 w-4 text-salmon-50')}${t(label)}</p>
      <p class="mt-3 font-display text-4xl font-semibold tabular-nums" data-count="${n}">0</p></article>`).join('');
  countUp(document.getElementById('fac-kpis'));

  const ready = list.candidates.filter((c) => c.readyForReview);
  document.getElementById('fac-ready').innerHTML = ready.length ? ready.map((c) => `
    <li><a href="/stage-decisions?candidate=${c.id}" class="block rounded-2xl border border-ok/25 bg-ok/[0.06] p-3 transition hover:bg-ok/10">
      ${candidateCell(c)}<span class="mt-2 flex flex-wrap items-center gap-1 pl-12 text-xs text-white/70">${stageBadge(c.stage, c.stageLabel)}${icon('arrowRight', 'h-3.5 w-3.5')}${stageBadge(c.nextStage.key, c.nextStage.label)}</span></a></li>`).join('')
    : `<li class="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-white/55">${t('Nobody is waiting for a review right now.')}</li>`;

  if (!filter.options.length) {
    filter.innerHTML = `<option value="">${t('All stages')}</option>${list.stages.map((s) => `<option value="${s.key}">${esc(t(s.label))}</option>`).join('')}`;
  }
  renderRows();
}

function renderRows() {
  const rows = data.candidates.filter((c) => !filter.value || c.stage === filter.value);
  document.getElementById('fac-rows').innerHTML = rows.length ? rows.map((c) => `
    <tr>
      <td class="py-3 pr-3">${candidateCell(c)}</td>
      <td class="py-3 pr-3 text-white/70">${esc(c.stream || '')}</td>
      <td class="py-3 pr-3">${stageBadge(c.stage, c.stageLabel)}${c.readyForReview ? ` <span class="badge bg-ok/15 text-ok">${t('Ready')}</span>` : ''}</td>
      <td class="py-3 pr-3">${evidenceBar(c.evidenceDone, c.evidenceTotal)}</td>
      <td class="py-3 text-right"><span class="flex flex-col items-end gap-1">
        <a href="/candidates?id=${c.id}" class="btn btn-ghost btn-sm">${t('Evidence')}</a>
        ${c.nextStage ? `<a href="/stage-decisions?candidate=${c.id}" class="btn btn-ghost btn-sm">${t('Review stage')}</a>` : ''}
      </span></td>
    </tr>`).join('') : `<tr><td colspan="5" class="py-6 text-center text-white/55">${t('No candidates at this stage.')}</td></tr>`;
}

filter.addEventListener('change', renderRows);
await load();
onLive('people', load);
