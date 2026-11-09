'use strict';
const { notFound } = require('../../utils/AppError');
const { avatarOf } = require('../avatar/catalog');

function parseSkills(value) {
  const skills = JSON.parse(value || '[]');
  return Array.isArray(skills) ? skills.filter((skill) => typeof skill === 'string') : [];
}

/** Published, active candidates with their OFFICIAL stage (set only by audited stage decisions). */
function stageCandidates(db, recruiterId = null) {
  const rows = db.prepare(`
    SELECT u.id, u.full_name, u.email, u.avatar_config, u.gender, cp.stream, cp.cohort,
           p.headline, p.summary, p.skills, p.github_url, p.cv_url,
           COALESCE(cs.stage, 'enrolled') AS stage, ps.label AS stage_label, ps.sort_order AS stage_order,
           (SELECT COUNT(*) FROM portfolio_files f WHERE f.candidate_id = u.id) AS file_count,
           s.candidate_id IS NOT NULL AS shortlisted, s.note AS shortlist_note
    FROM users u
    JOIN candidate_profiles cp ON cp.user_id = u.id
    JOIN candidate_portfolios p ON p.candidate_id = u.id AND p.is_published = 1
    LEFT JOIN candidate_stages cs ON cs.candidate_id = u.id
    JOIN programme_stages ps ON ps.key = COALESCE(cs.stage, 'enrolled')
    LEFT JOIN recruiter_shortlist s ON s.candidate_id = u.id AND s.recruiter_id = ?
    WHERE u.role = 'candidate' AND u.is_active = 1
    ORDER BY u.full_name
  `).all(recruiterId);

  return rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    stream: row.stream || '',
    cohort: row.cohort || '',
    headline: row.headline,
    summary: row.summary,
    skills: parseSkills(row.skills),
    githubUrl: row.github_url,
    cvUrl: row.cv_url,
    avatar: avatarOf({ avatar_config: row.avatar_config, gender: row.gender }),
    stage: row.stage,
    stageLabel: row.stage_label,
    isWorkReady: row.stage_order >= 3,
    isPlaced: row.stage_order >= 4,
    fileCount: row.file_count,
    shortlisted: !!row.shortlisted,
    shortlistNote: row.shortlist_note || '',
  }));
}

function listTalent(db, { q = '', stream = '', stage = '', recruiterId = null, shortlisted = false } = {}) {
  let candidates = stageCandidates(db, recruiterId);
  if (shortlisted) candidates = candidates.filter((candidate) => candidate.shortlisted);
  if (q) {
    const term = q.toLocaleLowerCase();
    candidates = candidates.filter((candidate) =>
      [candidate.fullName, candidate.email, ...candidate.skills].some((value) => value.toLocaleLowerCase().includes(term))
    );
  }
  if (stream) candidates = candidates.filter((candidate) => candidate.stream === stream);
  if (stage) candidates = candidates.filter((candidate) => candidate.stage === stage);
  return candidates;
}

function summary(db, recruiterId = null) {
  const candidates = stageCandidates(db, recruiterId);
  return {
    visibleProfiles: candidates.length,
    workReadyCandidates: candidates.filter((candidate) => candidate.isWorkReady).length,
    placedCandidates: candidates.filter((candidate) => candidate.isPlaced).length,
    activeStreams: new Set(candidates.map((candidate) => candidate.stream).filter(Boolean)).size,
    shortlisted: candidates.filter((candidate) => candidate.shortlisted).length,
    streams: [...new Set(candidates.map((candidate) => candidate.stream).filter(Boolean))].sort(),
  };
}

function getPublishedProfile(db, candidateId, recruiterId = null) {
  const candidate = stageCandidates(db, recruiterId).find((entry) => entry.id === candidateId);
  if (!candidate) throw notFound('Published candidate profile not found');
  const verifiedCredentials = db.prepare(`
    SELECT mr.label, m.title AS milestone, progress.completed_at AS verified_at, verifier.full_name AS verified_by
    FROM candidate_requirement_progress progress
    JOIN milestone_requirements mr ON mr.id = progress.requirement_id
    JOIN milestones m ON m.id = mr.milestone_id
    LEFT JOIN users verifier ON verifier.id = progress.verified_by
    WHERE progress.candidate_id = ?
    ORDER BY m.sort_order, mr.sort_order
  `).all(candidateId).map((credential) => ({
    label: credential.label,
    milestone: credential.milestone,
    verifiedAt: credential.verified_at,
    verifiedBy: credential.verified_by,
  }));
  const projects = db.prepare(`
    SELECT id, title, description, project_url AS projectUrl, evidence_url AS evidenceUrl
    FROM portfolio_items WHERE candidate_id = ? ORDER BY created_at DESC, id DESC
  `).all(candidateId);
  const files = require('../portfolio/portfolio.service').list(db, candidateId);
  return { ...candidate, verifiedCredentials, projects, files };
}

