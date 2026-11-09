'use strict';
/**
 * AI CV tailoring (optional feature).
 *
 * Rewrites a candidate's CV for a job they are interested in WITHOUT exaggerating:
 * Claude may only reorder, re-emphasise and rephrase what the CV already says. It
 * returns the tailored text, a list of every change with the original wording, and
 * the job requirements the CV does not evidence (reported as gaps, never added).
 * Nothing is saved until the candidate has reviewed the result.
 *
 * Needs ANTHROPIC_API_KEY on the server. Without it the feature reports itself as
 * unavailable and the rest of the portfolio works as normal.
 */
const fs = require('node:fs');
const { AppError, badRequest } = require('../../utils/AppError');

const MODEL = 'claude-opus-5-5';

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) {
    const Anthropic = require('@anthropic-ai/sdk');
    client = new (Anthropic.default || Anthropic)({ maxRetries: 2, timeout: 120_000 });
  }
  return client;
}
const isEnabled = () => !!process.env.ANTHROPIC_API_KEY;

const SYSTEM = `You tailor CVs for early-career candidates in a South African tech skills programme (CAPACITI) so they suit a specific job, without exaggerating anything.

Honesty rules. These matter more than making the CV impressive:
- Use only facts that are in the candidate's CV. Never invent or inflate skills, tools, employers, job titles, dates, qualifications, certifications, responsibilities, numbers, metrics, team sizes or results.
- You may reorder sections and bullet points, move the most relevant experience and skills higher, rephrase for clarity and stronger (but accurate) action verbs, use the job's terminology only where the CV already shows that same skill, tighten wording, and remove or shorten content that is irrelevant to this job.
- Do not upgrade the level of a claim: "familiar with" stays "familiar with", "assisted" does not become "led", a course project is not presented as professional work.
- If the job asks for something the CV does not show, do not add it. List it in gapsNotAdded instead, so the candidate can decide what to do honestly.
- Keep the candidate's contact details exactly as written. Do not add a photo, age, ID number or other personal data that is not needed.
- Write in clear South African/British English, plain text with simple headings and "-" bullets (no markdown tables).

For every meaningful change, record it in changes: the section, the original wording (quote it), the new wording, and why it helps for this job. If something could not be tailored honestly, say so in honestyNotes.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tailoredCv', 'changes', 'gapsNotAdded', 'honestyNotes'],
  properties: {
    tailoredCv: { type: 'string', description: 'The full tailored CV as plain text.' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section', 'before', 'after', 'reason'],
        properties: {
          section: { type: 'string' },
          before: { type: 'string', description: 'Original wording from the CV (empty if it was only moved).' },
          after: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
    gapsNotAdded: { type: 'array', items: { type: 'string' }, description: 'Job requirements the CV does not evidence. Not added to the CV.' },
    honestyNotes: { type: 'string' },
  },
};

/** Build the CV content block: PDFs go to Claude as documents, text as text. */
function cvContent({ file, text }) {
  if (text) return [{ type: 'text', text: `<cv>\n${text}\n</cv>` }];
  const ext = file.name.split('.').pop().toLowerCase();
  const buf = fs.readFileSync(file.path);
  if (ext === 'pdf') {
    return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') }, title: 'Candidate CV' }];
  }
  if (ext === 'txt') return [{ type: 'text', text: `<cv>\n${buf.toString('utf8')}\n</cv>` }];
  throw badRequest('AI tailoring works with PDF or text CVs. Upload a PDF version, or paste your CV text instead.');
}

/** Numbers in the output that never appear in a text CV: a cheap extra check against invented metrics. */
function numbersNotInOriginal(original, tailored) {
  const nums = (s) => new Set((s.match(/\d[\d,.%]*/g) || []).map((n) => n.replace(/[.,]+$/, '')));
  const have = nums(original);
  return [...nums(tailored)].filter((n) => !have.has(n));
}

async function tailor({ file, text, jobTitle, jobDescription }) {
  const ai = getClient();
  if (!ai) throw new AppError(503, 'AI_NOT_CONFIGURED', 'AI CV tailoring is not switched on for this server. An administrator needs to add an ANTHROPIC_API_KEY.');

  const job = `Tailor my CV for this job.\n<job_title>${jobTitle}</job_title>${jobDescription ? `\n<job_description>\n${jobDescription}\n</job_description>` : ''}`;
  let response;
  try {
    response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: [...cvContent({ file, text }), { type: 'text', text: job }] }],
    });
  } catch (err) {
    const Anthropic = require('@anthropic-ai/sdk');
    const A = Anthropic.default || Anthropic;
    if (err instanceof A.RateLimitError) throw new AppError(429, 'AI_BUSY', 'The AI service is busy. Please try again in a minute.');
    if (err instanceof A.AuthenticationError || err instanceof A.PermissionDeniedError) throw new AppError(503, 'AI_NOT_CONFIGURED', 'The AI service key on this server is not valid.');
    if (err instanceof A.BadRequestError) throw new AppError(422, 'AI_REJECTED', 'The AI service could not read this CV. Try a smaller PDF or paste the text.');
    if (err instanceof A.APIError || err instanceof A.APIConnectionError) throw new AppError(502, 'AI_UNAVAILABLE', 'The AI service is unavailable right now. Please try again later.');
    throw err;
  }

  if (response.stop_reason === 'refusal') throw new AppError(422, 'AI_DECLINED', 'The AI service declined this request. Please check the CV and job details.');
  if (response.stop_reason === 'max_tokens') throw new AppError(422, 'AI_TOO_LONG', 'This CV is too long to tailor in one go. Try a shorter version.');
  const out = response.content.find((b) => b.type === 'text');
  let parsed;
  try { parsed = JSON.parse(out?.text || ''); } catch { throw new AppError(502, 'AI_BAD_OUTPUT', 'The AI response could not be read. Please try again.'); }

  const original = text || (file.name.toLowerCase().endsWith('.txt') ? fs.readFileSync(file.path, 'utf8') : null);
  return {
    ...parsed,
    model: response.model,
    // Only checkable when we have the CV as text; listed for the candidate to double-check.
    numbersToCheck: original ? numbersNotInOriginal(original, parsed.tailoredCv) : null,
  };
}

module.exports = { tailor, isEnabled, SYSTEM, numbersNotInOriginal };
