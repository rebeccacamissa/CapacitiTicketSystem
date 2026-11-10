import { api } from '../api.js';
import { initPage } from '../layout.js';
import { esc, toast, setBusy, fmtDate, t } from '../ui.js';
import { icon } from '../icons.js';

await initPage({ roles: ['candidate'] });

// =====================================================================================
// CV builder
// =====================================================================================
const form = document.getElementById('cvb');
let { cv, updatedAt, limits } = await api('/career/cv');

const SECTIONS = {
  experience: { label: 'Experience', add: 'Add experience', blank: { role: '', organisation: '', start: '', end: '', points: [''] } },
  education: { label: 'Education', add: 'Add qualification', blank: { qualification: '', institution: '', year: '' } },
  projects: { label: 'Projects', add: 'Add project', blank: { name: '', description: '', link: '' } },
  certifications: { label: 'Certifications', add: 'Add certification', blank: { name: '', issuer: '', year: '' } },
};

const input = (name, label, value, attrs = '') => `<div><label class="field-label" for="cv-${name}">${t(label)}</label><input id="cv-${name}" data-k="${name}" value="${esc(value || '')}" class="field" ${attrs}></div>`;

function rowHtml(section, item, i) {
  const f = (k, label, attrs = '') => `<div><label class="field-label" for="cv-${section}-${i}-${k}">${t(label)}</label><input id="cv-${section}-${i}-${k}" data-s="${section}" data-i="${i}" data-k="${k}" value="${esc(item[k] || '')}" class="field" ${attrs}></div>`;
  const remove = `<button type="button" class="btn btn-ghost btn-sm" data-remove="${section}" data-i="${i}" aria-label="${t('Remove')} ${t(SECTIONS[section].label)} ${i + 1}">${t('Remove')}</button>`;
  if (section === 'experience') {
    return `<div class="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><div class="grid gap-3 sm:grid-cols-2">
      ${f('role', 'Role', 'maxlength="120"')}${f('organisation', 'Organisation', 'maxlength="120"')}${f('start', 'Start (e.g. Jan 2025)', 'maxlength="20"')}${f('end', 'End (or "Present")', 'maxlength="20"')}
      <div class="sm:col-span-2"><label class="field-label" for="cv-exp-pts-${i}">${t('What you did (one per line)')}</label>
        <textarea id="cv-exp-pts-${i}" data-s="experience" data-i="${i}" data-k="points" rows="3" class="field" maxlength="1900">${esc((item.points || []).join('\n'))}</textarea></div></div>
      <div class="mt-2 text-right">${remove}</div></div>`;
  }
  if (section === 'education') return `<div class="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end">${f('qualification', 'Qualification', 'maxlength="160"')}${f('institution', 'Institution', 'maxlength="160"')}${f('year', 'Year', 'maxlength="20"')}${remove}</div>`;
  if (section === 'projects') return `<div class="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><div class="grid gap-3 sm:grid-cols-2">${f('name', 'Project name', 'maxlength="120"')}${f('link', 'Link (https://)', 'type="url" maxlength="300"')}
    <div class="sm:col-span-2">${f('description', 'What it is and what you did', 'maxlength="500"')}</div></div><div class="mt-2 text-right">${remove}</div></div>`;
  return `<div class="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end">${f('name', 'Certification', 'maxlength="160"')}${f('issuer', 'Issuer', 'maxlength="120"')}${f('year', 'Year', 'maxlength="20"')}${remove}</div>`;
}

