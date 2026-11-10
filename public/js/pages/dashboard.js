import { api } from '../api.js';
import { initPage } from '../layout.js';
import { esc, fmtDate, fmtRelative, statusBadge, priorityBadge, toast, avatarHtml, countUp, tilt, t } from '../ui.js';
import { icon, categoryIcon } from '../icons.js';
import { createRoadmap } from '../components/roadmap.js';
import { renderAvatar } from '../components/avatar.js';
import { feedItem, wireReactions } from '../components/feed-item.js';
import { onLive } from '../live.js';

const user = await initPage({ roles: ['candidate'] });
const hour = new Date().getHours();
const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

document.getElementById('new-req').innerHTML = `${icon('plus', 'h-4 w-4')}New request`;
document.getElementById('ask-cammy').innerHTML = `${icon('chat', 'h-4 w-4')}Ask Cammy`;
document.getElementById('ask-cammy').addEventListener('click', () => document.getElementById('cammy-toggle')?.click());
const roadmap = createRoadmap(document.getElementById('roadmap-wrap'));
document.querySelector('#roadmap-wrap > section').id = 'roadmap';
tilt(document.getElementById('hero'), 3);

let rm = null;

async function loadProfileAndHero() {
  const [{ profile: p }, g] = await Promise.all([api('/profile/me'), api('/me/progress')]);
  document.getElementById('hero-title').innerHTML = `${t(greet)},<br><span class="text-gradient">${esc(p.firstName)}</span>`;
  document.getElementById('hero-chip').textContent = p.candidate?.stream || 'Candidate';
  document.getElementById('hero-level').textContent = t('Level {level} · {xp} XP', { level: g.level, xp: g.xp });
  document.getElementById('hero-sub').textContent = rm
    ? (rm.allComplete ? t('You have completed the CAPACITI programme. Congratulations!') : t('Official stage: {stage}. You are {pct}% of the way through the programme.', { stage: t(rm.stage.label), pct: rm.percentComplete }))
    : '';

  // Full-body avatar in the hero (no background so it blends into the card)
  document.getElementById('hero-avatar').innerHTML = `
    <div class="absolute inset-0 transition duration-500 group-hover:-translate-y-1 group-hover:scale-[1.02] [mask-image:linear-gradient(to_top,transparent,black_18%)]">${renderAvatar(p.avatar, { state: 'idle', background: false, label: 'Your avatar', live: true })}</div>
    ${!p.avatar.custom ? `<span class="chip absolute bottom-4 left-1/2 -translate-x-1/2 !bg-snow !text-kadet shadow-lg">${icon('palette', 'h-3.5 w-3.5')}Design your avatar</span>` : ''}`;

  const c = p.candidate || {};
  const row = (k, v, ic) => `<div class="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2"><span class="text-salmon-50">${icon(ic, 'h-4 w-4')}</span><span class="flex-1 text-xs text-white/50">${k}</span><span class="truncate text-right text-sm font-medium">${v ? esc(v) : '<span class="text-white/35">Not set</span>'}</span></div>`;
  document.getElementById('profile').innerHTML = `
    <div class="flex items-center gap-3">
      ${avatarHtml({ name: p.fullName, avatar: p.avatar, id: p.id }, 'h-14 w-14 text-lg')}
      <div class="min-w-0 flex-1"><h2 id="profile-title" class="truncate text-lg">${esc(p.fullName)}</h2><p class="truncate text-xs text-white/50">${esc(c.cohort || 'Cohort not set')}</p></div>
      <a href="/profile" class="btn btn-ghost btn-sm">Edit</a>
    </div>
    <div class="stagger mt-4 space-y-1.5">
      ${row('Stream', c.stream, 'compass')}${row('Mentor', c.mentor, 'user')}${row('Tech Champ', c.techChamp, 'bolt')}${row('Supervisor', c.supervisor, 'shield')}
    </div>`;
  renderBirthday(p);
}

