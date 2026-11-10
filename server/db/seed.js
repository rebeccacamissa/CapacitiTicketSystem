'use strict';
/**
 * Seeds demo users, requests (driven through the real workflow pipeline so the
 * audit trail is genuine), roadmap evidence, stage decisions and the newer
 * features (review request, interview request, pending placement, linked CV).
 *   npm run db:seed    – seed if empty (also adds any missing demo accounts)
 *   npm run db:reset   – wipe the database and reseed
 *
 * Resetting a DATABASE_URL database (e.g. Neon) additionally requires
 * ALLOW_DB_RESET=true, so production data can't be wiped by accident.
 */
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const { databaseUrl, pgliteDir } = require('../config/env');

const PASSWORD = 'Capaciti@2026';

async function main() {
  if (process.argv.includes('--reset')) {
    if (databaseUrl) {
      if (process.env.ALLOW_DB_RESET !== 'true') {
        console.error('Refusing to reset a DATABASE_URL database. Set ALLOW_DB_RESET=true if you really mean it.');
        process.exit(1);
      }
      const pg = require('pg');
      const c = new pg.Client({ connectionString: databaseUrl, ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? false : { rejectUnauthorized: false } });
      await c.connect();
      await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      await c.end();
    } else if (fs.existsSync(pgliteDir)) {
      fs.rmSync(pgliteDir, { recursive: true, force: true });
    }
    console.log('Database cleared.');
  }

  const { initDb } = require('./connection');
  const db = await initDb();
  const hash = bcrypt.hashSync(PASSWORD, 10);

  if ((await db.one('SELECT COUNT(*) n FROM users')).n > 0) {
    // Databases seeded before the facilitator role existed still get the demo facilitator.
    if (!await db.one("SELECT 1 FROM users WHERE email = 'facilitator@capaciti.org.za'")) {
      const id = await db.insert("INSERT INTO users (full_name, first_name, surname, email, password_hash, role, date_of_birth, gender) VALUES ('Naledi Sithole', 'Naledi', 'Sithole', 'facilitator@capaciti.org.za', ?, 'facilitator', '1990-09-21', 'female')", hash);
      await db.run("INSERT INTO staff_profiles (user_id, position) VALUES (?, 'Learning Facilitator')", id);
      for (const stream of ['Software Development', 'Data Science & Analytics', 'Cybersecurity']) await db.run('INSERT INTO facilitator_streams (user_id, stream) VALUES (?, ?)', id, stream);
      console.log('Added the demo facilitator account.');
    }
    console.log('Database already has users — skipping seed. Use `npm run db:reset` to start fresh.');
    await db.close();
    return;
  }

  const { createRequest } = require('../modules/requests/requests.service');
  const wf = require('../modules/workflow/transition.service');
  const gamify = require('../modules/engage/gamification.service');

  /** DOB whose next birthday is `inDays` from today (so the birthday features always demo well). */
  function dobIn(inDays, year) {
    const d = new Date();
    d.setDate(d.getDate() + inDays);
    return `${year}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  async function addUser(name, email, role, dob, extra = {}) {
    const [first, ...rest] = name.split(' ');
    const id = await db.insert('INSERT INTO users (full_name, first_name, surname, email, password_hash, role, date_of_birth, gender, avatar_config, privacy_ack_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, now_iso())',
      name, first, rest.join(' '), email, hash, role, dob, extra.gender || 'prefer-not', extra.avatar ? JSON.stringify({ ...extra.avatar, custom: true }) : null);
    if (role === 'candidate') {
      await db.run('INSERT INTO candidate_profiles (user_id, cohort, stream, mentor, tech_champ, supervisor) VALUES (?, ?, ?, ?, ?, ?)',
        id, extra.cohort, extra.stream, extra.mentor, extra.techChamp, extra.supervisor);
    } else {
      await db.run('INSERT INTO staff_profiles (user_id, position, employee_id) VALUES (?, ?, ?)', id, extra.position, extra.employeeId);
    }
    return { id, role, fullName: name, firstName: first };
  }

  const admin = await addUser('Nomsa Dlamini', 'admin@capaciti.org.za', 'admin', '1985-03-14', { position: 'Operations Lead', employeeId: 'CAP-0001', gender: 'female', avatar: { v: 2, art: 'polished', look: 'runway', skin: '7b4a2a', hair: 'bun', hairColor: '2c1b18', rearHair: 'none', facialHair: 'none', clothing: 'openJacket', clothesColor: '151613', bg: 'studio' } });
  const sup1 = await addUser('Thabo Mokoena', 'thabo@capaciti.org.za', 'support', dobIn(21, 1992), { position: 'Programme Manager', employeeId: 'CAP-0142', gender: 'male' });
  const sup2 = await addUser('Aisha Patel', 'aisha@capaciti.org.za', 'support', '1994-07-02', { position: 'Support Specialist', employeeId: 'CAP-0187', gender: 'female', avatar: { v: 2, art: 'polished', look: 'doll', skin: 'b98e6a', hair: 'sideComed', hairColor: '2c1b18', rearHair: 'longStraight', facialHair: 'none', clothing: 'turtleNeck', clothesColor: 'be185d', bg: 'sunset' } });
  const rec = await addUser('Recruiter Demo', 'recruiter@capaciti.org.za', 'recruiter', '1988-04-15', { position: 'Talent Partner', employeeId: 'CAP-0301' });
  const fac = await addUser('Naledi Sithole', 'facilitator@capaciti.org.za', 'facilitator', '1990-09-21', { position: 'Learning Facilitator', employeeId: 'CAP-0220', gender: 'female' });
  for (const stream of ['Software Development', 'Data Science & Analytics', 'Cybersecurity']) await db.run('INSERT INTO facilitator_streams (user_id, stream) VALUES (?, ?)', fac.id, stream);
  const team = { mentor: 'Thabo Mokoena', techChamp: 'Kyle Adams', supervisor: 'Aisha Patel' };
  const c1 = await addUser('Lerato Khumalo', 'lerato@example.com', 'candidate', dobIn(9, 2001), { cohort: '2026 Cohort 1 · Cape Town', stream: 'Software Development', ...team, gender: 'female' });
  const c2 = await addUser('Sipho Ndlovu', 'sipho@example.com', 'candidate', dobIn(0, 2002), { cohort: '2026 Cohort 1 · Johannesburg', stream: 'Data Science & Analytics', mentor: 'Aisha Patel', techChamp: 'Naledi Sithole', supervisor: 'Thabo Mokoena', gender: 'male', avatar: { v: 2, art: 'classic', look: 'tactical', skin: '614335', hair: 'shortFlat', hairColor: '2c1b18', hatColor: '4b5320', facialHair: 'beardLight', clothing: 'hoodie', clothesColor: '4b5320', graphic: 'skullOutline', accessory: 'wayfarers', accessoryColor: '151613', bg: 'camo' } });
  const c3 = await addUser('Zanele Mthembu', 'zanele@example.com', 'candidate', dobIn(40, 2000), { cohort: '2026 Cohort 1 · Cape Town', stream: 'Cloud Engineering', ...team, gender: 'female', avatar: { v: 2, art: 'classic', look: 'doll', skin: 'ae5d29', hair: 'dreads02', hairColor: '2c1b18', hatColor: '1d2951', facialHair: 'none', clothing: 'shirtScoopNeck', clothesColor: 'ec4899', graphic: 'diamond', accessory: 'wayfarers', accessoryColor: 'f1d1d1', bg: 'sunset' } });
  const c4 = await addUser('Kagiso Molefe', 'kagiso@example.com', 'candidate', dobIn(4, 2003), { cohort: '2026 Cohort 2 · Remote', stream: 'Cybersecurity', mentor: 'Aisha Patel', techChamp: 'Kyle Adams', supervisor: 'Nomsa Dlamini', gender: 'male' });
  const c5 = await addUser('Amahle Zulu', 'amahle@example.com', 'candidate', '2001-11-30', { cohort: '2026 Cohort 2 · Cape Town', stream: 'UX/UI Design', ...team, gender: 'female', avatar: { v: 2, art: 'classic', look: 'runway', skin: '614335', hair: 'fro', hairColor: '2c1b18', hatColor: '1d2951', facialHair: 'none', clothing: 'blazerAndShirt', clothesColor: 'f25251', graphic: 'diamond', accessory: 'round', accessoryColor: 'd4af37', bg: 'night' } });

  // Realistic join dates for the demo candidates (stage decisions below are backdated too).
  for (const [c, d] of [[c1, 140], [c2, 120], [c3, 170], [c4, 45], [c5, 25]]) await db.run("UPDATE users SET created_at = iso_shift('-' || ? || ' days') WHERE id = ?", d, c.id);

  const cat = Object.fromEntries((await db.all('SELECT id, name FROM categories')).map((c) => [c.name, c.id]));

  async function make(candidate, category, priority, title, description, hoursAgo, steps = []) {
    const r = await createRequest(db, { actor: candidate, title, description, categoryId: cat[category], priority });
    await db.run(`UPDATE requests SET created_at = iso_shift('-' || ? || ' hours'),
      due_at = iso_add(iso_shift('-' || ? || ' hours'), (SELECT hours FROM priority_sla p WHERE p.priority = requests.priority) || ' hours')
      WHERE id = ?`, hoursAgo, hoursAgo, r.id);
    for (const s of steps) {
      if (s.assign) await wf.assignRequest(db, r.id, { assigneeId: s.assign.id, actor: s.by, note: s.note });
      else if (s.msg) await wf.addMessage(db, r.id, { actor: s.by, body: s.msg, isInternal: s.internal, notify: false });
      else await wf.transitionStatus(db, r.id, { toStatus: s.to, actor: s.by, note: s.note, message: s.message, resolution: s.resolution, notify: false });
    }
    return r;
  }

  await make(c1, 'Connectivity', 'High', 'Mobile data not loading for online classes',
    'Since Monday my data bundle has not been working and I cannot join the live sessions on Teams.', 30, [
      { assign: sup1, by: sup1, note: 'Taking this one — likely an APN issue.' },
      { to: 'In Progress', by: sup1 },
      { to: 'Waiting for Candidate', by: sup1, message: 'Please send a screenshot of your APN settings and your SIM network provider.' },
    ]);
  await make(c1, 'Learning platform access', 'Medium', 'Cannot log in to the learning platform',
    'I get an "account locked" error when I try to sign in to the learning platform.', 100, [
      { assign: sup2, by: admin },
      { to: 'In Progress', by: sup2 },
      { to: 'Resolved', by: sup2, resolution: 'Account unlocked and password reset link sent.', message: 'Your account is unlocked — please check your email.' },
      { to: 'Closed', by: c1 },
    ]);
  await make(c1, 'Career support', 'Low', 'Feedback on my CV draft',
    'Could someone review my CV before the work-readiness workshop next week?', 4);
  await make(c2, 'Attendance', 'Urgent', 'Attendance marked absent while on approved leave',
    'I was on approved family responsibility leave on 3 and 4 November but am showing as absent.', 10, [
      { assign: sup1, by: sup1 },
      { to: 'In Progress', by: sup1, note: 'Checking leave register with the facilitator.' },
    ]);
  await make(c2, 'Assessments', 'High', 'Request re-assessment for Module 4',
    'My Module 4 assessment submission failed to upload before the deadline due to load-shedding.', 60);
  await make(c2, 'Technical support', 'Medium', 'Laptop keyboard not working',
    'Several keys on my CAPACITI-issued laptop have stopped working.', 200, [
      { assign: sup2, by: sup2 },
      { to: 'In Progress', by: sup2 },
      { to: 'Resolved', by: sup2, resolution: 'Device swapped at the Cape Town office.' },
      { to: 'Reopened', by: c2, message: 'The replacement laptop has the same problem.' },
    ]);
  await make(c3, 'Administration', 'Low', 'Stipend payment date query',
    'When will the November stipend be paid? I need to plan my transport costs.', 150, [
      { assign: admin, by: admin },
      { to: 'In Progress', by: admin },
      { to: 'Resolved', by: admin, resolution: 'Confirmed stipend payment date of 25 November.' },
    ]);
  await make(c3, 'Well-being referral', 'High', 'Would like to speak to a counsellor',
    'I have been feeling overwhelmed and would like to be referred to a counsellor.', 80, [
      { assign: sup2, by: sup2 },
      { to: 'In Progress', by: sup2, note: 'Confidential — referral submitted to wellness partner.' },
    ]);
  await make(c3, 'Course content', 'Medium', 'Clarification on capstone brief',
    'The capstone brief mentions an API integration — is a public API acceptable?', 2);

  // Roadmap evidence (exit criteria) ------------------------------------------------
  const reqs = await db.all('SELECT mr.id, m.sort_order AS m, mr.sort_order AS r FROM milestone_requirements mr JOIN milestones m ON m.id = mr.milestone_id ORDER BY m.sort_order, mr.sort_order');
  async function progress(candidate, upToMilestone, partialCount, startDaysAgo) {
    let day = startDaysAgo;
    for (const r of reqs) {
      if (r.m < upToMilestone || (r.m === upToMilestone && r.r <= partialCount)) {
        await db.run("INSERT INTO candidate_requirement_progress (candidate_id, requirement_id, completed_at, verified_by) VALUES (?, ?, iso_shift('-' || ? || ' days'), ?)", candidate.id, r.id, day, sup1.id);
        day = Math.max(1, day - 6);
      }
    }
  }
  await progress(c1, 2, 2, 120); // In Training, 2/4 exit criteria evidenced
  await progress(c2, 3, 3, 110); // Work Ready, 3/5
  await progress(c3, 4, 1, 150); // Placed, first day done
  await progress(c4, 1, 8, 40);  // Enrolled with every exit criterion evidenced: ready for a stage review
  await progress(c5, 1, 3, 20);  // Enrolled, 3/8

  // Official stage decisions, through the same database triggers as live decisions,
  // backdated for a realistic trail.
  async function decide(candidate, to, actor, reason, daysAgo) {
    const from = (await db.one('SELECT stage FROM candidate_stages WHERE candidate_id = ?', candidate.id))?.stage || 'enrolled';
    await db.tx(async (t) => {
      await t.run("INSERT INTO stage_decisions (candidate_id, from_stage, to_stage, direction, decided_by, reason, created_at) VALUES (?, ?, ?, 'forward', ?, ?, iso_shift('-' || ? || ' days'))",
        candidate.id, from, to, actor.id, reason, daysAgo);
      const { changes } = await t.run("UPDATE candidate_stages SET stage = ?, updated_at = iso_shift('-' || ? || ' days') WHERE candidate_id = ?", to, daysAgo, candidate.id);
      if (!changes) await t.run("INSERT INTO candidate_stages (candidate_id, stage, updated_at) VALUES (?, ?, iso_shift('-' || ? || ' days'))", candidate.id, to, daysAgo);
    });
  }
  await decide(c1, 'training', fac, 'Onboarding complete: contract signed, laptop and platform access confirmed, orientation attended.', 70);
  await decide(c2, 'training', fac, 'All enrolment documents verified and orientation attended.', 90);
  await decide(c2, 'work_ready', fac, 'Passed every assessment with 92% attendance; capstone dashboard submitted.', 25);
  await decide(c3, 'training', admin, 'Enrolment checklist complete.', 130);
  await decide(c3, 'work_ready', admin, 'Capstone deployed and all assessments passed.', 70);
  await decide(c3, 'placed', admin, 'Matched with a corporate partner and internship agreement signed.', 12);

  // Portfolios published for the recruiter preview --------------------------------------
  const savePortfolio = (id, headline, summary, skills) => db.run('INSERT INTO candidate_portfolios (candidate_id, is_published, headline, summary, skills) VALUES (?, 1, ?, ?, ?)', id, headline, summary, JSON.stringify(skills));
  await savePortfolio(c1.id, 'Software developer in training', 'Building accessible web applications and learning through practical projects.', ['JavaScript', 'HTML', 'CSS', 'Accessibility']);
  await savePortfolio(c2.id, 'Work-ready data analyst', 'Turns real-world questions into clear, useful data insights.', ['Python', 'SQL', 'Data visualisation']);
  await savePortfolio(c3.id, 'Cloud engineering graduate', 'Designs and deploys reliable cloud infrastructure and services.', ['AWS', 'Linux', 'Docker', 'Networking']);
  const addProject = (id, title, description) => db.run('INSERT INTO portfolio_items (candidate_id, title, description) VALUES (?, ?, ?)', id, title, description);
  await addProject(c1.id, 'Accessible support portal', 'A responsive portal prototype with keyboard-friendly forms and clear status updates.');
  await addProject(c2.id, 'Cohort attendance analysis', 'A data analysis project exploring attendance patterns and practical interventions.');
  await addProject(c3.id, 'Cloud deployment project', 'A containerised web service deployed with monitoring and a documented release workflow.');

  // A CV document for Sipho, linked as evidence for "CV reviewed and approved".
  const portfolio = require('../modules/portfolio/portfolio.service');
  const cv = await portfolio.saveGenerated(db, c2.id, {
    title: 'Sipho Ndlovu CV', ext: 'txt', mime: 'text/plain; charset=utf-8', source: 'upload',
    buf: Buffer.from('SIPHO NDLOVU\nJohannesburg · sipho@example.com\n\nPROFILE\nData analyst in the CAPACITI Data Science & Analytics stream.\n\nSKILLS\n- Python, SQL, data visualisation\n\nPROJECTS\n- Cohort attendance analysis: explored attendance patterns and suggested practical interventions.\n', 'utf8'),
  });
  const cvReq = await db.one("SELECT mr.id FROM milestone_requirements mr JOIN milestones m ON m.id = mr.milestone_id WHERE m.key = 'work_ready' AND mr.sort_order = 1");
  await db.run('UPDATE candidate_requirement_progress SET file_id = ? WHERE candidate_id = ? AND requirement_id = ?', cv.id, c2.id, cvReq.id);

  // Newer workflows: a review request, an interview request and a placement to confirm.
  await db.run("INSERT INTO review_requests (candidate_id, stage, note, created_at) VALUES (?, 'training', ?, iso_shift('-1 days'))", c1.id, 'I think I have finished my core modules. Could you check my evidence?');
  await db.run("INSERT INTO interview_requests (recruiter_id, candidate_id, company, role_title, message, proposed_at, mode, created_at) VALUES (?, ?, 'Ubuntu Analytics', 'Junior Data Analyst', 'We liked your attendance analysis project and would love to chat.', ?, 'online', iso_shift('-2 hours'))",
    rec.id, c2.id, new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10) + 'T10:00');
  await db.run("INSERT INTO interview_requests (recruiter_id, candidate_id, company, role_title, message, mode, status, candidate_note, responded_at, created_at) VALUES (?, ?, 'Cape Cloud Co', 'Cloud Support Intern', 'Your deployment project stood out.', 'in-person', 'accepted', 'Thank you, I look forward to it!', iso_shift('-10 days'), iso_shift('-14 days'))",
    rec.id, c3.id);
  await db.run("INSERT INTO placements (candidate_id, recruiter_id, company, role_title, start_date, note, created_at) VALUES (?, ?, 'Ubuntu Analytics', 'Junior Data Analyst', ?, 'Offer accepted after second interview.', iso_shift('-1 hours'))",
    c2.id, rec.id, new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));

  // ---- Engagement: XP, badges, ratings, feed -----------------------------------------
  for (const row of await db.all('SELECT candidate_id, requirement_id FROM candidate_requirement_progress')) await gamify.award(db, row.candidate_id, 'requirement', row.requirement_id);
  for (const d of await db.all("SELECT candidate_id, to_stage FROM stage_decisions WHERE direction = 'forward'")) await gamify.award(db, d.candidate_id, 'milestone', d.to_stage);
  for (const r of await db.all('SELECT id, candidate_id FROM requests')) await gamify.award(db, r.candidate_id, 'request_created', r.id);
  for (const r of await db.all("SELECT id, candidate_id FROM requests WHERE status = 'Closed'")) await gamify.award(db, r.candidate_id, 'request_closed', r.id);
  for (const r of await db.all('SELECT id, assigned_to FROM requests WHERE resolved_at IS NOT NULL AND assigned_to IS NOT NULL')) await gamify.award(db, r.assigned_to, 'resolved', r.id);
  for (const u of await db.all('SELECT id FROM users WHERE avatar_config IS NOT NULL')) await gamify.award(db, u.id, 'avatar');

  const closed = await db.all("SELECT id, candidate_id FROM requests WHERE status IN ('Resolved','Closed') ORDER BY id");
  const ratings = [[5, 'Thabo sorted my login within an hour. Brilliant support!'], [4, 'Quick turnaround on the stipend date, thank you.'], [3, null]];
  for (const [i, r] of closed.entries()) {
    if (!ratings[i]) continue;
    await db.run('INSERT INTO request_ratings (request_id, candidate_id, rating, comment) VALUES (?, ?, ?, ?)', r.id, r.candidate_id, ratings[i][0], ratings[i][1]);
    await gamify.award(db, r.candidate_id, 'rating', r.id);
  }

  await db.run("INSERT INTO feed_posts (kind, author_id, cohort, body, created_at) VALUES ('announcement', ?, NULL, ?, iso_shift('-2 days'))",
    admin.id, 'Welcome to the new CAPACITI Support portal! Meet Cammy, your assistant in the corner. She can walk you through everything.');
  await db.run("INSERT INTO feed_posts (kind, author_id, cohort, body, created_at) VALUES ('announcement', ?, ?, ?, iso_shift('-5 hours'))",
    sup1.id, '2026 Cohort 1 · Cape Town', 'Reminder: capstone project check-ins are this Thursday at 10:00 in the Woodstock lab. Bring your progress board.');
  await gamify.award(db, sup1.id, 'announcement');

  console.log('Seed complete.\n');
  console.table([
    { role: 'admin', email: 'admin@capaciti.org.za' },
    { role: 'support', email: 'thabo@capaciti.org.za' },
    { role: 'support', email: 'aisha@capaciti.org.za' },
    { role: 'facilitator', email: 'facilitator@capaciti.org.za' },
    { role: 'recruiter', email: 'recruiter@capaciti.org.za' },
    { role: 'candidate', email: 'lerato@example.com' },
    { role: 'candidate', email: 'sipho@example.com' },
    { role: 'candidate', email: 'zanele@example.com' },
  ]);
  console.log(`All demo passwords: ${PASSWORD}`);
  void c5; void c4;
  await db.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