function renderBuilder() {
  form.innerHTML = `
    <fieldset class="grid gap-4 sm:grid-cols-2"><legend class="mb-2 text-sm font-semibold">${t('About you')}</legend>
      ${input('fullName', 'Full name', cv.fullName, 'maxlength="120" required')}${input('headline', 'Headline (e.g. Junior Data Analyst)', cv.headline, 'maxlength="120"')}
      ${input('email', 'Email', cv.email, 'type="email" maxlength="254"')}${input('phone', 'Phone', cv.phone, 'maxlength="30"')}
      ${input('location', 'Location (city)', cv.location, 'maxlength="80"')}${input('linkedin', 'LinkedIn (https://)', cv.linkedin, 'type="url" maxlength="300"')}
      ${input('github', 'GitHub or portfolio (https://)', cv.github, 'type="url" maxlength="300"')}
      <div class="sm:col-span-2"><label class="field-label" for="cv-summary">${t('Profile summary (2–4 sentences)')}</label><textarea id="cv-summary" data-k="summary" rows="3" maxlength="1200" class="field" data-voice>${esc(cv.summary || '')}</textarea></div>
      <div class="sm:col-span-2"><label class="field-label" for="cv-skills">${t('Skills (comma-separated)')}</label><input id="cv-skills" data-k="skills" value="${esc((cv.skills || []).join(', '))}" class="field" maxlength="1500"></div>
    </fieldset>
    ${Object.entries(SECTIONS).map(([key, s]) => `
      <fieldset><legend class="mb-2 text-sm font-semibold">${t(s.label)}</legend>
        <div class="space-y-3">${(cv[key] || []).map((item, i) => rowHtml(key, item, i)).join('') || `<p class="text-sm text-white/50">${t('Nothing added yet.')}</p>`}</div>
        ${(cv[key] || []).length < limits[key] ? `<button type="button" class="btn btn-ghost btn-sm mt-3" data-add="${key}">${icon('plus', 'h-4 w-4')}${t(s.add)}</button>` : ''}
      </fieldset>`).join('')}
    <div class="flex flex-wrap justify-end gap-2 border-t border-white/10 pt-4">
      <button type="submit" class="btn btn-ghost">${t('Save')}</button>
      <button type="button" class="btn btn-ghost" data-pdf>${icon('download', 'h-4 w-4')}${t('Save and download PDF')}</button>
      <button type="button" class="btn btn-primary" data-store>${icon('folder', 'h-4 w-4')}${t('Save PDF to my documents')}</button>
    </div>`;
  document.getElementById('cvb-saved').textContent = updatedAt ? t('Last saved {date}', { date: fmtDate(updatedAt) }) : t('Not saved yet');
}

/** Read every field back into `cv`. */
function collect() {
  for (const el of form.querySelectorAll('[data-k]:not([data-s])')) {
    cv[el.dataset.k] = el.dataset.k === 'skills' ? el.value.split(',').map((s) => s.trim()).filter(Boolean) : el.value.trim();
  }
  for (const el of form.querySelectorAll('[data-s]')) {
    const item = cv[el.dataset.s][Number(el.dataset.i)];
    item[el.dataset.k] = el.dataset.k === 'points' ? el.value.split('\n').map((s) => s.trim()).filter(Boolean) : el.value.trim();
  }
  return cv;
}

async function save() {
  ({ cv } = await api('/career/cv', { method: 'PUT', body: { cv: collect() } }));
  updatedAt = new Date().toISOString();
  document.getElementById('cvb-saved').textContent = t('Last saved {date}', { date: fmtDate(updatedAt) });
}

form.addEventListener('click', async (e) => {
  const add = e.target.closest('[data-add]');
  const remove = e.target.closest('[data-remove]');
  if (add) { collect(); cv[add.dataset.add] = [...(cv[add.dataset.add] || []), structuredClone(SECTIONS[add.dataset.add].blank)]; renderBuilder(); return; }
  if (remove) { collect(); cv[remove.dataset.remove].splice(Number(remove.dataset.i), 1); renderBuilder(); return; }
  const pdf = e.target.closest('[data-pdf]');
  const store = e.target.closest('[data-store]');
  if (!pdf && !store) return;
  const btn = pdf || store;
  setBusy(btn, true, 'Working…');
  try {
    await save();
    if (pdf) {
      location.href = '/api/career/cv/pdf';
    } else {
      await api('/career/cv/pdf', { query: { save: 'true' } });
      toast(t('PDF saved to your documents. You can share it with recruiters from your profile.'), 'success');
    }
  } catch (err) { toast(err.message, 'error'); }
  setBusy(btn, false);
});
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await save(); toast(t('CV saved'), 'success'); } catch (err) { toast(err.message, 'error'); }
});
renderBuilder();

// =====================================================================================
// Mock interview
// =====================================================================================
const body = document.getElementById('mock-body');
const READINESS = { 'needs-practice': ['Needs more practice', 'bg-warn/15 text-warn'], 'getting-there': ['Getting there', 'bg-purple/25 text-purple-30'], ready: ['Interview ready', 'bg-ok/15 text-ok'] };
let aiEnabled = false;

