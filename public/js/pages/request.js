import { api, activity } from '../api.js';
import { initPage } from '../layout.js';
import { esc, fmtDate, fmtDateTime, fmtRelative, statusBadge, priorityBadge, overdueBadge, toast, setBusy } from '../ui.js';
import { icon } from '../icons.js';
import { onLive } from '../live.js';
import { createPicker, uploadFiles, attachmentList } from '../components/attachments-ui.js';
import { needLabel } from '../needs.js';

const user = await initPage();
const isStaff = user.role !== 'candidate';
const isAdmin = user.role === 'admin';
const id = Number(new URLSearchParams(location.search).get('id'));
const content = document.getElementById('content');

let staff = [];
let statuses = [];
if (isStaff) [{ staff }, { statuses }] = await Promise.all([api('/requests/staff'), api('/workflow/rules')]);

const ACTION_LABEL = {
  'Assigned': 'Mark assigned', 'In Progress': 'Start work', 'Waiting for Candidate': 'Ask candidate for info',
  'Resolved': 'Resolve', 'Closed': 'Close', 'Reopened': 'Reopen',
};

async function load() {
  let detail, history;
  try {
    [detail, { history }] = await Promise.all([api(`/requests/${id}`), api(`/workflow/requests/${id}/history`)]);
  } catch (err) {
    content.innerHTML = `<div class="card text-center"><h2 class="text-xl">Request not available</h2><p class="mt-2 text-sm text-white/60">${esc(err.message)}</p></div>`;
    return;
  }
  render(detail, history);
}

let picker = null;
let typingDraft = '';

