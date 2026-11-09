// Candidate portfolio documents (CV / project / certificate uploads) and the optional
// AI CV tailoring assistant. Files use the same secure storage as ticket attachments.
import { api } from '../api.js';
import { esc, toast, setBusy, fmtDate, showFieldErrors, t } from '../ui.js';
import { icon } from '../icons.js';

const KINDS = [
  ['cv', 'CV', '.pdf,.docx,.txt'],
  ['project', 'Project', '.pdf,.png,.jpg,.jpeg,.webp,.gif,.docx,.xlsx,.txt'],
  ['certificate', 'Certificate', '.pdf,.png,.jpg,.jpeg,.webp'],
];
const KIND_LABEL = Object.fromEntries(KINDS.map(([k, l]) => [k, l]));
const toDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
const size = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

let files = [];
const listeners = new Set();

async function refresh() {
  ({ files } = await api('/portfolio/files'));
  listeners.forEach((fn) => fn());
}

export async function initPortfolioDocs(root) {
  root.innerHTML = `
    <h3 class="text-lg">Documents</h3>
    <p class="mt-1 text-sm text-white/60">Upload your CV, project evidence and certificates (PDF, Word, images or text, up to 5 MB each). Recruiters can open them only while your portfolio is shared.</p>
    <ul data-files class="mt-3 space-y-2" aria-live="polite"></ul>
    <form data-upload class="mt-4 grid gap-3 sm:grid-cols-[10rem_1fr_1fr_auto]" novalidate>
      <div><label for="doc-kind" class="field-label">Type</label>
        <select id="doc-kind" name="kind" class="field">${KINDS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <div><label for="doc-title" class="field-label">Title <span class="font-normal text-white/50">(optional)</span></label>
        <input id="doc-title" name="title" maxlength="120" class="field" placeholder="e.g. AWS Cloud Practitioner"></div>
      <div><label for="doc-file" class="field-label">File</label>
        <input id="doc-file" name="file" type="file" required class="field file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-white" accept="${KINDS[0][2]}">
        <p class="field-error" data-error-for="file"></p></div>
      <div class="flex items-end"><button class="btn btn-ghost w-full">${icon('paperclip', 'h-4 w-4')}Upload</button></div>
    </form>`;

  const list = root.querySelector('[data-files]');
  const form = root.querySelector('[data-upload]');
  const render = () => {
    list.innerHTML = files.length ? files.map((f) => `
      <li class="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3">
        <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple/40 to-salmon/25">${icon(f.mime.startsWith('image/') ? 'image' : 'file', 'h-5 w-5')}</span>
        <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium" translate="no">${esc(f.title)}</span>
          <span class="block text-xs text-white/50">${t(KIND_LABEL[f.kind])} · ${size(f.size)} · ${fmtDate(f.createdAt)}${f.source === 'ai_tailored' ? ` · <span class="text-purple-30">${t('AI-tailored, reviewed by you')}</span>` : ''}</span></span>
        <a class="btn btn-ghost btn-sm" href="/api/portfolio/files/${f.id}" target="_blank" rel="noopener">${icon('download', 'h-4 w-4')}Open</a>
        <button type="button" class="btn btn-ghost btn-sm" data-del="${f.id}" aria-label="${t('Delete')} ${esc(f.title)}">Delete</button>
      </li>`).join('') : `<li class="rounded-xl border border-dashed border-white/15 p-4 text-sm text-white/55">${t('No documents yet. Start with your CV.')}</li>`;
  };
  listeners.add(render);

  form.kind.addEventListener('change', () => { form.file.accept = KINDS.find(([k]) => k === form.kind.value)[2]; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = form.file.files[0];
    if (!file) return showFieldErrors(form, { file: t('Choose a file') });
    if (file.size > 5 * 1024 * 1024) return showFieldErrors(form, { file: t('Files must be 5 MB or smaller') });
    showFieldErrors(form, {});
    const btn = form.querySelector('button');
    setBusy(btn, true, 'Uploading…');
    try {
      await api('/portfolio/files', { method: 'POST', body: { kind: form.kind.value, title: form.title.value.trim() || undefined, name: file.name, data: await toDataUrl(file) } });
      form.reset();
      form.file.accept = KINDS[0][2];
      await refresh();
      toast('Document uploaded', 'success');
    } catch (err) { toast(err.message, 'error'); }
    setBusy(btn, false);
  });
  list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b || !confirm(t('Delete this document?'))) return;
    try { await api(`/portfolio/files/${b.dataset.del}`, { method: 'DELETE' }); await refresh(); toast('Document deleted', 'success'); } catch (err) { toast(err.message, 'error'); }
  });
  await refresh();
}