async function loadMock() {
  const res = await api('/career/mock-interviews');
  aiEnabled = res.aiEnabled;
  document.getElementById('mock-mode').className = `badge ${aiEnabled ? 'bg-purple/25 text-purple-30' : 'bg-white/10 text-white/70'}`;
  document.getElementById('mock-mode').innerHTML = aiEnabled ? `${icon('sparkle', 'h-3.5 w-3.5')}${t('AI interviewer')}` : t('Practice question bank');
  document.getElementById('mock-intro').textContent = aiEnabled
    ? t('Tell us the role. The AI asks five questions based on the job and your CV, then gives honest, constructive feedback on your typed answers. It never invents achievements for you.')
    : t('Practise five common interview questions and review your answers with a checklist. (AI feedback is not switched on for this server.)');
  document.getElementById('mock-history').innerHTML = res.interviews.length ? res.interviews.map((m) => `
    <li><button type="button" class="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left text-sm hover:bg-white/[0.06]" data-open="${m.id}">
      <span>${esc(m.jobTitle)} <span class="text-xs text-white/50">· ${fmtDate(m.createdAt)}</span></span>
      <span class="badge ${m.status === 'completed' ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'}">${m.status === 'completed' ? t('Completed') : t('In progress')}</span></button></li>`).join('')
    : `<li class="text-sm text-white/50">${t('No practice interviews yet.')}</li>`;
  document.getElementById('mock-history')._data = res.interviews;
  return res.interviews;
}

async function renderStart() {
  const { files } = await api('/portfolio/files');
  const cvs = files.filter((f) => f.kind === 'cv' && /\.(pdf|txt)$/i.test(f.name));
  body.innerHTML = `
    <form id="mock-start" class="space-y-4" novalidate>
      <div class="grid gap-4 sm:grid-cols-2">
        <div><label for="mk-job" class="field-label">${t('Job title')}</label><input id="mk-job" name="jobTitle" class="field" maxlength="120" required placeholder="${t('e.g. Junior Software Developer')}"></div>
        ${aiEnabled ? `<div><label for="mk-cv" class="field-label">${t('Use my CV')}</label><select id="mk-cv" name="cv" class="field">
          <option value="">${t('No CV')}</option><option value="builder">${t('My CV builder details')}</option>
          ${cvs.map((f) => `<option value="${f.id}">${esc(f.title)}</option>`).join('')}</select></div>` : ''}
        ${aiEnabled ? `<div class="sm:col-span-2"><label for="mk-desc" class="field-label">${t('Job advert (optional)')}</label><textarea id="mk-desc" name="jobDescription" rows="3" maxlength="6000" class="field"></textarea></div>` : ''}
      </div>
      ${aiEnabled ? `<label class="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm"><input type="checkbox" name="consent" class="mt-0.5 h-4 w-4 accent-salmon">
        <span>${t("I agree to send the job details, my CV (if chosen) and my answers to the AI service (Anthropic's Claude) for practice feedback. It is not used to assess me.")}</span></label>` : ''}
      <div class="flex justify-end"><button class="btn btn-primary btn-shine">${icon('play', 'h-4 w-4')}${t('Start practice')}</button></div>
    </form>`;
  document.getElementById('mock-start').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const jobTitle = f.jobTitle.value.trim();
    if (jobTitle.length < 2) { toast(t('Enter the job title'), 'error'); return; }
    if (aiEnabled && !f.consent.checked) { toast(t('Please tick the consent box to use the AI interviewer'), 'error'); return; }
    const btn = f.querySelector('button');
    setBusy(btn, true, aiEnabled ? 'Preparing questions…' : 'Starting…');
    try {
      const cvSel = f.cv?.value || '';
      const { interview } = await api('/career/mock-interviews', { method: 'POST', body: {
        jobTitle, jobDescription: f.jobDescription?.value.trim() || undefined, consent: aiEnabled ? true : undefined,
        useBuilder: cvSel === 'builder' || undefined, fileId: /^\d+$/.test(cvSel) ? Number(cvSel) : undefined,
      } });
      renderQuestions(interview);
      loadMock();
    } catch (err) { toast(err.message, 'error'); setBusy(btn, false); }
  });
}

