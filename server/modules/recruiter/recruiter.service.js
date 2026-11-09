'use strict';
const { notFound } = require('../../utils/AppError');
const { avatarOf } = require('../avatar/catalog');

function parseSkills(value) {
  const skills = JSON.parse(value || '[]');
  return Array.isArray(skills) ? skills.filter((skill) => typeof skill === 'string') : [];
}

function stageCandidates(db) {
  const rows = db.prepare(`
    SELECT u.id, u.full_name, u.email, u.avatar_config, u.gender, cp.stream, cp.cohort,
           p.headline, p.summary, p.skills, p.github_url, p.cv_url,
           m.key AS milestone_key, m.title AS milestone_title, m.sort_order,
           COUNT(mr.id) AS requirement_count, COUNT(progress.requirement_id) AS completed_count
    FROM users u
    JOIN candidate_profiles cp ON cp.user_id = u.id
    JOIN candidate_portfolios p ON p.candidate_id = u.id AND p.is_published = 1
    CROSS JOIN milestones m
    JOIN milestone_requirements mr ON mr.milestone_id = m.id
    LEFT JOIN candidate_requirement_progress progress
      ON progress.candidate_id = u.id AND progress.requirement_id = mr.id
    WHERE u.role = 'candidate' AND u.is_active = 1
    GROUP BY u.id, m.id
    ORDER BY u.full_name, m.sort_order
  `).all();

  const candidates = new Map();
  for (const row of rows) {
    let candidate = candidates.get(row.id);
    if (!candidate) {
      candidate = {
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
        milestones: [],
      };
      candidates.set(row.id, candidate);
    }
    candidate.milestones.push({
      key: row.milestone_key,
      title: row.milestone_title,
      total: row.requirement_count,
      completed: row.completed_count,
    });
  }

  return [...candidates.values()].map((candidate) => {
    const workReady = candidate.milestones.some((m) => m.key === 'work_ready' && m.completed === m.total);
    const placed = candidate.milestones.some((m) => m.key === 'placed' && m.completed === m.total);
    const current = candidate.milestones.find((m) => m.completed < m.total) || candidate.milestones.at(-1);
    return {
      ...candidate,
      stage: current?.key || '',
      stageLabel: current?.title || 'Not started',
      isWorkReady: workReady || placed,
      isPlaced: placed,
      milestones: undefined,
    };
  });
}

function listTalent(db, { q = '', stream = '', stage = '' } = {}) {
  let candidates = stageCandidates(db);
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

function summary(db) {
  const candidates = stageCandidates(db);
  return {
    visibleProfiles: candidates.length,
    workReadyCandidates: candidates.filter((candidate) => candidate.isWorkReady).length,
    placedCandidates: candidates.filter((candidate) => candidate.isPlaced).length,
    activeStreams: new Set(candidates.map((candidate) => candidate.stream).filter(Boolean)).size,
    streams: [...new Set(candidates.map((candidate) => candidate.stream).filter(Boolean))].sort(),
  };
}

function getPublishedProfile(db, candidateId) {
  const candidate = stageCandidates(db).find((entry) => entry.id === candidateId);
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
  return { ...candidate, verifiedCredentials, projects };
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

module.exports = { listTalent, summary, getPublishedProfile, getOwnPortfolio, saveOwnPortfolio, addProject, deleteProject };
