import { api } from '../api.js';
import { initPage } from '../layout.js';
import { esc, toast, fmtDate, fmtRelative, t } from '../ui.js';
import { onLive } from '../live.js';

const user = await initPage({ roles: ['recruiter', 'admin', 'facilitator', 'support'] });
const isRecruiter = user.role === 'recruiter';
document.getElementById('iv-scope').textContent = isRecruiter
  ? t('Requests you have sent. Candidates accept or decline from their dashboard.')
  : user.role === 'facilitator' ? t('Interview requests for candidates in your streams.') : t('All interview requests from recruiters.');

const BADGE = { pending: 'bg-warn/15 text-warn', accepted: 'bg-ok/15 text-ok', declined: 'bg-white/10 text-white/60', withdrawn: 'bg-white/10 text-white/50' };
let filter = 'all';
let items = [];

const filterEl = document.getElementById('iv-filter');
filterEl.innerHTML = ['all', 'pending', 'accepted', 'declined'].map((f) => `<button type="button" data-f="${f}" aria-pressed="${f === filter}" class="btn btn-sm ${f === filter ? 'btn-primary' : 'btn-ghost'}">${t(f[0].toUpperCase() + f.slice(1))}</button>`).join('');
filterEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-f]');
  if (!b) return;
  filter = b.dataset.f;
  filterEl.querySelectorAll('[data-f]').forEach((x) => { x.setAttribute('aria-pressed', String(x === b)); x.className = `btn btn-sm ${x === b ? 'btn-primary' : 'btn-ghost'}`; });
  render();
});

function render() {
  const rows = items.filter((i) => filter === 'all' || i.status === filter);
  document.getElementById('iv-list').innerHTML = rows.length ? rows.map((i) => `
    <li class="flex flex-wrap items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div class="min-w-0 flex-1">
        <p class="font-semibold">${esc(i.roleTitle)} · ${esc(i.company)}</p>
        <p class="text-xs text-white/55">${isRecruiter ? `${t('Candidate')}: <a class="text-salmon-50 hover:underline" href="/candidate-profiles?id=${i.candidateId}">${esc(i.candidateName)}</a>` : `${esc(i.candidateName)}${i.stream ? ` (${esc(i.stream)})` : ''} · ${t('from {name}', { name: esc(i.recruiterName) })}`}
          · ${esc(t(i.mode))}${i.proposedAt ? ` · ${esc(i.proposedAt.replace('T', ' '))}` : ''} · ${t('sent {when}', { when: fmtRelative(i.createdAt) })}</p>
        ${i.message ? `<p class="mt-1 text-sm text-white/70" translate="no">${esc(i.message)}</p>` : ''}
        ${i.candidateNote ? `<p class="mt-1 text-sm text-white/70">${t('Candidate note')}: <span translate="no">${esc(i.candidateNote)}</span></p>` : ''}
        ${i.respondedAt ? `<p class="mt-1 text-xs text-white/45">${t('Answered {date}', { date: fmtDate(i.respondedAt) })}</p>` : ''}
      </div>
      <span class="badge ${BADGE[i.status]}">${esc(t(i.status))}</span>
      ${isRecruiter && i.status === 'pending' ? `<button type="button" class="btn btn-ghost btn-sm" data-withdraw="${i.id}">${t('Withdraw')}</button>` : ''}
    </li>`).join('') : `<li class="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-white/55">${t('No interview requests here yet.')}${isRecruiter ? ` <a class="font-semibold text-salmon-50" href="/talent-board">${t('Find candidates')}</a>` : ''}</li>`;
}

async function load() {
  ({ interviews: items } = await api('/career/interviews'));
  render();
}
document.getElementById('iv-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-withdraw]');
  if (!b || !confirm(t('Withdraw this interview request?'))) return;
  try { await api(`/recruiter/interviews/${b.dataset.withdraw}/withdraw`, { method: 'POST' }); toast(t('Request withdrawn'), 'success'); load(); } catch (err) { toast(err.message, 'error'); }
});
await load();
onLive('interview', load);
