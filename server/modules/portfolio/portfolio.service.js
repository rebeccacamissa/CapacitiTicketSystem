'use strict';
/**
 * Portfolio evidence files (CV / project / certificate).
 * Reuses the ticket-attachment security rules: magic-byte type checks, 5 MB limit,
 * random stored names outside the web root, sandboxed serving.
 *
 * Who can open a file: the candidate, support/admin, a facilitator for the
 * candidate's stream, and recruiters only while the portfolio is published.
 */
const path = require('node:path');
const fs = require('node:fs');
const { uploadDir } = require('../../config/env');
const { badRequest, notFound, conflict } = require('../../utils/AppError');
const { decodeUpload, writeUpload } = require('../requests/attachments.service');
const rules = require('../stages/stage.rules');

const DIR = path.join(uploadDir, 'portfolio');
const MAX_FILES = 20;
const KINDS = {
  cv: { exts: ['pdf', 'docx', 'txt'], describe: 'PDF, Word or text' },
  certificate: { exts: ['pdf', 'png', 'jpg', 'webp'], describe: 'PDF or image' },
  project: { exts: ['pdf', 'png', 'jpg', 'webp', 'gif', 'docx', 'xlsx', 'txt'], describe: 'PDF, image, Word, Excel or text' },
};

const shape = (f) => ({ id: f.id, kind: f.kind, title: f.title, name: f.original_name, mime: f.mime, size: f.size, source: f.source, createdAt: f.created_at });

function list(db, candidateId) {
  return db.prepare('SELECT * FROM portfolio_files WHERE candidate_id = ? ORDER BY created_at DESC, id DESC').all(candidateId).map(shape);
}

function insert(db, candidateId, { kind, title, base, ext, buf, mime, source }) {
  const { n } = db.prepare('SELECT COUNT(*) n FROM portfolio_files WHERE candidate_id = ?').get(candidateId);
  if (n >= MAX_FILES) throw conflict('TOO_MANY_FILES', `You can keep up to ${MAX_FILES} portfolio files. Delete one first.`);
  const stored = writeUpload(DIR, ext, buf);
  const id = Number(db.prepare(`
    INSERT INTO portfolio_files (candidate_id, kind, title, stored_name, original_name, mime, size, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(candidateId, kind, title, stored, base, mime, buf.length, source).lastInsertRowid);
  return shape(db.prepare('SELECT * FROM portfolio_files WHERE id = ?').get(id));
}

function upload(db, candidateId, { kind, title, name, data }) {
  const spec = KINDS[kind];
  if (!spec) throw badRequest('Choose CV, project or certificate');
  const file = decodeUpload({ name, data }, spec.exts, spec.describe);
  const label = String(title || '').trim() || file.base.replace(/\.[^.]+$/, '');
  return insert(db, candidateId, { kind, title: label.slice(0, 120), ...file, source: 'upload' });
}

/** Save a reviewed AI-tailored CV as a plain-text CV file. */
function saveTailored(db, candidateId, { title, text }) {
  const buf = Buffer.from(String(text), 'utf8');
  if (!buf.length) throw badRequest('The tailored CV is empty');
  if (buf.length > 200_000) throw badRequest('The tailored CV is too long');
  const label = String(title || 'Tailored CV').trim().slice(0, 120);
  const base = `${label.replace(/[^\w.\- ()]/g, '_').slice(0, 100) || 'Tailored CV'}.txt`;
  return insert(db, candidateId, { kind: 'cv', title: label, base, ext: 'txt', buf, mime: 'text/plain; charset=utf-8', source: 'ai_tailored' });
}

function remove(db, candidateId, id) {
  const f = db.prepare('SELECT * FROM portfolio_files WHERE id = ? AND candidate_id = ?').get(id, candidateId);
  if (!f) throw notFound('File not found');
  db.prepare('DELETE FROM portfolio_files WHERE id = ?').run(id);
  fs.rm(path.join(DIR, f.stored_name), { force: true }, () => {});
}

function canOpen(db, user, candidateId) {
  if (user.role === 'candidate') return user.id === candidateId;
  if (user.role === 'support' || user.role === 'admin') return true;
  if (user.role === 'facilitator') {
    try { rules.assertCanSeeCandidate(db, user, candidateId); return true; } catch { return false; }
  }
  if (user.role === 'recruiter') {
    return !!db.prepare(`SELECT 1 FROM candidate_portfolios p JOIN users u ON u.id = p.candidate_id
      WHERE p.candidate_id = ? AND p.is_published = 1 AND u.is_active = 1`).get(candidateId);
  }
  return false;
}

function open(db, user, id) {
  const f = db.prepare('SELECT * FROM portfolio_files WHERE id = ?').get(id);
  if (!f || !canOpen(db, user, f.candidate_id)) throw notFound('File not found');
  const ext = f.stored_name.split('.').pop();
  return { path: path.join(DIR, f.stored_name), name: f.original_name, mime: f.mime, inline: ['png', 'jpg', 'webp', 'gif'].includes(ext), row: f };
}

module.exports = { list, upload, saveTailored, remove, open, KINDS, MAX_FILES, DIR };