let bdayTimer;
function renderBirthday(p) {
  const el = document.getElementById('birthday');
  if (!p.dateOfBirth) {
    el.innerHTML = `<h2 id="bday-title" class="text-lg">Birthday countdown</h2><p class="mt-2 text-sm text-white/60">Add your date of birth on your profile so we can celebrate you.</p><a href="/profile" class="btn btn-ghost btn-sm mt-4">Add birthday</a>`;
    return;
  }
  if (p.birthday.isToday) {
    const colours = ['#f25251', '#6115d0', '#f1d1d1', '#b08ae7', '#fbbf24'];
    el.classList.add('confetti');
    el.innerHTML = `${Array.from({ length: 22 }, (_, i) => `<i style="left:${(i * 41) % 100}%;background:${colours[i % 5]};animation-duration:${2.2 + (i % 4) * 0.6}s;animation-delay:${(i % 6) * 0.3}s"></i>`).join('')}
      <div class="relative text-center"><span class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-salmon to-purple text-snow animate-wiggle">${icon('cake', 'h-7 w-7')}</span><h2 id="bday-title" class="mt-3 text-2xl">${t('Happy birthday, {name}!', { name: esc(p.firstName) })}</h2>
      <p class="mt-1 text-sm text-white/70">${t('The whole CAPACITI family is celebrating you today.')}</p></div>`;
    return;
  }
  const target = new Date(`${p.birthday.next}T00:00:00`);
  el.innerHTML = `
    <div class="flex items-center justify-between"><h2 id="bday-title" class="text-lg">Birthday countdown</h2><span class="text-salmon-50 animate-wiggle">${icon('cake', 'h-6 w-6')}</span></div>
    <p class="mt-1 text-xs text-white/50">${fmtDate(p.birthday.next)} · ${t('turning {n}', { n: p.birthday.turning })}</p>
    <div class="mt-4 grid grid-cols-4 gap-2 text-center" role="timer" aria-live="off" aria-label="Time until your birthday">
      ${['days', 'hrs', 'min', 'sec'].map((u) => `<div class="rounded-2xl border border-white/10 bg-gradient-to-b from-white/10 to-white/[0.02] py-3"><span data-u="${u}" class="block font-display text-2xl font-semibold tabular-nums">--</span><span class="text-[0.65rem] tracking-wider text-white/50 uppercase">${u}</span></div>`).join('')}
    </div>`;
  const tick = () => {
    const ms = Math.max(0, target - Date.now());
    const vals = { days: Math.floor(ms / 864e5), hrs: Math.floor(ms / 36e5) % 24, min: Math.floor(ms / 6e4) % 60, sec: Math.floor(ms / 1e3) % 60 };
    for (const [u, v] of Object.entries(vals)) {
      const s = el.querySelector(`[data-u="${u}"]`);
      const t = String(v).padStart(2, '0');
      if (s && s.textContent !== t) {
        s.textContent = t;
        s.animate?.([{ transform: 'translateY(-6px)', opacity: 0.3 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'ease-out' });
      }
    }
  };
  tick();
  clearInterval(bdayTimer);
  bdayTimer = setInterval(tick, 1000);
}

async function loadStats() {
  const s = await api('/analytics/me');
  const tiles = [['Active', s.active, 'bg-purple-50'], ['Need reply', s.awaiting_you, 'bg-warn'], ['Resolved', s.resolved, 'bg-ok'], ['Total', s.total, 'bg-salmon']];
  document.getElementById('stats').innerHTML = tiles.map(([label, value, dot]) => `
    <div><p class="font-display text-3xl font-semibold tabular-nums" data-count="${value}">0</p>
      <p class="mt-1 flex items-center gap-1.5 text-xs text-white/60"><span class="h-2 w-2 rounded-full ${dot}" aria-hidden="true"></span>${label}</p>
      <span class="mt-2 block h-1 w-12 overflow-hidden rounded-full bg-white/10"><span class="block h-full ${dot} transition-all duration-1000" style="width:${s.total ? Math.round((value / s.total) * 100) : 0}%"></span></span></div>`).join('');
  countUp(document.getElementById('stats'));
}

async function loadRecent() {
  const { items } = await api('/requests', { query: { pageSize: 5, sort: 'updated', order: 'desc' } });
  document.getElementById('recent').innerHTML = items.length ? items.map((r) => `
    <li><a href="/request?id=${r.id}" class="group flex flex-wrap items-center gap-3 rounded-2xl border border-transparent p-3 transition hover:border-white/10 hover:bg-white/[0.05]">
      <span class="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-purple/40 to-salmon/20 text-white transition group-hover:scale-110">${categoryIcon(r.category)}</span>
      <span class="min-w-0 flex-1"><span class="block truncate font-medium">${esc(r.title)}</span><span class="block text-xs text-white/50">${esc(r.reference)} · ${esc(r.category)}</span></span>
      <span class="flex items-center gap-2">${priorityBadge(r.priority)}${statusBadge(r.status)}<span class="hidden w-24 text-right text-xs text-white/45 md:inline">${fmtRelative(r.updated_at)}</span></span>
    </a></li>`).join('')
    : '<li class="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-white/60">No requests yet. Need help? <a class="font-semibold text-salmon-50" href="/new-request">Raise your first request</a>.</li>';
}

async function loadFeed() {
  const { posts } = await api('/feed', { query: { limit: 3 } });
  const list = document.getElementById('feed');
  list.innerHTML = posts.length ? posts.map((p) => feedItem(p, { compact: true })).join('') : '<li class="text-sm text-white/50">Nothing yet.</li>';
}
wireReactions(document.getElementById('feed'), loadFeed);

async function loadUpcoming() {
  const { today, upcoming } = await api('/people/birthdays');
  const list = [...today, ...upcoming].filter((b) => b.id !== user.id && b.role === 'candidate').slice(0, 5);
  document.getElementById('upcoming').innerHTML = list.length ? list.map((b) => `
    <li class="flex items-center gap-3 rounded-2xl p-2 transition hover:bg-white/[0.05]">
      ${avatarHtml({ name: b.name, avatar: b.avatar, id: b.id }, 'h-10 w-10 text-xs')}
      <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">${esc(b.name)}</span><span class="block truncate text-xs text-white/50">${esc(b.stream || b.cohort || '')}</span></span>
      ${b.isToday ? `<span class="badge bg-gradient-to-r from-salmon to-purple text-snow">${icon('cake', 'h-3 w-3')}Today</span>` : `<span class="badge bg-white/10 text-white/70">${t('in {n} days', { n: b.daysUntil })}</span>`}
    </li>`).join('') : '<li class="text-sm text-white/50">No birthdays in the next two weeks.</li>';
}

// ---- What's next + candidate-requested stage review ----------------------------------
async function loadNextStep() {
  const el = document.getElementById('next-step');
  if (!rm) return;
  const { request } = await api('/stages/me/review');
  const n = rm.whatsNext;
  const st = rm.stage;
  const progressNote = st.targetDays ? t('{days} days in this stage (expected about {target})', { days: st.daysInStage, target: st.targetDays }) : '';
  el.innerHTML = `
    <div class="flex items-center gap-2 text-xs font-semibold tracking-wider text-white/55 uppercase"><span class="text-salmon-50">${icon('compass', 'h-4 w-4')}</span><span id="next-title">${t("What's next")}</span></div>
    ${rm.allComplete ? `<p class="mt-3 text-lg font-semibold">${t('You have completed the programme. Congratulations!')}</p>`
      : n ? `<p class="mt-3 text-lg font-semibold">${esc(t(n.label))}</p>
        ${n.tip ? `<p class="mt-1 text-sm text-white/70">${esc(t(n.tip))}</p>` : ''}
        ${n.evidenceKind ? `<a href="/profile#portfolio-sharing" class="btn btn-ghost btn-sm mt-3">${icon('paperclip', 'h-4 w-4')}${t('Upload evidence')}</a>` : ''}`
      : `<p class="mt-3 text-lg font-semibold">${t('Every exit criterion for {stage} is evidenced', { stage: esc(t(st.label)) })}</p>
        <p class="mt-1 text-sm text-white/70">${t('Your facilitator can now review you for {next}.', { next: esc(t(st.next?.label || '')) })}</p>`}
    ${progressNote ? `<p class="mt-3 text-xs ${st.overdue ? 'text-warn' : 'text-white/50'}">${st.overdue ? `${icon('clock', 'h-3.5 w-3.5 inline')} ` : ''}${progressNote}</p>` : ''}
    ${rm.allComplete ? '' : `<div class="mt-4 border-t border-white/10 pt-4">
      ${request
        ? `<p class="flex items-center gap-2 text-sm text-ok">${icon('checkCircle', 'h-4 w-4')}${t('Review requested {when}. Your facilitator has been notified.', { when: fmtRelative(request.createdAt) })}</p>`
        : `<form id="review-form" class="flex flex-wrap items-end gap-2">
            <div class="min-w-[12rem] flex-1"><label for="review-note" class="field-label">${t('Think you are ready for the next stage?')}</label>
              <input id="review-note" name="note" maxlength="500" class="field" placeholder="${t('Optional note for your facilitator')}"></div>
            <button class="btn btn-primary">${icon('flag', 'h-4 w-4')}${t('Request stage review')}</button>
          </form>`}
    </div>`}`;
  document.getElementById('review-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await api('/stages/me/review', { method: 'POST', body: { note: e.target.note.value.trim() || undefined } });
      toast(t('Review requested. Your facilitator has been notified.'), 'success');
      loadNextStep();
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  });
}