function render({ request: r, messages, allowedNext, attachments, rating }, history) {
  typingDraft = document.getElementById('reply')?.value || typingDraft;
  document.title = `${r.reference} · CAPACITI Support`;
  content.innerHTML = `
  <div class="grid gap-6 lg:grid-cols-3">
    <div class="space-y-6 lg:col-span-2">
      <section class="card animate-fade-up">
        <p class="text-sm font-semibold text-salmon-50">${esc(r.reference)}</p>
        <h2 class="mt-1 text-2xl sm:text-3xl" translate="no">${esc(r.title)}</h2>
        <div class="mt-3 flex flex-wrap gap-2">${statusBadge(r.status)}${priorityBadge(r.priority)}${r.is_overdue ? overdueBadge() : ''}
          <span class="badge bg-white/10 text-white/80">${esc(r.category)}</span></div>
        <p class="mt-5 whitespace-pre-line text-sm leading-relaxed" translate="no">${esc(r.description)}</p>
        ${r.resolution ? `<div class="mt-5 rounded-xl border border-ok/25 bg-ok/10 p-4">
          <p class="text-xs font-semibold tracking-wide text-ok uppercase">Resolution${r.resolved_at ? ` · ${fmtDate(r.resolved_at)}` : ''}</p>
          <p class="mt-1 whitespace-pre-line text-sm">${esc(r.resolution)}</p></div>` : ''}
        ${!isStaff ? candidateActions(r) : ''}
        ${!isStaff && ['Resolved', 'Closed'].includes(r.status) ? ratingWidget(rating) : ''}
      </section>

      <section class="card animate-fade-up [animation-delay:40ms]" aria-labelledby="att-title">
        <div class="flex items-center justify-between gap-3"><h2 id="att-title" class="flex items-center gap-2 text-lg">${icon('paperclip', 'h-4 w-4')}Attachments <span class="text-sm font-normal text-white/50">(${attachments.length})</span></h2></div>
        ${attachments.length ? attachmentList(attachments) : '<p class="mt-2 text-sm text-white/50">No files attached yet.</p>'}
      </section>

      <section class="card animate-fade-up [animation-delay:80ms]" aria-labelledby="thread-title">
        <h2 id="thread-title" class="text-lg">Conversation</h2>
        <ol class="mt-4 space-y-4">${messages.length ? messages.map(messageItem).join('') : '<li class="text-sm text-white/60">No messages yet.</li>'}</ol>
        ${r.status === 'Closed' && !isStaff ? '<p class="mt-6 rounded-lg bg-white/10 p-3 text-sm">This request is closed. Reopen it to continue the conversation.</p>' : `
        <form id="reply-form" class="mt-6 space-y-3 border-t border-white/10 pt-5">
          <label for="reply" class="field-label">${isStaff ? 'Add a note or reply' : 'Reply'}</label>
          ${r.status === 'Waiting for Candidate' && !isStaff ? '<p class="rounded-lg bg-warn/10 p-3 text-sm text-warn">The support team is waiting for your reply. Replying moves your request back to <strong>In Progress</strong>.</p>' : ''}
          <textarea id="reply" name="body" rows="3" maxlength="5000" class="field" data-voice></textarea>
          <div id="reply-attach"></div>
          <div class="flex flex-wrap items-center justify-between gap-3">
            ${isStaff ? `<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="isInternal" class="h-4 w-4 accent-purple"> Internal note (hidden from candidate)</label>` : '<span></span>'}
            <button class="btn btn-primary">Send</button>
          </div>
        </form>`}
      </section>
    </div>

    <aside class="space-y-6">
      <section class="card animate-fade-up [animation-delay:120ms]" aria-labelledby="details-title">
        <h2 id="details-title" class="text-lg">Details</h2>
        <dl class="mt-4 space-y-3 text-sm">
          ${row('Candidate', esc(r.candidate_name) + (r.candidate_email ? `<span class="block text-xs text-white/60">${esc(r.candidate_email)}</span>` : ''))}
          ${isStaff && r.candidate_accessibility?.needs?.length ? `<div class="rounded-xl border border-purple-50/30 bg-purple/15 p-3"><dt class="flex items-center gap-1.5 text-xs font-semibold text-purple-30">${icon('accessibility', 'h-4 w-4')}Accessibility needs</dt>
            <dd class="mt-1 text-sm"><ul class="list-disc pl-5">${r.candidate_accessibility.needs.map((n) => `<li>${esc(needLabel(n))}</li>`).join('')}</ul>${r.candidate_accessibility.notes ? `<p class="mt-1 text-xs text-white/65" translate="no">${esc(r.candidate_accessibility.notes)}</p>` : ''}</dd></div>` : ''}
          ${row('Assigned to', r.assignee_name ? esc(r.assignee_name) : '<span class="text-white/40">Unassigned</span>')}
          ${row('Created', fmtDateTime(r.created_at))}
          ${row('Due (SLA)', `${fmtDateTime(r.due_at)}${r.is_overdue ? ' <span class="text-warn font-semibold">· overdue</span>' : ''}`)}
          ${row('Last update', fmtRelative(r.updated_at))}
          ${r.closed_at ? row('Closed', fmtDateTime(r.closed_at)) : ''}
        </dl>
      </section>
      ${isStaff ? staffPanel(r, allowedNext) : ''}
      <section class="card animate-fade-up [animation-delay:200ms]" aria-labelledby="hist-title">
        <h2 id="hist-title" class="text-lg">Activity history</h2>
        <ol class="relative mt-4 space-y-4 border-l-2 border-white/10 pl-5">${history.map(historyItem).join('')}</ol>
      </section>
    </aside>
  </div>`;

  wire(r);
}

const row = (k, v) => `<div class="flex justify-between gap-4"><dt class="text-white/60">${k}</dt><dd class="text-right font-medium">${v}</dd></div>`;

function messageItem(m) {
  const mine = m.author_id === user.id;
  const tone = m.is_internal ? 'bg-warn/10 border-warn/30' : m.author_role === 'candidate' ? 'bg-white/[0.06] border-white/10' : 'bg-purple/20 border-purple-50/30';
  return `<li class="rounded-xl border p-4 ${tone} ${mine ? 'sm:ml-10' : 'sm:mr-10'}">
    <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span class="font-semibold">${esc(m.author)} <span class="font-normal text-white/60">· ${m.author_role === 'candidate' ? 'Candidate' : 'Support'}</span></span>
      <span class="text-white/60">${m.is_internal ? '<span class="badge bg-amber-glow text-white mr-2">Internal</span>' : ''}<time datetime="${m.created_at}">${fmtDateTime(m.created_at)}</time></span>
    </div>
    <p class="mt-2 whitespace-pre-line text-sm">${esc(m.body)}</p></li>`;
}

