'use strict';
/**
 * "Cammy" — CAPACITI's rule-based, context-aware assistant.
 * Replies are English templates translated per user language (server/i18n/*.js).
 * Intent keywords include common words in English, isiZulu, isiXhosa, Afrikaans and Sepedi.
 */
const { getRoadmap } = require('../progress/progress.service');
const { getProfile, birthdays } = require('../people/people.service');
const gamify = require('../engage/gamification.service');
const { tr } = require('../../i18n');

const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();
const has = (text, words) => words.some((w) => (w.includes(' ') ? text.includes(w) : new RegExp(`\\b${w}`).test(text)));

const HOME = { candidate: '/dashboard', support: '/insights', admin: '/admin' };

const KW = {
  greet: /^(hi|hello|hey|hiya|howzit|yo|sawubona|sanibonani|molo|molweni|hallo|haai|dumela|dumelang|thobela|good (morning|afternoon|evening)|goeie(more| more|middag|naand))\b/,
  thanks: ['thank', 'thanks', 'shot', 'appreciate', 'ngiyabonga', 'siyabonga', 'enkosi', 'ndiyabulela', 'dankie', 'ke a leboga', 'kea leboga'],
  tour: ['tour', 'walkthrough', 'walk through', 'show me around', 'guide me', 'how does this work', 'getting started', 'ngibonise', 'ndibonise', 'wys my', 'toer', 'mpontshe'],
  badges: ['badge', 'xp', 'level', 'points', 'achievement', 'unlock', 'ibheji', 'amabheji', 'punte', 'kenteken', 'dibeche'],
  avatar: ['avatar', 'outfit', 'my look', 'customi', 'wardrobe', 'appearance', 'isithombe', 'voorkoms'],
  feed: ['feed', 'announcement', 'news', 'cohort update', 'whats new', "what's new", 'izindaba', 'iindaba', 'nuus', 'ditaba'],
  palette: ['shortcut', 'search', 'find', 'command', 'keyboard', 'sesha', 'khangela', 'soek', 'nyaka'],
  a11y: ['accessib', 'disab', 'screen reader', 'blind', 'deaf', 'sign language', 'sasl', 'dyslex', 'wheelchair', 'hearing', 'low vision', 'text size', 'high contrast', 'read aloud', 'voice input', 'interpreter', 'toeganklik', 'gestremd', 'gebaretaal', 'ukukhubazeka', 'ulimi lwezandla', 'ulwimi lwezandla', 'bogole'],
  language: ['language', 'translate', 'isizulu', 'isixhosa', 'afrikaans', 'sepedi', 'english', 'ulimi', 'ulwimi', 'taal', 'polelo', 'leleme'],
  wellbeing: ['stress', 'anxious', 'overwhelmed', 'counsell', 'mental', 'suicid', 'depressed', 'not okay', 'not ok', 'ngicindezelekile', 'ngikhathazekile', 'ndixinezelekile', 'gestres', 'depressief', 'ke tshwenyegile'],
  nav: ['dashboard', 'navigate', 'where do i', 'how do i get', 'switch role', 'demo', 'other role', 'manager', 'admin dashboard', 'support dashboard'],
  workflow: ['workflow', 'status', 'statuses', 'what does', 'mean', 'process', 'waiting for candidate', 'reopen'],
  requests: ['request', 'ticket', 'case', 'issue status', 'check my', 'update on', 'isicelo', 'izicelo', 'versoek', 'kgopelo', 'dikgopelo'],
  journey: ['journey', 'roadmap', 'milestone', 'progress', 'next step', 'where am i', 'internship', 'work ready', 'uhambo', 'vordering', 'tswelopele', 'leeto'],
  team: ['mentor', 'supervisor', 'tech champ', 'champ', 'cohort', 'stream', 'my profile', 'umeluleki', 'umcebisi'],
  birthday: ['birthday', 'bday', 'born', 'usuku lokuzalwa', 'umhla wokuzalwa', 'verjaarsdag', 'matswalo'],
  queue: ['queue', 'unassigned', 'incoming', 'my cases', 'workload', 'overdue', 'tickets'],
  updateCandidate: ['update a candidate', 'candidate info', 'candidate details', 'mentor', 'cohort', 'verify', 'requirement'],
  adminUsers: ['add a user', 'add user', 'new user', 'create user', 'remove user', 'delete user', 'temporary password', 'reset password', 'role'],
  help: ['help', 'problem', 'issue', 'broken', 'not working', 'can t', 'cannot', 'usizo', 'ngisize', 'uncedo', 'ndincede', 'hulp', 'thuso', 'nthuse'],
  stipend: ['stipend', 'payment', 'paid', 'betaling'],
  profile: ['password', 'photo', 'picture', 'iphasiwedi', 'wagwoord'],
  sla: ['how long', 'sla', 'when will', 'response time'],
};

