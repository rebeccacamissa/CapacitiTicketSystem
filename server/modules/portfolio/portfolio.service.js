'use strict';
/**
 * Portfolio evidence files (CV / project / certificate).
 * Reuses the ticket-attachment security rules: magic-byte type checks, 5 MB limit,
 * random stored names, contents in the database, sandboxed serving.
 *
 * Who can open a file: the candidate, support/admin, a facilitator for the
 * candidate's stream, and recruiters only while the portfolio is published.
 */
const { badRequest, notFound, conflict } = require('../../utils/AppError');
const { decodeUpload, writeUpload, readUpload } = require('../requests/attachments.service');
const rules = require('../stages/stage.rules');

const MAX_FILES = 20;
const KINDS = {
  cv: { exts: ['pdf', 'docx', 'txt'], describe: 'PDF, Word or text' },
  certificate: { exts: ['pdf', 'png', 'jpg', 'webp'], describe: 'PDF or image' },
  project: { exts: ['pdf', 'png', 'jpg', 'webp', 'gif', 'docx', 'xlsx', 'txt'], describe: 'PDF, image, Word, Excel or text' },
};

const shape = (f) => ({ id: f.id, kind: f.kind, title: f.title, name: f.original_name, mime: f.mime, size: f.size, source: f.source, createdAt: f.created_at });

async function list(db, candidateId) {
  return (await db.all('SELECT * FROM portfolio_files WHERE candidate_id = ? ORDER BY created_at DESC, id DESC', candidateId)).map(shape);
}

async function insert(db, candidateId, { kind, title, base, ext, buf, mime, source }) {
  return db.tx(async (t) => {
    const { n } = await t.one('SELECT COUNT(*) n FROM portfolio_files WHERE candidate_id = ?', candidateId);
    if (n >= MAX_FILES) throw conflict('TOO_MANY_FILES', `You can keep up to ${MAX_FILES} portfolio files. Delete one first.`);
    const stored = await writeUpload(t, ext, buf);
    const id = await t.insert(`
      INSERT INTO portfolio_files (candidate_id, kind, title, stored_name, original_name, mime, size, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, candidateId, kind, title, stored, base, mime, buf.length, source);
    return shape(await t.one('SELECT * FROM portfolio_files WHERE id = ?', id));
  });
}

async function upload(db, candidateId, { kind, title, name, data }) {
  const spec = KINDS[kind];
  if (!spec) throw badRequest('Choose CV, project or certificate');
  const file = decodeUpload({ name, data }, spec.exts, spec.describe);
  const label = String(title || '').trim() || file.base.replace(/\.[^.]+$/, '');
  return insert(db, candidateId, { kind, title: label.slice(0, 120), ...file, source: 'upload' });
}

/** Save generated content (a reviewed AI-tailored CV as text, or a CV-builder PDF). */
async function saveGenerated(db, candidateId, { title, buf, ext, mime, source, kind = 'cv' }) {
  if (!buf.length) throw badRequest('The document is empty');
  if (buf.length > 5 * 1024 * 1024) throw badRequest('The document is too large');
  const label = String(title || 'My CV').trim().slice(0, 120);
  const base = `${label.replace(/[^\w.\- ()]/g, '_').slice(0, 100) || 'CV'}.${ext}`;
  return insert(db, candidateId, { kind, title: label, base, ext, buf, mime, source });
}

async function saveTailored(db, candidateId, { title, text }) {
  const buf = Buffer.from(String(text), 'utf8');
  if (buf.length > 200_000) throw badRequest('The tailored CV is too long');
  return saveGenerated(db, candidateId, { title: title || 'Tailored CV', buf, ext: 'txt', mime: 'text/plain; charset=utf-8', source: 'ai_tailored' });
}

async function remove(db, candidateId, id) {
  const f = await db.one('SELECT * FROM portfolio_files WHERE id = ? AND candidate_id = ?', id, candidateId);
  if (!f) throw notFound('File not found');
  await db.tx(async (t) => {
    await t.run('DELETE FROM portfolio_files WHERE id = ?', id);
    await t.run('DELETE FROM file_blobs WHERE stored_name = ?', f.stored_name);
  });
}

async function canOpen(db, user, candidateId) {
  if (user.role === 'candidate') return user.id === candidateId;
  if (user.role === 'support' || user.role === 'admin') return true;
  if (user.role === 'facilitator') {
    try { await rules.assertCanSeeCandidate(db, user, candidateId); return true; } catch { return false; }
  }
  if (user.role === 'recruiter') {
    return !!await db.one(`SELECT 1 FROM candidate_portfolios p JOIN users u ON u.id = p.candidate_id
      WHERE p.candidate_id = ? AND p.is_published = 1 AND u.is_active = 1`, candidateId);
  }
  return false;
}

async function open(db, user, id, { withData = true } = {}) {
  const f = await db.one('SELECT * FROM portfolio_files WHERE id = ?', id);
  if (!f || !await canOpen(db, user, f.candidate_id)) throw notFound('File not found');
  const ext = f.stored_name.split('.').pop();
  return {
    data: withData ? await readUpload(db, f.stored_name) : null,
    name: f.original_name, mime: f.mime, ext, inline: ['png', 'jpg', 'webp', 'gif'].includes(ext), row: f,
  };
}

module.exports = { list, upload, saveTailored, saveGenerated, remove, open, KINDS, MAX_FILES };
