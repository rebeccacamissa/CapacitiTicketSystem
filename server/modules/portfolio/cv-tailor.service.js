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
const ai = require('../../services/ai');

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
/** Numbers in the output that never appear in a text CV: a cheap extra check against invented metrics. */
function numbersNotInOriginal(original, tailored) {
  const nums = (s) => new Set((s.match(/\d[\d,.%]*/g) || []).map((n) => n.replace(/[.,]+$/, '')));
  const have = nums(original);
  return [...nums(tailored)].filter((n) => !have.has(n));
}

async function tailor({ file, text, jobTitle, jobDescription }) {
  const job = `Tailor my CV for this job.\n<job_title>${jobTitle}</job_title>${jobDescription ? `\n<job_description>\n${jobDescription}\n</job_description>` : ''}`;
  const blocks = ai.cvBlocks(text ? { text } : { data: file.data, ext: file.ext });
  const { data: parsed, model } = await ai.structured({ system: SYSTEM, schema: SCHEMA, content: [...blocks, { type: 'text', text: job }] });
  const original = text || (file.ext === 'txt' ? file.data.toString('utf8') : null);
  return {
    ...parsed,
    model,
    // Only checkable when we have the CV as text; listed for the candidate to double-check.
    numbersToCheck: original ? numbersNotInOriginal(original, parsed.tailoredCv) : null,
  };
}

module.exports = { tailor, isEnabled: ai.isEnabled, SYSTEM, numbersNotInOriginal };