const CATEGORY_HINTS = [
  [['laptop', 'computer', 'device', 'keyboard', 'screen', 'software', 'install', 'rekenaar'], 'Technical support'],
  [['data', 'wifi', 'wi fi', 'internet', 'network', 'connect', 'router', 'bundle', 'load shedding', 'loadshedding'], 'Connectivity'],
  [['login', 'log in', 'password reset', 'platform', 'locked', 'lms', 'access'], 'Learning platform access'],
  [['absent', 'attendance', 'leave', 'sick', 'register', 'siek'], 'Attendance'],
  [['assessment', 'exam', 'test', 'mark', 'resubmit', 'deadline', 'eksamen'], 'Assessments'],
  [['module', 'content', 'capstone', 'course', 'material'], 'Course content'],
  [['cv', 'interview', 'job', 'internship', 'placement', 'career', 'werk', 'umsebenzi', 'umsebenzi'], 'Career support'],
  [['stipend', 'payment', 'contract', 'document'], 'Administration'],
  [['interpreter', 'sign language', 'sasl', 'screen reader', 'wheelchair', 'extra time', 'accommodation'], 'Accessibility support'],
];

const SUGGEST = {
  candidate: ['Show me around', 'Where am I on my journey?', 'Check my requests', 'Accessibility options', 'Who is my mentor?', 'I need help with data'],
  support: ['Show me around', 'What is in my queue?', 'Explain the workflow', 'How do I update a candidate?', 'Accessibility options'],
  admin: ['Show me around', 'How do I add a user?', 'Show unassigned tickets', 'Explain the workflow', 'Accessibility options'],
};

