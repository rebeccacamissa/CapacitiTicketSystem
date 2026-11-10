import { api } from '../api.js';
import { initPage } from '../layout.js';
import { esc, toast } from '../ui.js';
import { shortlistButton, wireShortlist } from '../components/shortlist.js';
import { stageBadge } from '../components/stage-ui.js';

await initPage({ roles: ['recruiter'] });
const search = document.getElementById('talent-search');
const streamFilter = document.getElementById('stream-filter');
const stageFilter = document.getElementById('stage-filter');
const cohortFilter = document.getElementById('cohort-filter');
const skillsFilter = document.getElementById('skills-filter');
const docsFilter = document.getElementById('docs-filter');
const sortFilter = document.getElementById('sort-filter');
const rows = document.getElementById('talent-rows');
let requestId = 0;

async function loadTalent() {
  const currentRequest = ++requestId;
  const selectedStream = streamFilter.value;
  const selectedStage = stageFilter.value;
  const selectedCohort = cohortFilter.value;
  try {
    const data = await api('/recruiter/talent', {
      query: { q: search.value.trim(), stream: streamFilter.value, stage: stageFilter.value, cohort: cohortFilter.value, skills: skillsFilter.value.trim(), documents: docsFilter.value, sort: sortFilter.value },
    });
    if (currentRequest !== requestId) return;
    streamFilter.innerHTML = '<option value="">All streams</option>' + data.streams.map((stream) => `<option value="${esc(stream)}">${esc(stream)}</option>`).join('');
    stageFilter.innerHTML = '<option value="">All stages</option>' + data.stages.map((stage) => `<option value="${esc(stage.key)}">${esc(stage.title)}</option>`).join('');
    streamFilter.value = data.streams.includes(selectedStream) ? selectedStream : '';
    stageFilter.value = data.stages.some((stage) => stage.key === selectedStage) ? selectedStage : '';
    cohortFilter.innerHTML = '<option value="">All cohorts</option>' + (data.cohorts || []).map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    cohortFilter.value = (data.cohorts || []).includes(selectedCohort) ? selectedCohort : '';
    document.getElementById('skill-options').innerHTML = (data.skills || []).map((x) => `<option value="${esc(x)}">`).join('');
    document.getElementById('talent-count').textContent = `${data.candidates.length} candidate${data.candidates.length === 1 ? '' : 's'}`;
    rows.innerHTML = data.candidates.length ? data.candidates.map((candidate) => `
      <tr class="transition hover:bg-white/[0.03]">
        <td class="px-5 py-4"><p class="font-medium">${esc(candidate.fullName)}</p><p class="text-xs text-white/50">${esc(candidate.email)}</p>${candidate.skills.length ? `<p class="mt-1 flex flex-wrap gap-1">${candidate.skills.slice(0, 4).map((x) => `<span class="chip !px-2 !py-0 !text-[0.65rem]">${esc(x)}</span>`).join('')}</p>` : ''}</td>
        <td class="px-5 py-4 text-white/70">${esc(candidate.stream || '—')}</td>
        <td class="px-5 py-4">${stageBadge(candidate.stage, candidate.stageLabel)}</td>
        <td class="px-5 py-4"><span class="flex items-center gap-3"><a class="text-sm font-semibold text-salmon-50 hover:underline" href="/candidate-profiles?id=${candidate.id}">View portfolio →</a>${shortlistButton(candidate, { label: false })}</span></td>
      </tr>`).join('') : '<tr><td colspan="4" class="px-5 py-12 text-center text-white/55">No shared candidate portfolios yet</td></tr>';
  } catch (error) {
    if (currentRequest === requestId) {
      rows.innerHTML = '<tr><td colspan="4" class="px-5 py-8 text-center text-salmon-50">Could not load talent. Please try again.</td></tr>';
      toast(error.message, 'error');
    }
  }
}

let searchTimer;
search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadTalent, 180);
});
streamFilter.addEventListener('change', loadTalent);
stageFilter.addEventListener('change', loadTalent);
for (const el of [cohortFilter, docsFilter, sortFilter]) el.addEventListener('change', loadTalent);
skillsFilter.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadTalent, 250); });
wireShortlist(rows, loadTalent);
await loadTalent();
