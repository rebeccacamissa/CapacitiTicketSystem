'use strict';
/**
 * Ticket attachments. Files arrive as base64 data (no multipart dependency), are
 * checked by magic bytes (never by the client's claimed type), stored under random
 * names outside the web root, and only served to people who can see the request.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { uploadDir } = require('../../config/env');
const { badRequest, notFound } = require('../../utils/AppError');

const DIR = path.join(uploadDir, 'attachments');
const MAX_BYTES = 5 * 1024 * 1024;

const TYPES = {
  png: { mime: 'image/png', test: (b) => b[0] === 0x89 && b.subarray(1, 4).toString('ascii') === 'PNG', inline: true },
  jpg: { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, inline: true },
  webp: { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP', inline: true },
  gif: { mime: 'image/gif', test: (b) => b.subarray(0, 4).toString('ascii') === 'GIF8', inline: true },
  pdf: { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('ascii') === '%PDF-' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', test: (b) => b[0] === 0x50 && b[1] === 0x4b },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', test: (b) => b[0] === 0x50 && b[1] === 0x4b },
  txt: { mime: 'text/plain; charset=utf-8', test: (b) => !b.includes(0) },
};
const ALIAS = { jpeg: 'jpg' };

function canSee(db, requestId, user) {
  const r = db.prepare('SELECT candidate_id FROM requests WHERE id = ?').get(requestId);
  if (!r || (user.role === 'candidate' && r.candidate_id !== user.id)) throw notFound('Request not found');
}

/**
 * Validate a base64 upload: safe file name, allowed extension, size limit and a
 * magic-byte check that the content really is that type. Shared with portfolio files.
 */
function decodeUpload({ name, data }, allowed = Object.keys(TYPES), describe = 'images, PDF, Word, Excel or text') {
  const base = path.basename(String(name || '')).replace(/[^\w.\- ()]/g, '_').slice(0, 120);
  const extRaw = base.split('.').pop().toLowerCase();
  const ext = ALIAS[extRaw] || extRaw;
  const type = allowed.includes(ext) ? TYPES[ext] : null;
  if (!base || !type) throw badRequest(`"${base || 'file'}" isn't an allowed type (${describe})`);
  const m = /^data:[^;,]*;base64,([A-Za-z0-9+/=]+)$/.exec(data || '');
  if (!m) throw badRequest('File data is invalid');
  const buf = Buffer.from(m[1], 'base64');
  if (!buf.length) throw badRequest('File is empty');
  if (buf.length > MAX_BYTES) throw badRequest(`"${base}" is larger than 5 MB`);
  if (!type.test(buf)) throw badRequest(`"${base}" doesn't look like a real .${ext} file`);
  return { base, ext, buf, mime: type.mime, inline: !!type.inline };
}

/** Write bytes under a random name (never the user's name) outside the web root. */
function writeUpload(dir, ext, buf) {
  fs.mkdirSync(dir, { recursive: true });
  const stored = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(dir, stored), buf);
  return stored;
}

function save(db, requestId, user, { name, data, isInternal }) {
  canSee(db, requestId, user);
  const { base, ext, buf, mime } = decodeUpload({ name, data });
  const stored = writeUpload(DIR, ext, buf);
  const type = { mime };
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO attachments (request_id, uploader_id, stored_name, original_name, mime, size, is_internal) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(requestId, user.id, stored, base, type.mime, buf.length, user.role !== 'candidate' && isInternal ? 1 : 0);
  return Number(lastInsertRowid);
}

function list(db, requestId, user) {
  return db.prepare(`
    SELECT a.id, a.original_name AS name, a.mime, a.size, a.is_internal, a.created_at, u.full_name AS uploader
    FROM attachments a JOIN users u ON u.id = a.uploader_id
    WHERE a.request_id = ? ${user.role === 'candidate' ? 'AND a.is_internal = 0' : ''}
    ORDER BY a.id
  `).all(requestId).map((a) => ({ ...a, is_internal: !!a.is_internal }));
}

function open(db, id, user) {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
  if (!a || (a.is_internal && user.role === 'candidate')) throw notFound('Attachment not found');
  canSee(db, a.request_id, user);
  const ext = a.stored_name.split('.').pop();
  return { path: path.join(DIR, a.stored_name), name: a.original_name, mime: a.mime, inline: !!TYPES[ext]?.inline };
}

module.exports = { save, list, open, decodeUpload, writeUpload, TYPES, MAX_BYTES };
