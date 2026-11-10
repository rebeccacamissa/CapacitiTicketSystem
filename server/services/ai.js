'use strict';
/**
 * Shared Claude (Anthropic) client for the optional AI features: CV tailoring and
 * mock interviews. Enabled only when ANTHROPIC_API_KEY is set.
 *
 * Every call asks for structured JSON (output_config.format json_schema) and opts into
 * server-side refusal fallbacks, so a safety decline is retried on Anthropic's
 * recommended fallback model instead of failing.
 */
const { AppError } = require('../utils/AppError');

const MODEL = 'claude-opus-5-5';

let client = null;
const isEnabled = () => !!process.env.ANTHROPIC_API_KEY;

function sdk() {
  const mod = require('@anthropic-ai/sdk');
  return mod.default || mod;
}

function getClient() {
  if (!isEnabled()) return null;
  if (!client) client = new (sdk())({ maxRetries: 2, timeout: 120_000 });
  return client;
}

function notConfigured() {
  return new AppError(503, 'AI_NOT_CONFIGURED', 'AI features are not switched on for this server. An administrator needs to add an ANTHROPIC_API_KEY.');
}

/**
 * One structured call. Returns the parsed JSON object.
 * @param {{ system: string, content: object[], schema: object, effort?: string, maxTokens?: number }} opts
 */
async function structured({ system, content, schema, effort = 'medium', maxTokens = 16000 }) {
  const ai = getClient();
  if (!ai) throw notConfigured();
  let response;
  try {
    response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort, format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    const A = sdk();
    if (err instanceof A.RateLimitError) throw new AppError(429, 'AI_BUSY', 'The AI service is busy. Please try again in a minute.');
    if (err instanceof A.AuthenticationError || err instanceof A.PermissionDeniedError) throw new AppError(503, 'AI_NOT_CONFIGURED', 'The AI service key on this server is not valid.');
    if (err instanceof A.BadRequestError) throw new AppError(422, 'AI_REJECTED', 'The AI service could not process this input. Try a smaller document or paste the text.');
    if (err instanceof A.APIError || err instanceof A.APIConnectionError) throw new AppError(502, 'AI_UNAVAILABLE', 'The AI service is unavailable right now. Please try again later.');
    throw err;
  }
  if (response.stop_reason === 'refusal') throw new AppError(422, 'AI_DECLINED', 'The AI service declined this request. Please check the details and try again.');
  if (response.stop_reason === 'max_tokens') throw new AppError(422, 'AI_TOO_LONG', 'The input is too long to process in one go. Try a shorter version.');
  const text = response.content.find((b) => b.type === 'text')?.text || '';
  try {
    return { data: JSON.parse(text), model: response.model };
  } catch {
    throw new AppError(502, 'AI_BAD_OUTPUT', 'The AI response could not be read. Please try again.');
  }
}

/** Content block(s) for a CV: PDFs go to Claude as documents, text as text. */
function cvBlocks({ data, ext, text }) {
  if (text) return [{ type: 'text', text: `<cv>\n${text}\n</cv>` }];
  if (ext === 'pdf') return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: data.toString('base64') }, title: 'Candidate CV' }];
  if (ext === 'txt') return [{ type: 'text', text: `<cv>\n${data.toString('utf8')}\n</cv>` }];
  throw new AppError(400, 'VALIDATION_ERROR', 'AI features work with PDF or text CVs. Upload a PDF version, or paste your CV text instead.');
}

module.exports = { isEnabled, structured, cvBlocks, MODEL };
