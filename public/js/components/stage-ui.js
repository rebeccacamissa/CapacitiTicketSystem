// Shared bits for official programme stages (badges, evidence bars, decision rows).
import { esc, fmtDate, fmtRelative, avatarHtml, t } from '../ui.js';
import { icon } from '../icons.js';

// One hue family, light to dark as the candidate progresses (stage is ordered, so sequential colour).
export const STAGE_STYLE = {
  enrolled: 'bg-white/10 text-white/80',
  training: 'bg-purple/25 text-purple-30',
  work_ready: 'bg-purple/45 text-white',
  placed: 'bg-salmon/25 text-salmon-50',
  completed: 'bg-ok/20 text-ok',
};

export const stageBadge = (key, label) => `<span class="badge ${STAGE_STYLE[key] || 'bg-white/10'}">${esc(t(label))}</span>`;

export function evidenceBar(done, total) {
  if (!total) return `<span class="text-xs text-white/45">${t('No checklist')}</span>`;
  const pct = Math.round((done / total) * 100);
  return `<span class="flex items-center gap-2"><span class="block h-1.5 w-20 overflow-hidden rounded-full bg-white/10" aria-hidden="true"><span class="block h-full rounded-full ${done >= total ? 'bg-ok' : 'bg-gradient-to-r from-purple to-salmon'}" style="width:${pct}%"></span></span>
    <span class="text-xs whitespace-nowrap tabular-nums text-white/65">${t('{done} of {total}', { done, total })}</span></span>`;
}

/** One row of the stage audit trail: who, when, why. */
export function decisionItem(d, { showCandidate = true } = {}) {
  const dir = d.direction === 'backward'
    ? `<span class="badge bg-warn/15 text-warn">${icon('undo', 'h-3 w-3')}${t('Moved back')}</span>`
    : d.direction === 'initial' ? `<span class="badge bg-white/10 text-white/70">${t('Imported')}</span>` : '';
  return `<li class="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
    <div class="flex flex-wrap items-center gap-2 text-sm">
      ${showCandidate ? `<a href="/stage-decisions?candidate=${d.candidateId}" class="font-semibold hover:underline">${esc(d.candidateName)}</a><span class="text-white/40">·</span>` : ''}
      ${d.fromStage ? `${stageBadge(d.fromStage, d.fromLabel)}<span class="text-white/45" aria-label="${t('to')}">${icon('arrowRight', 'h-3.5 w-3.5')}</span>` : ''}${stageBadge(d.toStage, d.toLabel)} ${dir}
      <span class="ml-auto text-xs text-white/50" title="${esc(fmtDate(d.createdAt))}">${fmtRelative(d.createdAt)}</span>
    </div>
    <p class="mt-2 text-sm text-white/80" translate="no">${esc(d.reason)}</p>
    <p class="mt-1 text-xs text-white/50">${t('Decided by {name}', { name: esc(d.decidedBy) })}${d.stream ? ` · ${esc(d.stream)}` : ''} · ${fmtDate(d.createdAt)}</p>
  </li>`;
}

export const candidateCell = (c) => `<span class="flex items-center gap-3">${avatarHtml({ name: c.fullName, avatar: c.avatar, id: c.id }, 'h-9 w-9 text-xs')}
  <span class="min-w-0"><span class="block truncate font-medium">${esc(c.fullName)}</span><span class="block truncate text-xs text-white/50">${esc(c.cohort || c.email || '')}</span></span></span>`;
