'use strict';
/**
 * Guided CV builder: validates the structured form data and renders a clean,
 * ATS-friendly single-column PDF (no photo, no ID number, no age).
 */
const PDFDocument = require('pdfkit');
const { badRequest } = require('../../utils/AppError');

const LIMITS = { experience: 8, education: 6, projects: 8, certifications: 10, skills: 30, points: 6 };

const str = (v, max, label) => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw badRequest(`${label} must be text`);
  const s = v.trim();
  if (s.length > max) throw badRequest(`${label} must be at most ${max} characters`);
  return s;
};
const list = (v, max, label) => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw badRequest(`${label} must be a list`);
  if (v.length > max) throw badRequest(`Add at most ${max} ${label.toLowerCase()}`);
  return v;
};
const url = (v, label) => {
  const s = str(v, 300, label);
  if (s && !/^https:\/\/\S+$/i.test(s)) throw badRequest(`${label} must be an https:// link`);
  return s;
};

/** Validate and normalise CV builder data. */
function clean(d = {}) {
  if (typeof d !== 'object' || Array.isArray(d)) throw badRequest('CV data is invalid');
  return {
    fullName: str(d.fullName, 120, 'Full name'),
    headline: str(d.headline, 120, 'Headline'),
    email: str(d.email, 254, 'Email'),
    phone: str(d.phone, 30, 'Phone'),
    location: str(d.location, 80, 'Location'),
    linkedin: url(d.linkedin, 'LinkedIn'),
    github: url(d.github, 'GitHub'),
    summary: str(d.summary, 1200, 'Profile summary'),
    skills: list(d.skills, LIMITS.skills, 'Skills').map((s) => str(s, 60, 'Skill')).filter(Boolean),
    experience: list(d.experience, LIMITS.experience, 'Experience').map((e) => ({
      role: str(e?.role, 120, 'Role'), organisation: str(e?.organisation, 120, 'Organisation'),
      start: str(e?.start, 20, 'Start'), end: str(e?.end, 20, 'End'),
      points: list(e?.points, LIMITS.points, 'Bullet points').map((p) => str(p, 300, 'Bullet point')).filter(Boolean),
    })).filter((e) => e.role || e.organisation),
    education: list(d.education, LIMITS.education, 'Education').map((e) => ({
      qualification: str(e?.qualification, 160, 'Qualification'), institution: str(e?.institution, 160, 'Institution'), year: str(e?.year, 20, 'Year'),
    })).filter((e) => e.qualification || e.institution),
    projects: list(d.projects, LIMITS.projects, 'Projects').map((p) => ({
      name: str(p?.name, 120, 'Project name'), description: str(p?.description, 500, 'Project description'), link: url(p?.link, 'Project link'),
    })).filter((p) => p.name),
    certifications: list(d.certifications, LIMITS.certifications, 'Certifications').map((c) => ({
      name: str(c?.name, 160, 'Certification'), issuer: str(c?.issuer, 120, 'Issuer'), year: str(c?.year, 20, 'Year'),
    })).filter((c) => c.name),
  };
}

/** Render CV data to a PDF Buffer. */
function renderPdf(cv) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `${cv.fullName || 'CV'}`, Author: cv.fullName || '' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const ink = '#1d2951';
    const accent = '#6115d0';
    const muted = '#4b5563';
    const width = doc.page.width - 100;

    doc.fillColor(ink).font('Helvetica-Bold').fontSize(22).text(cv.fullName || 'Your Name');
    if (cv.headline) doc.font('Helvetica').fontSize(12).fillColor(accent).text(cv.headline);
    const contact = [cv.email, cv.phone, cv.location, cv.linkedin, cv.github].filter(Boolean).join('  ·  ');
    if (contact) doc.moveDown(0.3).fontSize(9).fillColor(muted).text(contact);

    const section = (title) => {
      doc.moveDown(0.9).font('Helvetica-Bold').fontSize(11).fillColor(accent).text(title.toUpperCase(), { characterSpacing: 1 });
      const y = doc.y + 2;
      doc.moveTo(50, y).lineTo(50 + width, y).strokeColor('#e5e7eb').lineWidth(1).stroke();
      doc.moveDown(0.4).font('Helvetica').fontSize(10).fillColor('#111827');
    };
    const bullet = (text) => doc.text(`•  ${text}`, { indent: 8, paragraphGap: 1 });

    if (cv.summary) { section('Profile'); doc.text(cv.summary, { align: 'left' }); }
    if (cv.skills.length) { section('Skills'); doc.text(cv.skills.join('  ·  ')); }
    if (cv.experience.length) {
      section('Experience');
      for (const e of cv.experience) {
        doc.font('Helvetica-Bold').text(`${e.role}${e.organisation ? `, ${e.organisation}` : ''}`, { continued: !!(e.start || e.end) });
        if (e.start || e.end) doc.font('Helvetica').fillColor(muted).text(`   ${[e.start, e.end].filter(Boolean).join(' – ')}`);
        doc.font('Helvetica').fillColor('#111827');
        e.points.forEach(bullet);
        doc.moveDown(0.4);
      }
    }
    if (cv.projects.length) {
      section('Projects');
      for (const p of cv.projects) {
        doc.font('Helvetica-Bold').text(p.name);
        doc.font('Helvetica');
        if (p.description) doc.text(p.description);
        if (p.link) doc.fillColor(accent).text(p.link, { link: p.link, underline: false }).fillColor('#111827');
        doc.moveDown(0.3);
      }
    }
    if (cv.education.length) {
      section('Education');
      for (const e of cv.education) doc.font('Helvetica-Bold').text(e.qualification, { continued: true }).font('Helvetica').text(`${e.institution ? `, ${e.institution}` : ''}${e.year ? ` (${e.year})` : ''}`);
    }
    if (cv.certifications.length) {
      section('Certifications');
      for (const c of cv.certifications) bullet(`${c.name}${c.issuer ? `, ${c.issuer}` : ''}${c.year ? ` (${c.year})` : ''}`);
    }
    section('References');
    doc.text('Available on request.');
    doc.end();
  });
}

module.exports = { clean, renderPdf, LIMITS };