// ---- Interview invitations from recruiters -----------------------------------------
const IV_BADGE = { pending: 'bg-warn/15 text-warn', accepted: 'bg-ok/15 text-ok', declined: 'bg-white/10 text-white/60', withdrawn: 'bg-white/10 text-white/50' };
async function loadInterviews() {
  const { interviews } = await api('/career/interviews');
  const list = document.getElementById('iv-list');
  list.innerHTML = interviews.length ? interviews.map((i) => `
    <li class="rounded-2xl border ${i.status === 'pending' ? 'border-salmon/40 bg-salmon/[0.07]' : 'border-white/10 bg-white/[0.03]'} p-4">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0"><p class="font-semibold">${esc(i.roleTitle)} · ${esc(i.company)}</p>
          <p class="text-xs text-white/55">${t('From {name}', { name: esc(i.recruiterName) })} · ${esc(t(i.mode))}${i.proposedAt ? ` · ${esc(i.proposedAt.replace('T', ' '))}` : ''}</p></div>
        <span class="badge ${IV_BADGE[i.status]}">${esc(t(i.status))}</span>
      </div>
      ${i.message ? `<p class="mt-2 text-sm text-white/75" translate="no">${esc(i.message)}</p>` : ''}
      ${i.status === 'pending' ? `<form class="mt-3 flex flex-wrap items-end gap-2" data-iv="${i.id}">
          <div class="min-w-[10rem] flex-1"><label class="sr-only" for="iv-note-${i.id}">${t('Note to the recruiter')}</label><input id="iv-note-${i.id}" name="note" maxlength="500" class="field !py-1.5 text-sm" placeholder="${t('Optional note to the recruiter')}"></div>
          <button class="btn btn-primary btn-sm" data-accept="1">${t('Accept')}</button><button class="btn btn-ghost btn-sm" data-accept="0">${t('Decline')}</button>
        </form>` : i.candidateNote ? `<p class="mt-2 text-xs text-white/50">${t('Your note')}: <span translate="no">${esc(i.candidateNote)}</span></p>` : ''}
    </li>`).join('')
    : `<li class="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-white/55">${t('No interview invitations yet. Share your portfolio so recruiters can find you.')}</li>`;
}
document.getElementById('iv-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-accept]');
  if (!b) return;
  e.preventDefault();
  const form = b.closest('[data-iv]');
  form.querySelectorAll('button').forEach((x) => { x.disabled = true; });
  try {
    await api(`/career/interviews/${form.dataset.iv}/respond`, { method: 'POST', body: { accept: b.dataset.accept === '1', note: form.note.value.trim() || undefined } });
    toast(b.dataset.accept === '1' ? t('Interview accepted. The recruiter has been told.') : t('Invitation declined.'), 'success');
    loadInterviews();
  } catch (err) { toast(err.message, 'error'); form.querySelectorAll('button').forEach((x) => { x.disabled = false; }); }
});

