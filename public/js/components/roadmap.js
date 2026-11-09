/**
 * Interactive milestone roadmap.
 *   - Horizontal track from md up, vertical on mobile
 *   - Connectors fill in sequence, then an animated avatar marker glides to the active node
 *   - Amber pulse + badge when blocker-category tickets are open
 *   - Click / Enter on a node opens a flyout (bottom sheet on mobile) with milestone details
 *
 * Usage: const rm = createRoadmap(container, { editable, onToggleRequirement });
 *        rm.update(data)   // data = GET /api/progress/me shape
 */
import { esc, fmtDate, statusBadge, t } from '../ui.js';

const CHECK = '<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
import { renderAvatar } from './avatar.js';
const reduceMotion = () => document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

const STATE_LABEL = { completed: 'Completed', current: 'In progress', upcoming: 'Upcoming' };
const STATE_BADGE = {
  completed: 'bg-purple/25 text-purple-30',
  current: 'bg-salmon/20 text-salmon-50',
  upcoming: 'bg-white/10 text-white/60',
};

export function createRoadmap(root, { editable = false, onToggleRequirement, heading = 'Your programme journey' } = {}) {
  let data = null;
  let prevActive = null;
  let flyoutIndex = null;

  root.innerHTML = `
    <section class="card overflow-hidden" aria-labelledby="rm-title">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="rm-title" class="text-lg sm:text-xl">${esc(heading)}</h2>
          <p class="mt-0.5 text-sm text-white/60" data-rm-sub>Loading your progress…</p>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <div data-rm-alert></div>
          <div class="text-right">
            <p class="font-display text-3xl font-semibold text-gradient" data-rm-pct>–</p>
            <p class="text-xs text-white/60">overall complete</p>
          </div>
        </div>
      </div>
      <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <div data-rm-bar class="h-full w-0 rounded-full bg-gradient-to-r from-purple to-salmon transition-[width] duration-1000 ease-out"></div>
      </div>
      <div class="relative mt-8 md:mt-14" data-rm-stage>
        <ol class="relative flex flex-col md:flex-row" data-rm-track aria-label="Programme milestones"></ol>
      </div>
      <p class="sr-only" aria-live="polite" data-rm-live></p>
    </section>

    <dialog data-rm-flyout aria-labelledby="rm-fly-title"
      class="rm-flyout m-0 mt-auto max-h-[88vh] w-full max-w-none overflow-y-auto rounded-t-3xl border-white/10 bg-night/95 p-0 text-white shadow-2xl backdrop-blur-2xl md:border-l md:mt-0 md:ml-auto md:h-full md:max-h-none md:max-w-md md:rounded-none md:rounded-l-3xl">
      <div data-rm-fly-body></div>
    </dialog>`;

  const $ = (s) => root.querySelector(s);
  const track = $('[data-rm-track]');
  const stage = $('[data-rm-stage]');
  const flyout = $('[data-rm-flyout]');

  // ---- Flyout ----------------------------------------------------------
  flyout.addEventListener('click', (e) => {
    if (e.target === flyout) closeFlyout(); // backdrop click
    if (e.target.closest('[data-rm-close]')) closeFlyout();
  });
  flyout.addEventListener('cancel', (e) => { e.preventDefault(); closeFlyout(); });
  flyout.addEventListener('change', async (e) => {
    const box = e.target.closest('input[data-req-id]');
    if (!box || !onToggleRequirement) return;
    box.disabled = true;
    try {
      await onToggleRequirement(Number(box.dataset.reqId), box.checked);
    } catch {
      box.checked = !box.checked;
    } finally {
      box.disabled = false;
    }
  });

  function openFlyout(i) {
    flyoutIndex = i;
    renderFlyout();
    flyout.showModal();
    requestAnimationFrame(() => requestAnimationFrame(() => { flyout.dataset.open = 'true'; }));
  }

  function closeFlyout() {
    flyout.dataset.open = 'false';
    const done = () => { flyout.close(); track.querySelector(`[data-node="${flyoutIndex}"]`)?.focus(); flyoutIndex = null; };
    if (reduceMotion()) done(); else setTimeout(done, 380);
  }

  function renderFlyout() {
    const m = data.milestones[flyoutIndex];
    const done = m.requirements.filter((r) => r.completed);
    const remaining = m.requirements.filter((r) => !r.completed);
    const pct = m.totalCount ? Math.round((m.completedCount / m.totalCount) * 100) : (m.state === 'completed' ? 100 : 0);
    const isCurrent = m.state === 'current';
    const blockers = isCurrent ? data.blockers : [];

    const reqItem = (r) => editable
      ? `<li><label class="flex cursor-pointer items-start gap-3 rounded-lg p-2 transition hover:bg-white/5">
           <input type="checkbox" data-req-id="${r.id}" ${r.completed ? 'checked' : ''} class="mt-0.5 h-4 w-4 accent-purple">
           <span class="flex-1 text-sm">${esc(r.label)}
             ${r.completed ? `<span class="block text-xs text-white/60">${fmtDate(r.completedAt)}${r.verifiedBy ? ` · verified by ${esc(r.verifiedBy)}` : ''}</span>` : ''}
           </span></label></li>`
      : r.completed
        ? `<li class="flex items-start gap-3 py-2">
             <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple text-white">${CHECK.replace('h-6 w-6', 'h-3 w-3')}</span>
             <span class="flex-1 text-sm">${esc(r.label)}<span class="block text-xs text-white/60">${t('Completed {date}', { date: fmtDate(r.completedAt) })}</span></span></li>`
        : `<li class="flex items-start gap-3 py-2">
             <span class="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-dashed border-white/25"></span>
             <span class="text-sm text-white/60">${esc(r.label)}</span></li>`;

    $('[data-rm-fly-body]').innerHTML = `
      <div class="sticky top-0 z-10 border-b border-white/10 bg-night/90 px-6 pt-4 pb-4 backdrop-blur">
        <div class="mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/30 md:hidden" aria-hidden="true"></div>
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-xs font-semibold tracking-wider text-white/60 uppercase">${t('Stage {n} of {total}', { n: flyoutIndex + 1, total: data.milestones.length })}</p>
            <h3 id="rm-fly-title" class="mt-1 text-xl">${esc(m.title)}</h3>
            <span class="badge mt-2 ${STATE_BADGE[m.state]}">${STATE_LABEL[m.state]}</span>
          </div>
          <button type="button" data-rm-close class="rounded-full p-2 text-white/60 transition hover:bg-white/10 hover:text-white" aria-label="Close details">
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
      </div>
      <div class="space-y-6 px-6 py-6">
        <p class="text-sm text-white/60">${esc(m.description)}</p>

        <div>
          <div class="flex items-baseline justify-between text-sm">
            <span class="font-medium">${m.totalCount ? t('{done} of {total} exit criteria evidenced', { done: m.completedCount, total: m.totalCount }) : t('No checklist for this stage')}</span>
            <span class="text-white/60">${pct}%</span>
          </div>
          <div class="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
            <div class="h-full rounded-full bg-gradient-to-r from-purple to-salmon transition-[width] duration-700" style="width:${pct}%"></div>
          </div>
        </div>

        <dl class="grid grid-cols-2 gap-3 text-sm">
          <div class="rounded-xl bg-white/5 p-3"><dt class="text-xs text-white/60">Started</dt><dd class="mt-0.5 font-semibold">${fmtDate(m.startedAt)}</dd></div>
          <div class="rounded-xl bg-white/5 p-3"><dt class="text-xs text-white/60">Achieved</dt><dd class="mt-0.5 font-semibold">${m.achievedAt ? fmtDate(m.achievedAt) : m.state === 'current' ? 'In progress' : 'Not yet'}</dd></div>
        </dl>

        ${m.decision ? `<div class="rounded-xl border border-purple/30 bg-purple/10 p-3 text-sm"><p class="text-xs font-semibold tracking-wide text-purple-30 uppercase">${t('Official stage decision')}</p>
          <p class="mt-1">${t('Approved by {name} on {date}', { name: esc(m.decision.by), date: fmtDate(m.decision.at) })}</p><p class="mt-1 text-xs text-white/65" translate="no">${esc(m.decision.reason)}</p></div>` : ''}
        ${isCurrent && data.readyForReview ? `<p class="rounded-xl border border-ok/30 bg-ok/10 p-3 text-sm font-medium text-ok" role="status">${t('Every exit criterion is evidenced. Waiting for a facilitator to approve the next stage.')}</p>` : ''}

        ${blockers.length ? `
          <div class="rounded-xl border border-warn/30 bg-warn/10 p-4" role="note">
            <p class="flex items-center gap-2 text-sm font-semibold text-warn">
              <span class="relative flex h-2.5 w-2.5"><span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-glow opacity-75"></span><span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-glow"></span></span>
              Active support intervention
            </p>
            <ul class="mt-2 space-y-2">
              ${blockers.map((b) => `<li><a href="/request?id=${b.id}" class="block rounded-lg bg-white/5 p-2 text-sm transition hover:bg-white/10">
                <span class="font-semibold">${esc(b.reference)}</span> · ${esc(b.category)}
                <span class="mt-1 flex flex-wrap items-center gap-2">${statusBadge(b.status)}${b.needsYourAction && !editable ? '<span class="text-xs font-semibold text-warn">Your reply is needed</span>' : ''}</span></a></li>`).join('')}
            </ul>
          </div>` : ''}

        ${editable ? `
          <section><h4 class="text-sm font-semibold">Exit criteria (supporting evidence)</h4>
            <p class="text-xs text-white/60">Tick to verify evidence. Evidence never changes the official stage: a facilitator approves that separately.</p>
            <ul class="mt-2 space-y-1">${m.requirements.map(reqItem).join('')}</ul></section>` : `
          ${done.length ? `<section><h4 class="text-sm font-semibold">What you've completed</h4><ul class="mt-1 divide-y divide-white/10">${done.map(reqItem).join('')}</ul></section>` : ''}
          ${remaining.length ? `<section><h4 class="text-sm font-semibold">Remaining requirements</h4><ul class="mt-1 divide-y divide-white/10">${remaining.map(reqItem).join('')}</ul></section>`
            : m.totalCount ? '<p class="rounded-xl bg-purple/20 p-4 text-sm font-medium text-purple-30">Every exit criterion for this stage is evidenced.</p>' : ''}`}
      </div>`;
  }

  // ---- Track -----------------------------------------------------------
  function render() {
    const { milestones, activeIndex, blockers, allComplete } = data;
    const hasBlockers = blockers.length > 0;

    track.innerHTML = milestones.map((m, i) => {
      const last = i === milestones.length - 1;
      const fill = i < activeIndex ? 1 : i === activeIndex && !allComplete && m.totalCount ? m.completedCount / m.totalCount : 0;
      const nodeStyle = m.state === 'completed'
        ? 'bg-purple text-white shadow-md shadow-purple/30 hover:scale-110'
        : m.state === 'current'
          ? 'bg-night text-salmon ring-4 ring-salmon/40 hover:scale-105'
          : 'bg-white/5 text-white/50 border-2 border-white/20 hover:border-purple-50 hover:text-white hover:scale-110';

      return `
        <li class="relative flex gap-4 pb-10 last:pb-0 md:flex-1 md:flex-col md:items-center md:gap-0 md:pb-0 md:text-center">
          ${last ? '' : `
            <span class="absolute top-16 bottom-1 left-[27px] w-1 overflow-hidden rounded-full bg-white/10 md:top-[26px] md:right-[calc(-50%+36px)] md:bottom-auto md:left-[calc(50%+36px)] md:h-1 md:w-auto" aria-hidden="true">
              <span class="rm-fill absolute inset-0 rounded-full bg-gradient-to-b from-purple to-purple-80 md:bg-gradient-to-r" style="--fill:${fill}; transition-delay:${i * 180}ms" data-filled="false"></span>
            </span>`}
          <button type="button" data-node="${i}" data-revealed="false"
            style="transition-delay:${i * 180}ms"
            class="rm-node relative z-10 flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center rounded-full text-lg font-semibold focus-visible:outline-offset-4 ${nodeStyle}"
            aria-label="${t('Milestone {n} of {total}', { n: i + 1, total: milestones.length })}: ${esc(t(m.title))}. ${t(STATE_LABEL[m.state])}, ${t('{done} of {total} requirements', { done: m.completedCount, total: m.totalCount })}${m.state === 'current' && hasBlockers ? `, ${t('Support active')}` : ''}. ${t('Show details')}.">
            ${m.state === 'completed' ? CHECK : i + 1}
          </button>
          <div class="pt-1 md:mt-4 md:max-w-[11rem] md:px-2 md:pt-0">
            <p class="text-sm font-semibold leading-snug ${m.state === 'upcoming' ? 'text-white/60' : 'text-white'}">${esc(m.title)}</p>
            <p class="mt-1 text-xs text-white/60">
              ${m.state === 'completed' ? t('Achieved {date}', { date: fmtDate(m.achievedAt) }) : m.state === 'current' ? (m.totalCount ? t('{done}/{total} evidence items', { done: m.completedCount, total: m.totalCount }) : t('Current stage')) : t('Upcoming')}
            </p>
            ${m.state === 'current' && hasBlockers ? `
              <span class="badge mt-2 bg-warn/15 text-warn"><span class="h-1.5 w-1.5 rounded-full bg-amber-glow animate-pulse" aria-hidden="true"></span>Support active</span>` : ''}
          </div>
        </li>`;
    }).join('');

    // Animated marker (lives in the stage so it can glide between nodes)
    stage.querySelector('[data-rm-marker]')?.remove();
    const marker = document.createElement('div');
    marker.dataset.rmMarker = '';
    marker.setAttribute('aria-hidden', 'true');
    marker.className = 'rm-marker pointer-events-none absolute top-0 left-0 z-20 h-14 w-14 opacity-0';
    marker.innerHTML = `
      <span class="absolute inset-0 rounded-full ${hasBlockers ? 'bg-amber-glow' : 'bg-salmon'} animate-ring-pulse"></span>
      <span class="absolute inset-0 rounded-full ${hasBlockers ? 'bg-amber-glow' : 'bg-salmon'} animate-ring-pulse [animation-delay:1.1s]"></span>
      <span class="absolute -top-9 left-1/2 hidden -translate-x-1/2 animate-float whitespace-nowrap rounded-full bg-snow px-2.5 py-1 text-[0.65rem] font-semibold tracking-wide text-kadet shadow md:block">
        ${allComplete ? 'Completed!' : 'You are here'}
        <span class="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-snow"></span>
      </span>
      <span class="relative block h-14 w-14 overflow-hidden rounded-full bg-gradient-to-br from-salmon to-purple shadow-lg ring-4 ring-night ${hasBlockers ? 'animate-amber-pulse' : ''}">
        ${data.candidate.avatar ? renderAvatar(data.candidate.avatar, { crop: 'head', state: allComplete ? 'celebrating' : hasBlockers ? 'concerned' : 'idle', label: data.candidate.name }) : esc(initials(data.candidate.name))}
      </span>
      ${hasBlockers ? `<span class="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-glow text-[0.65rem] font-bold text-white ring-2 ring-night">${blockers.length}</span>` : ''}`;
    stage.append(marker);

    track.querySelectorAll('[data-node]').forEach((btn) => btn.addEventListener('click', () => openFlyout(Number(btn.dataset.node))));

    // Kick off staged animation
    const animate = !reduceMotion();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      track.querySelectorAll('[data-node]').forEach((n) => { n.dataset.revealed = 'true'; });
      track.querySelectorAll('.rm-fill').forEach((f) => { f.dataset.filled = 'true'; });
      const from = prevActive ?? 0;
      placeMarker(marker, from, false);
      marker.classList.remove('opacity-0');
      const delay = animate && prevActive === null ? 250 + activeIndex * 180 : 50;
      setTimeout(() => { placeMarker(marker, activeIndex, true); marker.dataset.arrived = '1'; }, delay);
      prevActive = activeIndex;
    }));
  }

  function placeMarker(marker, index, animated) {
    const node = track.querySelector(`[data-node="${index}"]`);
    if (!node) return;
    // Measure the untransformed layout box (the node may be mid scale-in animation).
    const s = stage.getBoundingClientRect();
    const li = node.offsetParent.getBoundingClientRect();
    const x = li.left - s.left + node.offsetLeft;
    const y = li.top - s.top + node.offsetTop;
    marker.style.transitionDuration = animated && !reduceMotion() ? '' : '0s';
    marker.style.transform = `translate(${x}px, ${y}px)`;
  }

  // Keep the marker anchored when layout shifts (window resize, web fonts loading, sidebar, etc.).
  let resizeRaf;
  const reanchor = () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      const marker = stage.querySelector('[data-rm-marker]');
      if (marker?.dataset.arrived && data) placeMarker(marker, data.activeIndex, false);
    });
  };
  new ResizeObserver(reanchor).observe(track);
  document.fonts?.ready.then(reanchor);

  function renderHeader() {
    const { milestones, activeIndex, blockers, percentComplete, allComplete } = data;
    const current = milestones[activeIndex];
    $('[data-rm-sub]').textContent = allComplete
      ? t('Official stage: Completed. Congratulations on completing the programme.')
      : `${t('Official stage: {title} · step {n} of {total}', { title: t(current.title), n: activeIndex + 1, total: milestones.length })}${data.readyForReview ? ` · ${t('Ready for review')}` : ''}`;
    $('[data-rm-pct]').textContent = `${percentComplete}%`;
    requestAnimationFrame(() => { $('[data-rm-bar]').style.width = `${percentComplete}%`; });

    const waiting = blockers.filter((b) => b.needsYourAction).length;
    $('[data-rm-alert]').innerHTML = blockers.length ? `
      <button type="button" data-rm-alert-btn class="flex items-center gap-2 rounded-full border border-warn/40 bg-warn/10 px-3 py-1.5 text-xs font-semibold text-warn transition hover:border-amber-glow">
        <span class="relative flex h-2.5 w-2.5"><span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-glow opacity-75"></span><span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-glow"></span></span>
        ${t('Support cases affecting progress: {n}', { n: blockers.length })}${waiting && !editable ? ` · ${t('Waiting for your reply: {n}', { n: waiting })}` : ''}
      </button>` : '';
    $('[data-rm-alert-btn]')?.addEventListener('click', () => openFlyout(activeIndex));
  }

  return {
    update(next) {
      if (data && JSON.stringify(next) === JSON.stringify(data)) return; // nothing changed (live poll)
      const moved = data && next.activeIndex !== data.activeIndex;
      data = next;
      renderHeader();
      render();
      if (flyoutIndex !== null) renderFlyout();
      if (moved) {
        $('[data-rm-live]').textContent = `Official stage updated: you are now at ${next.milestones[next.activeIndex].title}.`;
      }
    },
  };
}