function getOwnPortfolio(db, candidateId) {
  db.prepare('INSERT OR IGNORE INTO candidate_portfolios (candidate_id) VALUES (?)').run(candidateId);
  const portfolio = db.prepare(`
    SELECT is_published, headline, summary, skills, github_url AS githubUrl, cv_url AS cvUrl
    FROM candidate_portfolios WHERE candidate_id = ?
  `).get(candidateId);
  return {
    isPublished: !!portfolio.is_published,
    headline: portfolio.headline,
    summary: portfolio.summary,
    skills: parseSkills(portfolio.skills),
    githubUrl: portfolio.githubUrl,
    cvUrl: portfolio.cvUrl,
    projects: db.prepare(`
      SELECT id, title, description, project_url AS projectUrl, evidence_url AS evidenceUrl
      FROM portfolio_items WHERE candidate_id = ? ORDER BY created_at DESC, id DESC
    `).all(candidateId),
  };
}

function saveOwnPortfolio(db, candidateId, data) {
  const current = getOwnPortfolio(db, candidateId);
  const skills = data.skills === undefined ? current.skills : [...new Set(data.skills.split(',').map((skill) => skill.trim()).filter(Boolean))].slice(0, 20);
  db.prepare(`
    UPDATE candidate_portfolios SET is_published = ?, headline = ?, summary = ?, skills = ?,
      github_url = ?, cv_url = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE candidate_id = ?
  `).run(
    data.isPublished === undefined ? Number(current.isPublished) : Number(data.isPublished),
    data.headline ?? current.headline,
    data.summary ?? current.summary,
    JSON.stringify(skills),
    data.githubUrl === undefined ? current.githubUrl : data.githubUrl || null,
    data.cvUrl === undefined ? current.cvUrl : data.cvUrl || null,
    candidateId
  );
  return getOwnPortfolio(db, candidateId);
}

function addProject(db, candidateId, data) {
  getOwnPortfolio(db, candidateId);
  const id = Number(db.prepare(`
    INSERT INTO portfolio_items (candidate_id, title, description, project_url, evidence_url)
    VALUES (?, ?, ?, ?, ?)
  `).run(candidateId, data.title, data.description || '', data.projectUrl || null, data.evidenceUrl || null).lastInsertRowid);
  return db.prepare(`
    SELECT id, title, description, project_url AS projectUrl, evidence_url AS evidenceUrl
    FROM portfolio_items WHERE id = ?
  `).get(id);
}

function deleteProject(db, candidateId, projectId) {
  const result = db.prepare('DELETE FROM portfolio_items WHERE id = ? AND candidate_id = ?').run(projectId, candidateId);
  if (!result.changes) throw notFound('Portfolio project not found');
}

// ---- Private shortlist (one per recruiter) -------------------------------------
function shortlist(db, recruiterId) {
  return listTalent(db, { recruiterId, shortlisted: true });
}

function saveToShortlist(db, recruiterId, candidateId, note = '') {
  if (!stageCandidates(db).some((c) => c.id === candidateId)) throw notFound('Published candidate profile not found');
  db.prepare(`
    INSERT INTO recruiter_shortlist (recruiter_id, candidate_id, note) VALUES (?, ?, ?)
    ON CONFLICT (recruiter_id, candidate_id) DO UPDATE SET note = excluded.note
  `).run(recruiterId, candidateId, note);
  return { shortlisted: true, note };
}

function removeFromShortlist(db, recruiterId, candidateId) {
  db.prepare('DELETE FROM recruiter_shortlist WHERE recruiter_id = ? AND candidate_id = ?').run(recruiterId, candidateId);
  return { shortlisted: false };
}

module.exports = {
  listTalent, summary, getPublishedProfile, getOwnPortfolio, saveOwnPortfolio, addProject, deleteProject,
  shortlist, saveToShortlist, removeFromShortlist,
};