function historyItem(h) {
  let text;
  if (h.action === 'CREATED') text = 'Request created';
  else if (h.action === 'STATUS_CHANGE') text = `${esc(h.old_status)} → <strong>${esc(h.new_status)}</strong>`;
  else text = esc(h.details);
  return `<li class="relative">
    <span class="absolute top-1 -left-[27px] h-3 w-3 rounded-full ring-4 ring-night ${h.is_override ? 'bg-salmon' : h.action === 'STATUS_CHANGE' ? 'bg-purple' : 'bg-white/30'}"></span>
    <p class="text-sm">${text}${h.is_override ? ' <span class="badge border border-salmon/30 bg-salmon/15 text-salmon-50">Override</span>' : ''}</p>
    <p class="text-xs text-white/60">${esc(h.changed_by)} · ${fmtDateTime(h.timestamp)}</p>
    ${h.internal_notes ? `<p class="mt-1 rounded-lg bg-warn/10 px-2 py-1 text-xs text-warn">Internal: ${esc(h.internal_notes)}</p>` : ''}
  </li>`;
}

function ratingWidget(rating) {
  const val = rating?.rating || 0;
  return `<form id="rating-form" class="mt-5 rounded-2xl border border-warn/25 bg-gradient-to-br from-warn/10 to-salmon/5 p-4">
    <p class="text-sm font-semibold">${rating ? 'Your rating' : 'How was the support you received?'}</p>
    <div class="mt-2 flex gap-1" role="radiogroup" aria-label="Rating out of 5" data-stars>
      ${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="${n === val}" aria-label="${n} star${n > 1 ? 's' : ''}" data-star="${n}" class="rounded-lg p-1 transition hover:scale-125 ${n <= val ? 'text-warn' : 'text-white/25'}">${icon('star', 'h-7 w-7')}</button>`).join('')}
    </div>
    <label for="rating-comment" class="sr-only">Comment</label>
    <textarea id="rating-comment" name="comment" data-voice rows="2" maxlength="1000" class="field mt-3" placeholder="Anything you'd like to add? (optional)">${esc(rating?.comment || '')}</textarea>
    <div class="mt-3 flex justify-end"><button class="btn btn-primary btn-sm">${rating ? 'Update rating' : 'Submit rating'}</button></div>
  </form>`;
}

function candidateActions(r) {
  if (r.status === 'Resolved') {
    return `<div class="mt-5 flex flex-wrap gap-3 border-t border-white/10 pt-5">
      <button class="btn btn-primary" data-transition="Closed">Accept resolution & close</button>
      <button class="btn btn-ghost" data-transition="Reopened">Not resolved — reopen</button></div>`;
  }
  if (r.status === 'Closed') return '<div class="mt-5 border-t border-white/10 pt-5"><button class="btn btn-ghost" data-transition="Reopened">Reopen request</button></div>';
  return '';
}

function staffPanel(r, allowedNext) {
  const finalised = ['Resolved', 'Closed'].includes(r.status);
  return `
  <section class="card animate-fade-up [animation-delay:160ms]" aria-labelledby="actions-title">
    <h2 id="actions-title" class="text-lg">Manage</h2>

    <form id="assign-form" class="mt-4 space-y-2">
      <label for="assigneeId" class="field-label">Assignee</label>
      <div class="flex gap-2">
        <select id="assigneeId" name="assigneeId" class="field" ${finalised ? 'disabled' : ''}>
          ${staff.map((s) => `<option value="${s.id}" ${s.id === r.assigned_to ? 'selected' : ''}>${esc(s.full_name)}${s.id === user.id ? ' (me)' : ''}</option>`).join('')}
        </select>
        <button class="btn btn-ghost shrink-0" ${finalised ? 'disabled' : ''}>Assign</button>
      </div>
      ${!r.assigned_to && !finalised ? `<button type="button" id="assign-me" class="text-sm font-semibold text-salmon-50 hover:underline">Assign to me</button>` : ''}
    </form>

    <form id="priority-form" class="mt-5 space-y-2">
      <label for="priority" class="field-label">Priority</label>
      <div class="flex gap-2">
        <select id="priority" name="priority" class="field">${['Low', 'Medium', 'High', 'Urgent'].map((p) => `<option ${p === r.priority ? 'selected' : ''}>${p}</option>`).join('')}</select>
        <button class="btn btn-ghost shrink-0">Update</button>
      </div>
    </form>

    <form id="transition-form" class="mt-5 space-y-3 border-t border-white/10 pt-5">
      <p class="field-label !mb-0">Change status</p>
      <p class="text-xs text-white/60">Current: <strong>${esc(r.status)}</strong>. ${allowedNext.length ? 'Permitted next steps:' : 'No further steps.'}</p>
      <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Next status">
        ${allowedNext.map((s, i) => `<label class="cursor-pointer rounded-lg border border-white/20 px-3 py-1.5 text-sm transition has-[:checked]:border-purple has-[:checked]:bg-purple/25 has-[:checked]:text-white">
          <input type="radio" name="toStatus" value="${esc(s)}" class="sr-only" ${i === 0 ? 'checked' : ''}>${ACTION_LABEL[s] || esc(s)}</label>`).join('')}
      </div>
      ${isAdmin ? `<details class="rounded-lg bg-salmon/10 p-3 text-sm">
        <summary class="cursor-pointer font-semibold text-salmon-50">Administrator override</summary>
        <p class="mt-2 text-xs text-white/60">Force a transition outside the normal workflow. It is recorded in the audit log as an override.</p>
        <select name="overrideStatus" class="field mt-2"><option value="">— no override —</option>${statuses.filter((s) => s !== r.status).map((s) => `<option>${esc(s)}</option>`).join('')}</select>
      </details>` : ''}
      <div data-resolution-wrap hidden>
        <label for="resolution" class="field-label">Resolution summary <span class="text-salmon">*</span></label>
        <textarea id="resolution" name="resolution" rows="3" class="field" maxlength="5000"></textarea>
      </div>
      <div><label for="message" class="field-label">Message to candidate <span class="font-normal text-white/60">(optional)</span></label>
        <textarea id="message" name="message" rows="2" class="field" maxlength="5000"></textarea></div>
      <div><label for="note" class="field-label">Internal note <span class="font-normal text-white/60">(audit log only)</span></label>
        <textarea id="note" name="note" rows="2" class="field" maxlength="2000"></textarea></div>
      <div id="transition-error" role="alert" class="hidden rounded-lg bg-salmon-30 p-3 text-sm text-salmon-50"></div>
      <button class="btn btn-primary w-full" ${!allowedNext.length && !isAdmin ? 'disabled' : ''}>Apply status change</button>
    </form>
  </section>`;
}

function wire(r) {
  const replyAttach = document.getElementById('reply-attach');
  if (replyAttach) picker = createPicker(replyAttach);
  const replyBox = document.getElementById('reply');
  if (replyBox && typingDraft) replyBox.value = typingDraft;

  const rf = document.getElementById('rating-form');
  if (rf) {
    let chosen = Number(rf.querySelector('[aria-checked="true"]')?.dataset.star || 0);
    const paintStars = (n) => rf.querySelectorAll('[data-star]').forEach((b) => { b.classList.toggle('text-warn', Number(b.dataset.star) <= n); b.classList.toggle('text-white/25', Number(b.dataset.star) > n); });
    rf.querySelectorAll('[data-star]').forEach((b) => {
      b.addEventListener('mouseenter', () => paintStars(Number(b.dataset.star)));
      b.addEventListener('mouseleave', () => paintStars(chosen));
      b.addEventListener('click', () => { chosen = Number(b.dataset.star); rf.querySelectorAll('[data-star]').forEach((x) => x.setAttribute('aria-checked', String(x === b))); paintStars(chosen); });
    });
    rf.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!chosen) return toast('Choose a star rating first', 'error');
      try {
        const res = await api(`/requests/${id}/rating`, { method: 'POST', body: { rating: chosen, comment: rf.comment.value.trim() || undefined } });
        toast('Thanks for your feedback!', 'success');
        document.dispatchEvent(new CustomEvent('cammy:badges', { detail: res.badges || [] }));
        load();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  document.getElementById('reply-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = f.body.value.trim();
    const files = picker?.files() || [];
    if (!body && !files.length) return f.body.focus();
    const btn = f.querySelector('button');
    setBusy(btn, true, 'Sending…');
    try {
      let res = {};
      if (body) res = await api(`/workflow/requests/${id}/messages`, { method: 'POST', body: { body, isInternal: !!f.isInternal?.checked } });
      if (files.length) await uploadFiles(id, files, { isInternal: !!f.isInternal?.checked });
      typingDraft = '';
      toast(res.autoTransitioned ? 'Reply sent. Your request is back In Progress.' : files.length && !body ? 'Files attached' : 'Message sent', 'success');
      load();
    } catch (err) { toast(err.message, 'error'); setBusy(btn, false); }
  });

  document.querySelectorAll('[data-transition]').forEach((b) => b.addEventListener('click', async () => {
    setBusy(b, true);
    try {
      const res = await api(`/workflow/requests/${id}/transition`, { method: 'POST', body: { toStatus: b.dataset.transition } });
      document.dispatchEvent(new CustomEvent('cammy:badges', { detail: res.badges || [] }));
      toast(`Request ${b.dataset.transition.toLowerCase()}`, 'success');
      load();
    } catch (err) { toast(err.message, 'error'); setBusy(b, false); }
  }));

  if (!isStaff) return;

  const assignForm = document.getElementById('assign-form');
  const doAssign = async (assigneeId) => {
    try {
      await api(`/workflow/requests/${id}/assign`, { method: 'POST', body: { assigneeId } });
      toast('Assignment updated', 'success');
      load();
    } catch (err) { toast(err.message, 'error'); }
  };
  assignForm.addEventListener('submit', (e) => { e.preventDefault(); doAssign(Number(assignForm.assigneeId.value)); });
  document.getElementById('assign-me')?.addEventListener('click', () => doAssign(user.id));

  document.getElementById('priority-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`/workflow/requests/${id}/priority`, { method: 'POST', body: { priority: e.target.priority.value } });
      toast('Priority updated — SLA due date recalculated', 'success');
      load();
    } catch (err) { toast(err.message, 'error'); }
  });

  const tf = document.getElementById('transition-form');
  const resWrap = tf.querySelector('[data-resolution-wrap]');
  const target = () => tf.overrideStatus?.value || tf.querySelector('input[name=toStatus]:checked')?.value;
  const syncResolution = () => { resWrap.hidden = target() !== 'Resolved'; };
  tf.addEventListener('change', syncResolution);
  syncResolution();

  tf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('transition-error');
    errBox.classList.add('hidden');
    const override = !!tf.overrideStatus?.value;
    const toStatus = target();
    if (!toStatus) return;
    const btn = tf.querySelector('button.btn-primary');
    setBusy(btn, true, 'Applying…');
    try {
      await api(`/workflow/requests/${id}/transition`, {
        method: 'POST',
        body: {
          toStatus, override,
          note: tf.note.value.trim() || undefined,
          message: tf.message.value.trim() || undefined,
          resolution: toStatus === 'Resolved' ? tf.resolution.value.trim() : undefined,
          assigneeId: toStatus === 'Assigned' && !r.assigned_to ? user.id : undefined,
        },
      });
      toast(`Status changed to ${toStatus}`, 'success');
      load();
    } catch (err) {
      errBox.innerHTML = `<strong>${esc(err.code)}</strong><br>${esc(err.message)}${err.details?.enforcedBy ? `<br><span class="text-xs">Enforced by: ${esc(err.details.enforcedBy)}</span>` : ''}`;
      errBox.classList.remove('hidden');
      setBusy(btn, false);
    }
  });
}

load();
// Live: refresh when anyone changes this request (status, reply, assignment, files)
onLive('request', (d) => {
  if (Number(d?.id) !== id) return;
  load();
  if (Date.now() - activity.lastWrite > 3000) toast('This request was just updated', 'info');
}, 400);
