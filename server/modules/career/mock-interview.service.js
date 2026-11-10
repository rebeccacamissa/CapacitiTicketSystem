'use strict';
/**
 * AI mock interview (optional). Claude writes role-specific questions from the
 * candidate's CV and target job, then gives constructive, honest feedback on the
 * candidate's typed answers. Without an API key, practice still works with a
 * built-in question bank, and the candidate gets self-review tips instead of AI feedback.
 */
const ai = require('../../services/ai');
const { badRequest, notFound, conflict } = require('../../utils/AppError');

const QUESTION_COUNT = 5;

const BANK = [
  { question: 'Tell me about yourself and why you are interested in this role.', focus: 'Motivation and fit' },
  { question: 'Describe a project you are proud of. What was your part in it, and what did you learn?', focus: 'Practical experience' },
  { question: 'Tell me about a time something went wrong in your work or studies. How did you handle it?', focus: 'Problem solving and resilience' },
  { question: 'How do you approach learning a new tool or technology you have never used before?', focus: 'Learning agility' },
  { question: 'Describe a time you worked in a team with different opinions. What did you do?', focus: 'Teamwork and communication' },
];

const SELF_REVIEW = [
  'Use the STAR shape: Situation, Task, Action, Result. Interviewers listen for what YOU did.',
  'Give one specific example per answer, with a concrete outcome (even a small one).',
  'Keep each answer to about one or two minutes when spoken aloud.',
  'Link your answer back to the role: why does this example matter for this job?',
  'Be honest about what you have not done yet, and say how you would learn it.',
];

const QUESTIONS_SYSTEM = `You are an experienced, supportive interviewer helping an early-career candidate from a South African tech skills programme (CAPACITI) practise for a real job interview.
Write ${QUESTION_COUNT} realistic interview questions for the target role: a mix of motivation, behavioural (situation-based) and role-specific technical questions, pitched at entry level.
Base role-specific questions on skills and projects that actually appear in the candidate's CV where possible. Do not assume experience the CV does not show.
Keep each question to one or two sentences.`;

const FEEDBACK_SYSTEM = `You are an experienced, supportive interviewer giving feedback on a candidate's practice interview answers for an entry-level role.
Be honest and specific. Praise real strengths, name concrete improvements, and suggest how to strengthen each answer using only facts the candidate gave (never invent achievements for them).
Use plain South African/British English. Address the candidate as "you". Keep each point short.
If an answer is blank or very short, say so kindly and explain what a good answer would include.`;

const QUESTIONS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['question', 'focus'], properties: { question: { type: 'string' }, focus: { type: 'string' } } },
    },
  },
};

const FEEDBACK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['overall', 'strengths', 'improvements', 'perQuestion', 'readiness'],
  properties: {
    overall: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    improvements: { type: 'array', items: { type: 'string' } },
    readiness: { type: 'string', enum: ['needs-practice', 'getting-there', 'ready'] },
    perQuestion: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['feedback', 'tip'], properties: { feedback: { type: 'string' }, tip: { type: 'string' } } },
    },
  },
};

const shape = (r) => ({
  id: r.id, jobTitle: r.job_title, status: r.status, createdAt: r.created_at, completedAt: r.completed_at,
  questions: JSON.parse(r.questions), answers: JSON.parse(r.answers || '[]'), feedback: r.feedback ? JSON.parse(r.feedback) : null,
});

/** Start an interview: AI questions when enabled, otherwise the built-in bank. */
async function start(db, candidateId, { jobTitle, jobDescription, cv }) {
  let questions;
  let source = 'bank';
  if (ai.isEnabled()) {
    const ask = `Target role: ${jobTitle}${jobDescription ? `\nJob description:\n${jobDescription}` : ''}`;
    const content = cv ? [...ai.cvBlocks(cv), { type: 'text', text: ask }] : [{ type: 'text', text: `${ask}\n(No CV was provided.)` }];
    const { data } = await ai.structured({ system: QUESTIONS_SYSTEM, schema: QUESTIONS_SCHEMA, content, effort: 'low', maxTokens: 4000 });
    questions = data.questions.slice(0, QUESTION_COUNT).filter((q) => q.question?.trim());
    source = 'ai';
  }
  if (!questions?.length) questions = BANK;
  const id = await db.insert('INSERT INTO mock_interviews (candidate_id, job_title, questions) VALUES (?, ?, ?)', candidateId, jobTitle, JSON.stringify(questions));
  return { ...shape(await db.one('SELECT * FROM mock_interviews WHERE id = ?', id)), source };
}

/** Submit answers and get feedback (AI when enabled, self-review tips otherwise). */
async function complete(db, candidateId, id, answers) {
  const row = await db.one('SELECT * FROM mock_interviews WHERE id = ? AND candidate_id = ?', id, candidateId);
  if (!row) throw notFound('Mock interview not found');
  if (row.status === 'completed') throw conflict('ALREADY_COMPLETED', 'This mock interview is already complete');
  const questions = JSON.parse(row.questions);
  if (!Array.isArray(answers) || answers.length !== questions.length || answers.some((a) => typeof a !== 'string' || a.length > 4000)) {
    throw badRequest(`Send one answer (up to 4000 characters) for each of the ${questions.length} questions`);
  }
  let feedback;
  if (ai.isEnabled()) {
    const transcript = questions.map((q, i) => `Question ${i + 1} (${q.focus}): ${q.question}\nAnswer: ${answers[i].trim() || '(no answer)'}`).join('\n\n');
    const { data } = await ai.structured({
      system: FEEDBACK_SYSTEM, schema: FEEDBACK_SCHEMA, effort: 'medium', maxTokens: 8000,
      content: [{ type: 'text', text: `Role: ${row.job_title}\n\n<transcript>\n${transcript}\n</transcript>` }],
    });
    feedback = { ...data, source: 'ai' };
  } else {
    feedback = {
      source: 'self-review',
      overall: 'AI feedback is not switched on for this server, so here is a checklist to review your own answers.',
      strengths: [], improvements: SELF_REVIEW, readiness: null,
      perQuestion: questions.map(() => ({ feedback: '', tip: 'Read your answer aloud. Does it give one specific example and a result?' })),
    };
  }
  await db.run("UPDATE mock_interviews SET answers = ?, feedback = ?, status = 'completed', completed_at = now_iso() WHERE id = ?", JSON.stringify(answers), JSON.stringify(feedback), id);
  return shape(await db.one('SELECT * FROM mock_interviews WHERE id = ?', id));
}

async function listMine(db, candidateId) {
  return (await db.all('SELECT * FROM mock_interviews WHERE candidate_id = ? ORDER BY id DESC LIMIT 20', candidateId)).map(shape);
}

module.exports = { start, complete, listMine, BANK, SELF_REVIEW };
