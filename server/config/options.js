'use strict';
/** Reference lists shown in registration / profile forms (served at GET /api/meta/options). */
module.exports = {
  streams: [
    'Software Development', 'Data Science & Analytics', 'Cloud Engineering', 'Cybersecurity',
    'AI & Machine Learning', 'UX/UI Design', 'Systems Support', 'Salesforce Development',
  ],
  cohorts: [
    '2026 Cohort 1 · Cape Town', '2026 Cohort 1 · Johannesburg', '2026 Cohort 2 · Cape Town',
    '2026 Cohort 2 · Johannesburg', '2026 Cohort 2 · Remote',
  ],
  // CAPACITI staff positions (staff_profiles.position)
  positions: [
    'Talent Development Coach (Supervisor)',
    'Lead Talent Development Coach',
    'IT Support Coordinator',
    'LAN & Desktop Support (FIT Team)',
    'Software Lead Tech Champ & Tech Mentor',
    'Scrum Master',
    'Tech Delivery Manager & Tech Mentor',
    'Placement Specialist',
  ],
  // Programme team people candidates are linked to (candidate_profiles)
  mentors: ['Shadley', 'Omphile', 'Bianca'],
  techChamps: ['Omphile', 'Bradley', 'Eudene'],
  supervisors: ['Liyabona', 'Bianca'],
  team: [
    { name: 'Liyabona', position: 'Talent Development Coach (Supervisor)' },
    { name: 'Bianca', position: 'Lead Talent Development Coach' },
    { name: 'Bradley', position: 'IT Support Coordinator' },
    { name: 'Eudene', position: 'LAN & Desktop Support (FIT Team)' },
    { name: 'Omphile', position: 'Software Lead Tech Champ & Tech Mentor' },
    { name: 'Tarryn', position: 'Scrum Master' },
    { name: 'Shadley', position: 'Tech Delivery Manager & Tech Mentor' },
    { name: 'Ehrin', position: 'Placement Specialist' },
  ],
};