function renderQuestions(m) {
  body.innerHTML = `
    <form id="mock-answers" class="space-y-5" novalidate>
      <p class="text-sm text-white/70">${t('Role')}: <strong>${esc(m.jobTitle)}</strong>. ${t('Answer as you would speak in the interview. Use a real example where you can.')}</p>
      ${m.questions.map((q, i) => `<div class="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p class="text-xs font-semibold tracking-wider text-salmon-50 uppercase">${t('Question {n} of {total}', { n: i + 1, total: m.questions.length })} · ${esc(q.focus)}</p>
        <label for="mk-a-${i}" class="mt-1 block font-medium">${esc(q.question)}</label>
        <textarea id="mk-a-${i}" name="a${i}" rows="4" maxlength="4000" class="field mt-2" data-voice></textarea>
      </div>`).join('')}
      <div class="flex flex-wrap justify-end gap-2"><button type="button" class="btn btn-ghost" data-restart>${t('Start over')}</button><button class="btn btn-primary">${t('Get feedback')}</button></div>
    </form>`;
  const f = document.getElementById('mock-answers');
  f.querySelector('[data-restart]').addEventListener('click', renderStart);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const answers = m.questions.map((_, i) => f[`a${i}`].value);
    if (answers.every((a) => !a.trim())) { toast(t('Answer at least one question first'), 'error'); return; }
    const btn = f.querySelector('.btn-primary');
    setBusy(btn, true, aiEnabled ? 'Reviewing your answers…' : 'Saving…');
    try {
      const { interview } = await api(`/career/mock-interviews/${m.id}/answers`, { method: 'POST', body: { answers } });
      renderFeedback(interview);
      loadMock();
    } catch (err) { toast(err.message, 'error'); setBusy(btn, false); }
  });
}

function renderFeedback(m) {
  const fb = m.feedback;
  const r = fb.readiness && READINESS[fb.readiness];
  body.innerHTML = `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-2"><h3 class="text-lg">${t('Feedback: {job}', { job: esc(m.jobTitle) })}</h3>${r ? `<span class="badge ${r[1]}">${t(r[0])}</span>` : ''}</div>
      <p class="text-sm text-white/80" ${fb.source === 'ai' ? 'translate="no"' : ''}>${esc(fb.overall)}</p>
      <div class="grid gap-3 sm:grid-cols-2">
        ${fb.strengths.length ? `<div class="rounded-2xl border border-ok/30 bg-ok/[0.06] p-4"><p class="text-sm font-semibold text-ok">${t('Strengths')}</p><ul class="mt-2 list-disc space-y-1 pl-5 text-sm" ${fb.source === 'ai' ? 'translate="no"' : ''}>${fb.strengths.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
        <div class="rounded-2xl border border-purple/30 bg-purple/[0.08] p-4 ${fb.strengths.length ? '' : 'sm:col-span-2'}"><p class="text-sm font-semibold text-purple-30">${fb.source === 'ai' ? t('To improve') : t('Review your answers against this checklist')}</p><ul class="mt-2 list-disc space-y-1 pl-5 text-sm" ${fb.source === 'ai' ? 'translate="no"' : ''}>${fb.improvements.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>
      </div>
      <ol class="space-y-3">${m.questions.map((q, i) => `<li class="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p class="font-medium">${esc(q.question)}</p>
        <p class="mt-2 whitespace-pre-wrap text-sm text-white/70" translate="no">${esc(m.answers[i] || t('(no answer)'))}</p>
        ${fb.perQuestion[i]?.feedback ? `<p class="mt-2 text-sm" translate="no">${esc(fb.perQuestion[i].feedback)}</p>` : ''}
        ${fb.perQuestion[i]?.tip ? `<p class="mt-1 text-xs text-salmon-50" ${fb.source === 'ai' ? 'translate="no"' : ''}>${icon('sparkle', 'h-3 w-3 inline')} ${esc(fb.perQuestion[i].tip)}</p>` : ''}
      </li>`).join('')}</ol>
      <div class="flex justify-end"><button type="button" class="btn btn-primary" data-again>${t('Practise again')}</button></div>
    </div>`;
  body.querySelector('[data-again]').addEventListener('click', renderStart);
}

document.getElementById('mock-history').addEventListener('click', (e) => {
  const b = e.target.closest('[data-open]');
  if (!b) return;
  const m = document.getElementById('mock-history')._data.find((x) => x.id === Number(b.dataset.open));
  if (m.status === 'completed') renderFeedback(m); else renderQuestions(m);
  document.getElementById('mock').scrollIntoView({ behavior: 'smooth' });
});

await loadMock();
renderStart();
if (location.hash) setTimeout(() => document.querySelector(location.hash)?.scrollIntoView({ behavior: 'smooth' }), 300);