function reply(db, user, rawMessage) {
  const lang = user.language || 'en';
  const T = (s, v) => tr(lang, s, v);
  const text = norm(rawMessage || '');
  const act = (label, href) => ({ label: T(label), href });
  const out = (reply, actions = [], extra = {}) => ({
    reply, actions,
    suggestions: SUGGEST[user.role].map((q) => ({ label: T(q), q })),
    ...extra,
  });
  const first = user.firstName;

  if (!text || KW.greet.test(text)) {
    return out(T("Hi {name}! I'm Cammy, your CAPACITI guide. I can check your requests, explain the support process, show your journey progress and point you to the right place. What do you need?", { name: first }));
  }
  if (has(text, KW.thanks)) return out(T('Always a pleasure, {name}! Keep moving forward.', { name: first }), [], { mood: 'celebrate' });

  if (has(text, KW.tour)) {
    return out(T("Of course! I'll walk you through the key parts of your dashboard step by step. You can stop at any time."), [], { command: { type: 'tour' }, mood: 'happy' });
  }

  // Well-being first: never bury this.
  if (has(text, KW.wellbeing)) {
    return out(T("I'm really glad you reached out. You don't have to handle this alone. A **Well-being referral** request is confidential and goes straight to the support team, who can connect you with a counsellor. If you're in immediate danger, please call the SADAG 24-hour helpline on **0800 456 789**."),
      user.role === 'candidate' ? [act('Request well-being support', '/new-request?category=Well-being%20referral')] : [], { mood: 'concerned' });
  }

  if (has(text, KW.a11y)) {
    return out(T('You can change text size, contrast, fonts and spacing, turn on read aloud, voice input or a reading guide, and use keyboard shortcuts. Press **A** to open Accessibility settings. If you need an accommodation such as a SASL interpreter or extra time, add it under **My accessibility needs**.'),
      [{ label: T('Accessibility settings'), href: '#a11y' }, act('My accessibility needs', '/profile#access-needs'), ...(user.role === 'candidate' ? [act('Request accessibility support', '/new-request?category=Accessibility%20support')] : [])]);
  }

  if (has(text, KW.language)) {
    return out(T('You can switch language with the globe button at the top of the page. Available now: English, isiZulu, isiXhosa, Afrikaans and Sepedi. More South African languages are coming.'));
  }

  if (has(text, KW.badges)) {
    const g = gamify.summary(db, user.id, user.role);
    const earned = g.badges.filter((b) => b.earned);
    const next = g.badges.find((b) => !b.earned);
    let msg = T("You're **Level {level}** with **{xp} XP** ({toNext} XP to the next level). You've earned {earned} of {total} badges.", { level: g.level, xp: g.xp, toNext: g.levelSize - g.levelProgress, earned: earned.length, total: g.badges.length });
    if (earned.length) msg += ` ${earned.map((b) => T(b.name)).join(', ')}.`;
    if (next) msg += `\n\n${T('Next up: **{badge}**. {desc}.', { badge: T(next.name), desc: T(next.description) })}`;
    msg += `\n\n${T('Badges unlock new avatar outfits and accessories.')}`;
    return out(msg, [act('View achievements', '/profile#achievements')], { mood: 'celebrate' });
  }

  if (has(text, KW.avatar)) {
    return out(T('Open the **Avatar studio** to design your look. Choose an art style and a look (Everyday, Fashion Doll Glam, Tactical Operator or Runway Dress-Up), then change skin tone, hair, outfit, colours and extras. I wear whatever you design.'), [act('Open Avatar studio', '/profile#avatar')], { mood: 'happy' });
  }

  if (has(text, KW.feed)) {
    return out(T('The **Cohort feed** shows announcements from your programme team, milestone celebrations, new badges and birthdays. React to posts to cheer people on.'), [act('Open the feed', '/feed')]);
  }

  if (has(text, KW.palette)) {
    return out(T('Press **Ctrl + K** (or **Cmd + K** on a Mac) anywhere to search requests, jump to pages and run quick actions. Press **?** to see every keyboard shortcut.'), [], { command: { type: 'palette' } });
  }

  if (has(text, KW.nav)) {
    return out(T('Each role has its own home:\n• **Candidate**: Dashboard (journey, tickets, birthday, profile)\n• **Support / Manager**: Support dashboard (queue, workload, candidates)\n• **Admin**: Control centre (users, roles, categories, analytics)\n\nUse the menu to move around. In demo mode, the **View as** switcher in the top bar jumps between roles.'),
      [act('Go to my home', HOME[user.role])]);
  }

  if (has(text, KW.workflow) && !has(text, ['my request', 'my ticket', 'check'])) {
    return out(T("Every request moves through these steps:\n**Open**, **Assigned**, **In Progress**, then **Waiting for Candidate** while we need information from you, **Resolved** and **Closed**.\nIf a fix didn't work, a resolved or closed request can be **Reopened**. The system blocks skipped steps, so nothing gets lost."));
  }

  if (user.role === 'candidate') {
    if (has(text, KW.requests)) {
      const rows = db.prepare("SELECT id, reference, title, status FROM requests WHERE candidate_id = ? AND status NOT IN ('Closed') ORDER BY updated_at DESC LIMIT 5").all(user.id);
      if (!rows.length) return out(T("You don't have any open requests right now. Need help with something?"), [act('Create a request', '/new-request')]);
      const waiting = rows.filter((r) => r.status === 'Waiting for Candidate').length;
      let msg = `${T('You have {n} active requests:', { n: rows.length })}\n${rows.map((r) => `• **${r.reference}**: ${T(r.status)}`).join('\n')}`;
      if (waiting) msg += `\n\n${T('{n} of them are waiting for your reply.', { n: waiting })}`;
      return out(msg, rows.slice(0, 3).map((r) => ({ label: r.reference, href: `/request?id=${r.id}` })));
    }
    if (has(text, KW.journey)) {
      const rm = getRoadmap(db, user.id);
      if (rm.allComplete) return out(T("You've completed every milestone. Congratulations on your placement!"), [], { mood: 'celebrate' });
      const m = rm.milestones[rm.activeIndex];
      const left = m.requirements.filter((r) => !r.completed).map((r) => `• ${T(r.label)}`);
      let msg = `${T("You're at **{milestone}** (step {step} of 5) and {pct}% through the programme overall. Still to do here:", { milestone: T(m.title), step: rm.activeIndex + 1, pct: rm.percentComplete })}\n${left.join('\n')}`;
      if (rm.blockers.length) msg += `\n\n${T('You also have {n} open support cases that could affect your progress.', { n: rm.blockers.length })}`;
      return out(msg, [act('View my roadmap', '/dashboard#roadmap')]);
    }
    if (has(text, KW.team)) {
      const p = getProfile(db, user.id).candidate || {};
      const line = (label, v, empty) => `• ${T(label)}: **${v || T(empty)}**`;
      return out(`${T("Here's your programme team:")}\n${[
        line('Cohort', p.cohort, 'not set'), line('Stream', p.stream, 'not set'), line('Mentor', p.mentor, 'not assigned yet'),
        line('Tech Champ', p.techChamp, 'not assigned yet'), line('Supervisor', p.supervisor, 'not assigned yet'),
      ].join('\n')}\n\n${T('If something is wrong, the support team can update it for you.')}`, [act('Open my profile', '/profile')]);
    }
  }

  if (has(text, KW.birthday)) {
    const p = getProfile(db, user.id);
    const b = birthdays(db);
    const others = b.today.filter((x) => x.id !== user.id);
    let msg = p.birthday
      ? (p.birthday.isToday ? T("It's YOUR birthday today, {name}! Happy birthday from all of us!", { name: first }) : T('Your birthday is in **{n} days**.', { n: p.birthday.daysUntil }))
      : T("I don't have your date of birth yet. Add it on your profile.");
    if (others.length) msg += `\n\n${T('Celebrating today: {names}', { names: others.map((o) => `**${o.name}**`).join(', ') })}`;
    if (b.upcoming.length) msg += `\n${T('Coming up: {list}', { list: b.upcoming.slice(0, 3).map((o) => `${o.firstName} (${o.daysUntil}d)`).join(', ') })}`;
    return out(msg, [], { mood: p.birthday?.isToday ? 'celebrate' : undefined });
  }

  if (user.role !== 'candidate') {
    if (has(text, KW.queue)) {
      const q = db.prepare(`SELECT
          SUM(assigned_to IS NULL AND status IN ('Open','Reopened')) AS unassigned,
          SUM(assigned_to = ? AND status NOT IN ('Resolved','Closed')) AS mine,
          SUM(status NOT IN ('Resolved','Closed') AND due_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS overdue
        FROM requests`).get(user.id);
      return out(T('Queue snapshot:\n• **{u}** unassigned\n• **{m}** assigned to you\n• **{o}** overdue across the team', { u: q.unassigned || 0, m: q.mine || 0, o: q.overdue || 0 }),
        [act('Unassigned', '/requests?assigned=unassigned'), act('My cases', '/requests?assigned=me'), act('Overdue', '/requests?overdue=true')]);
    }
    if (has(text, KW.updateCandidate)) {
      return out(T('Open **Candidates** in the menu and pick a candidate. Then:\n• edit their cohort, stream, mentor, Tech Champ or supervisor in the profile panel\n• open any milestone on their roadmap to tick off requirements. Their dashboard updates live.'), [act('Open Candidates', '/candidates')]);
    }
    if (user.role === 'admin' && has(text, KW.adminUsers)) {
      return out(T('In the **Control centre**, press **Add user**. Fill in their details (staff need a position and employee ID) and the system creates a **temporary password**. Share it securely; they must change it when they first sign in. Use **Reset password**, **Deactivate** or **Remove** on any user row.'), [act('Open Control centre', '/admin')]);
    }
  }

  const cat = CATEGORY_HINTS.find(([words]) => has(text, words));
  if (cat || has(text, KW.help)) {
    if (user.role !== 'candidate') return out(T('Candidates raise requests from their dashboard. You can find any request in the **Ticket queue**.'), [act('Ticket queue', '/requests')]);
    const name = cat ? cat[1] : null;
    return out(name
      ? T("That sounds like a **{category}** issue. I've chosen the category for you. Just add the details and the support team will pick it up.", { category: T(name) })
      : T('No problem. Create a support request and the team will help you. Pick the category that fits best.'),
    [{ label: name ? T('New {category} request', { category: T(name) }) : T('Create a request'), href: `/new-request${name ? `?category=${encodeURIComponent(name)}` : ''}` }]);
  }

  if (has(text, KW.stipend)) return out(T('Stipend questions go to the **Administration** category. The team will confirm dates and sort out any payment issues.'), user.role === 'candidate' ? [act('Ask about my stipend', '/new-request?category=Administration')] : []);
  if (has(text, KW.profile)) return out(T('You can change your password and your avatar on your **Profile** page.'), [act('Open profile', '/profile')]);
  if (has(text, KW.sla)) return out(T('Target response times depend on priority: **Urgent 4 hours**, **High 24 hours**, **Medium 3 days**, **Low 5 days**. The team is alerted automatically when a case is overdue.'));

  return out(T("I'm not sure about that one yet. Try one of the suggestions below, or create a support request and a person will help you."),
    user.role === 'candidate' ? [act('Create a request', '/new-request')] : [], { mood: 'thinking' });
}

module.exports = { reply };