// ---- AI CV tailoring --------------------------------------------------------------
export async function initCvTailor(root) {
  const { enabled } = await api('/portfolio/cv/ai-status').catch(() => ({ enabled: false }));
  root.innerHTML = `
    <div class="flex flex-wrap items-center gap-2"><h3 class="text-lg">Tailor my CV for a job</h3><span class="badge bg-purple/25 text-purple-30">${icon('sparkle', 'h-3.5 w-3.5')}AI · optional</span></div>
    <p class="mt-1 text-sm text-white/60">Tell us the job you want. The AI reorders, re-emphasises and rewords what is already in your CV so it matches the job. It never adds skills, results, numbers or experience you don't have. Anything the job asks for that your CV doesn't show is listed as a gap, not added. You review every change before anything is saved.</p>
    ${enabled ? '' : `<p class="mt-3 rounded-xl border border-white/15 bg-white/[0.04] p-3 text-sm text-white/65" role="note">${icon('info', 'h-4 w-4 inline')} ${t('AI tailoring is not switched on for this server yet. An administrator needs to add an AI service key. You can still upload and share your CV.')}</p>`}
    <form data-tailor class="mt-4 space-y-4 ${enabled ? '' : 'pointer-events-none opacity-50'}" novalidate ${enabled ? '' : 'aria-disabled="true"'}>
      <div class="grid gap-4 sm:grid-cols-2">
        <div><label for="tl-cv" class="field-label">Which CV?</label><select id="tl-cv" name="fileId" class="field"></select></div>
        <div><label for="tl-job" class="field-label">Job title</label><input id="tl-job" name="jobTitle" required maxlength="120" class="field" placeholder="e.g. Junior Data Analyst"><p class="field-error" data-error-for="jobTitle"></p></div>
      </div>
      <div data-paste class="hidden"><label for="tl-text" class="field-label">Paste your CV text</label><textarea id="tl-text" name="cvText" rows="6" maxlength="30000" class="field"></textarea><p class="field-error" data-error-for="cvText"></p></div>
      <div><label for="tl-desc" class="field-label">Job advert or key requirements <span class="font-normal text-white/50">(optional, recommended)</span></label>
        <textarea id="tl-desc" name="jobDescription" rows="4" maxlength="6000" class="field" placeholder="Paste the job description so the AI knows what to emphasise."></textarea></div>
      <label class="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm">
        <input name="consent" type="checkbox" class="mt-0.5 h-4 w-4 accent-salmon">
        <span>I agree to send this CV and job information to the AI service (Anthropic's Claude) to create a draft. It is not used to make decisions about me, and nothing is saved until I choose to save it.<p class="field-error" data-error-for="consent"></p></span>
      </label>
      <div class="flex justify-end"><button class="btn btn-primary btn-shine">${icon('sparkle', 'h-4 w-4')}Create tailored draft</button></div>
    </form>
    <div data-result class="mt-5" aria-live="polite"></div>`;
  if (!enabled) return;

  const form = root.querySelector('[data-tailor]');
  const out = root.querySelector('[data-result]');
  const fillCvs = () => {
    const cvs = files.filter((f) => f.kind === 'cv' && /\.(pdf|txt)$/i.test(f.name));
    const keep = form.fileId.value;
    form.fileId.innerHTML = `${cvs.map((f) => `<option value="${f.id}">${esc(f.title)} (${esc(f.name.split('.').pop().toUpperCase())})</option>`).join('')}<option value="">${t('Paste my CV text instead')}</option>`;
    if (keep && cvs.some((f) => String(f.id) === keep)) form.fileId.value = keep;
    root.querySelector('[data-paste]').classList.toggle('hidden', !!form.fileId.value);
  };
  listeners.add(fillCvs);
  fillCvs();
  form.fileId.addEventListener('change', () => root.querySelector('[data-paste]').classList.toggle('hidden', !!form.fileId.value));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.jobTitle.value.trim()) errs.jobTitle = t('Enter the job title');
    if (!form.consent.checked) errs.consent = t('Please confirm before we send your CV');
    if (!form.fileId.value && form.cvText.value.trim().length < 50) errs.cvText = t('Paste at least a few lines of your CV');
    showFieldErrors(form, errs);
    if (Object.keys(errs).length) return;
    const btn = form.querySelector('button');
    setBusy(btn, true, 'Tailoring… this can take up to a minute');
    out.innerHTML = '<div class="skeleton h-40"></div>';
    try {
      const { result } = await api('/portfolio/cv/tailor', { method: 'POST', body: {
        fileId: form.fileId.value ? Number(form.fileId.value) : undefined,
        cvText: form.fileId.value ? undefined : form.cvText.value,
        jobTitle: form.jobTitle.value.trim(),
        jobDescription: form.jobDescription.value.trim() || undefined,
        consent: true,
      } });
      renderResult(result, form.jobTitle.value.trim());
    } catch (err) { out.innerHTML = ''; toast(err.message, 'error'); showFieldErrors(form, err.details?.fields); }
    setBusy(btn, false);
  });

  function renderResult(r, jobTitle) {
    out.innerHTML = `
      <div class="space-y-4 rounded-2xl border border-purple/30 bg-purple/10 p-4 animate-fade-up">
        <p class="text-sm font-semibold">${t('Review your tailored draft')}</p>
        ${r.numbersToCheck?.length ? `<p class="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn" role="alert">${t('Please double-check these numbers. They do not appear in your original CV:')} <strong translate="no">${r.numbersToCheck.map(esc).join(', ')}</strong></p>` : ''}
        ${r.gapsNotAdded.length ? `<div><p class="text-sm font-semibold">${t('Not added: the job asks for these, but your CV does not show them')}</p>
          <ul class="mt-1 list-disc pl-5 text-sm text-white/75" translate="no">${r.gapsNotAdded.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>
          <p class="mt-1 text-xs text-white/55">${t('If you do have this experience, add it to your CV yourself in your own words.')}</p></div>` : ''}
        ${r.changes.length ? `<details class="rounded-xl bg-ink/30 p-3"><summary class="cursor-pointer text-sm font-semibold">${t('What changed and why ({n})', { n: r.changes.length })}</summary>
          <ol class="mt-2 space-y-3 text-sm" translate="no">${r.changes.map((c) => `<li class="rounded-lg bg-white/[0.04] p-2"><p class="text-xs font-semibold text-white/60">${esc(c.section)}</p>
            ${c.before ? `<p class="mt-1 text-white/50 line-through decoration-salmon/60">${esc(c.before)}</p>` : ''}<p class="mt-1">${esc(c.after)}</p><p class="mt-1 text-xs text-purple-30">${esc(c.reason)}</p></li>`).join('')}</ol></details>` : ''}
        ${r.honestyNotes ? `<p class="text-xs text-white/60" translate="no">${esc(r.honestyNotes)}</p>` : ''}
        <div><label for="tl-out" class="field-label">${t('Tailored CV (you can edit before saving)')}</label>
          <textarea id="tl-out" rows="16" class="field font-mono text-xs" translate="no">${esc(r.tailoredCv)}</textarea></div>
        <label class="flex items-start gap-3 text-sm"><input data-confirm type="checkbox" class="mt-0.5 h-4 w-4 accent-salmon"><span>${t('I have checked this draft and everything in it is true.')}</span></label>
        <div class="flex flex-wrap justify-end gap-2">
          <button type="button" data-copy class="btn btn-ghost btn-sm">Copy text</button>
          <button type="button" data-save class="btn btn-primary btn-sm" disabled>${t('Save to my documents')}</button>
        </div>
      </div>`;
    const save = out.querySelector('[data-save]');
    out.querySelector('[data-confirm]').addEventListener('change', (e) => { save.disabled = !e.target.checked; });
    out.querySelector('[data-copy]').addEventListener('click', async () => { await navigator.clipboard.writeText(out.querySelector('#tl-out').value); toast('Copied', 'success'); });
    save.addEventListener('click', async () => {
      setBusy(save, true, 'Saving…');
      try {
        await api('/portfolio/cv/tailored', { method: 'POST', body: { title: `CV for ${jobTitle}`.slice(0, 120), text: out.querySelector('#tl-out').value } });
        await refresh();
        toast('Tailored CV saved to your documents', 'success');
        out.innerHTML = '';
      } catch (err) { toast(err.message, 'error'); setBusy(save, false); }
    });
  }
}