const KIND_LABEL ={ cv: 'CV files', project: 'Project files', certificate: 'Certificates' };
async function loadPortfolioCards() {
  const [{ portfolio }, { files }] = await Promise.all([api('/recruiter/me'), api('/portfolio/files')]);
  const st = rm?.stage;
  const count = (k) => files.filter((f) => f.kind === k).length;
  const card = (ic, title, body) => `<article class="glass glow-ring flex flex-col p-5"><div class="flex items-center gap-2 text-xs font-semibold tracking-wider text-white/55 uppercase"><span class="text-salmon-50">${icon(ic, 'h-4 w-4')}</span>${title}</div>${body}</article>`;
  document.getElementById('pf-cards').innerHTML = [
    card('flag', t('Current stage'), st ? `<p class="mt-3 font-display text-2xl font-semibold">${esc(t(st.label))}</p>
      <p class="mt-1 text-xs text-white/55">${t('Since {date}', { date: fmtDate(st.since) })}${st.next ? ` · ${t('Next: {stage}', { stage: t(st.next.label) })}` : ''}</p>
      ${rm.readyForReview ? `<span class="badge mt-3 self-start bg-ok/15 text-ok">${icon('checkCircle', 'h-3.5 w-3.5')}${t('Ready for review')}</span>` : ''}
      ${st.lastDecision
        ? `<p class="mt-3 text-xs text-white/60">${t('Last decision by {name}, {when}', { name: esc(st.lastDecision.by), when: fmtRelative(st.lastDecision.at) })}</p>`
        : `<p class="mt-3 text-xs text-white/50">${t('Your facilitator approves each stage, one step at a time.')}</p>`}` : ''),
    card('folder', t('Portfolio items'), `<p class="mt-3 font-display text-2xl font-semibold tabular-nums">${portfolio.projects.length + files.length}</p>
      <ul class="mt-2 flex flex-wrap gap-1.5 text-xs">
        <li class="chip">${t('Project links')}: ${portfolio.projects.length}</li>${Object.keys(KIND_LABEL).map((k) => `<li class="chip">${t(KIND_LABEL[k])}: ${count(k)}</li>`).join('')}
      </ul>
      ${count('cv') ? '' : `<p class="mt-3 text-xs text-white/55">${t('Upload your CV so recruiters and your facilitator can see it.')}</p>`}`),
    card(portfolio.isPublished ? 'eye' : 'lock', t('Recruiter visibility'), `<p class="mt-3 font-display text-2xl font-semibold ${portfolio.isPublished ? 'text-ok' : ''}">${portfolio.isPublished ? t('Visible to recruiters') : t('Private')}</p>
      <p class="mt-1 text-xs text-white/55">${portfolio.isPublished ? t('Recruiters can see your shared profile, projects and files.') : t('Only you and the programme team can see your portfolio.')}</p>
      <a href="/profile#portfolio-sharing" class="btn btn-ghost btn-sm mt-auto self-start pt-2">${portfolio.isPublished ? t('Change sharing') : t('Share with recruiters')}</a>`),
  ].join('');
}

async function loadRoadmap() {
  try {
    rm = await api('/progress/me');
    roadmap.update(rm);
  } catch (err) {
    toast(`${t('Could not load your roadmap')}: ${err.message}`, 'error');
  }
}

await loadRoadmap();
await Promise.all([loadProfileAndHero(), loadStats(), loadRecent(), loadUpcoming(), loadFeed(), loadPortfolioCards(), loadNextStep(), loadInterviews()]);
if (location.hash === '#roadmap') document.getElementById('roadmap')?.scrollIntoView({ behavior: 'smooth' });

// Live updates — no polling
onLive('progress', async () => { await loadRoadmap(); loadProfileAndHero(); loadPortfolioCards(); loadNextStep(); toast('Your roadmap was just updated', 'success'); });
onLive('request', () => { loadStats(); loadRecent(); });
onLive('xp', loadProfileAndHero);
onLive('feed', loadFeed);
onLive('interview', loadInterviews);
if (location.hash === '#interviews') setTimeout(() => document.getElementById('interviews')?.scrollIntoView({ behavior: 'smooth' }), 500);
document.addEventListener('cammy:avatar', loadProfileAndHero);
