/**
 * 2M 5L Island Excursion: personalised checklist reminders + progress alerts (Google Apps Script)
 * Runs from the Gmail account that owns the script (aniketjha646@gmail.com).
 *
 * SAFE BY DEFAULT: TEST_MODE = true sends every traveller email ONLY to TEST_EMAIL.
 * Progress alerts always go to you (OWNER_EMAIL). Set TEST_MODE = false when ready to email the group.
 *
 * Setup: script.google.com > New project > paste this file > Project Settings: time zone Asia/Kolkata
 * > run previewAll() (check your inbox) > run setup() once > run sendWelcomeNow() for today's welcome.
 */
const CONFIG = {
  TEST_MODE: true,
  TEST_EMAIL: 'aniketjha646@gmail.com',
  OWNER_EMAIL: 'aniketjha646@gmail.com',
  SITE_URL: 'https://bugbear646.github.io/Island-Excursion-December-2026/',
  IMMIGRATION_URL: 'https://bugbear646.github.io/Island-Excursion-December-2026/immigration.html',
  FIREBASE: 'https://trip-2m5l-2026-default-rtdb.firebaseio.com',
  FROM_NAME: 'Aniket · 2M 5L Island Excursion',
  FLIGHT: 'Sat 12 Dec, 06:20 IST',
  BOARDING_URL: 'https://www.goindigo.in/boarding-pass.html',
  PNR: 'MD5ZWG',
  TRIP_DATE: '2026-12-12',
  WEB_TOKEN: 'dae2181b4bc61ad31dc5d841df258b62'      // secret for the tracker's Send-email button, keep private
};

// Passport numbers are NOT stored here, only the same SHA-256 key the checklist saves progress under.
const TRAVELLERS = [
  {first:'Aniket', name:'Aniket Kumar Jha', email:'aniketjha646@gmail.com', hash:'92101495e9addcaed6669202d2a703a9282392ab2cdd92b911c3fc6ae2f1215b'},
  {first:'Anshul', name:'Anshul Sharma', email:'anshul.6273@gmail.com', hash:'ae16a717e95b0baff22ffdd25040e609dfa1798baf82620522305b559b67a595'},
  {first:'Arjav', name:'Arjav Rastogi', email:'rastogiarjav2001@gmail.com', hash:'546b652768b8028892b93582f5073c2ee6892cea1cce5208f927cb313c74b136'},
  {first:'Sidhartha', name:'Sidhartha Das', email:'dassid182@gmail.com', hash:'cb8ad60d70b8bde6fcc14946a5c604661d72c85dbfc2724c47103d87ee532e5b'},
  {first:'Swarnava', name:'Swarnava Bag', email:'swarnavabag@gmail.com', hash:'532801c5b4d1a2fc6f35e960352222c8a1e896ebd438825266d40cc292899377'},
  {first:'Udaya', name:'Udaya Mishra', email:'udayaamishra@gmail.com', hash:'ab89091cbd908d71d95ee817e2e400e75f338d488c6bcc7e4a45fa467f948d84'},
  {first:'Umang', name:'Umang Pandey', email:'umangpandey07@gmail.com', hash:'2252a5249e95308cbd175e00cf10e840f4fd8be59f81b1d78df291f4d56751cb'}
];

// critical = shown first and called out in the later reminders
const ITEMS = [
  {k:'fx',   label:'Buy THB Forex (10,000 THB each)', critical:true},
  {k:'usd',  label:'Buy $ Reserve ($300 each, in $50 or $100 notes)', critical:true},
  {k:'funds',label:'Proof Of Funds (20,000 THB or equivalent in cash)', critical:true},
  {k:'tdac', label:'TDAC Submitted (Thailand Digital Arrival Card)', critical:true},
  {k:'pp',   label:'Original Passport'},
  {k:'pf',   label:'Printed Flights'},
  {k:'ps',   label:'Printed Stay Vouchers'},
  {k:'pi',   label:'Printed Insurance Policy'},
  {k:'pit',  label:'Printed Itinerary'},
  {k:'sim',  label:'Sort 8 Days Of Data'}
];

// ---------- schedule (IST) ----------
// who: all | notDone (any item not Done) | done (every item Done)
// 5-10 Dec: people with an open item get 11:00 AND 17:00. People who are fully done get nothing
// until the 10 Dec TDAC check and the 11 Dec happy-journey mail.
const SCHEDULE = [];
const add = (date, hour, kind, who) => SCHEDULE.push({date, hour, kind, who});
add('2026-11-10', 17, 'welcome',  'all');   // Tuesday 10 Nov, 5 PM
add('2026-11-28', 17, 'twoWeeks', 'notDone');
add('2026-12-05', 11, 'oneWeek',  'notDone');
add('2026-12-05', 17, 'countdown','notDone');
['2026-12-06','2026-12-07','2026-12-08','2026-12-09'].forEach(d => { add(d, 11, 'countdown','notDone'); add(d, 17, 'countdown','notDone'); });
add('2026-12-10', 11, 'deadline', 'notDone');
add('2026-12-10', 17, 'deadline', 'notDone');
add('2026-12-10', 17, 'tdacCheck','done');
add('2026-12-11', 17, 'dayZero',  'all');

// ---------- status ----------
function getRaw(t) {
  try {
    const r = UrlFetchApp.fetch(CONFIG.FIREBASE + '/imm/' + t.hash + '.json', {muteHttpExceptions:true});
    return JSON.parse(r.getContentText()) || {};
  } catch (e) { return {}; }
}
function statusOf(raw) {
  const state = k => (raw[k] && raw[k][0]) | 0;                 // 0 To Do, 1 In Progress, 2 Done
  const items = ITEMS.map(i => Object.assign({}, i, {state: state(i.k)}));
  const pending = items.filter(i => i.state !== 2).sort((a,b) => (b.critical?1:0) - (a.critical?1:0));
  return {items, pending, total: items.length, done: items.length - pending.length,
          started: items.some(i => i.state > 0), complete: pending.length === 0};
}
const getStatus = t => statusOf(getRaw(t));

// ---------- HTML building blocks (table based, email-client safe) ----------
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
const F = "font-family:'Segoe UI',Helvetica,Arial,sans-serif;";
const PILL = {
  0: ['To do',       '#eef1f2', '#5c7479'],
  1: ['In progress', '#fff1d6', '#9a6200'],
  2: ['Done',        '#dff5e8', '#1c7a4b']
};
const pill = s => '<span style="display:inline-block;background:' + PILL[s][1] + ';color:' + PILL[s][2] + ';border-radius:99px;padding:2px 10px;font-size:12px;font-weight:700;' + F + '">' + PILL[s][0] + '</span>';

function progressBlock(st) {
  const pct = Math.round(100 * st.done / st.total);
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 6px"><tr>' +
    '<td style="' + F + 'font-size:14px;color:#10343c"><b>' + st.done + ' of ' + st.total + ' items done</b></td>' +
    '<td align="right" style="' + F + 'font-size:14px;color:#5c7479">' + pct + '%</td></tr></table>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:99px;overflow:hidden;background:#e3ecec"><tr>' +
    (pct ? '<td width="' + pct + '%" height="10" style="background:#2bb3c0;font-size:0;line-height:0">&nbsp;</td>' : '') +
    '<td height="10" style="font-size:0;line-height:0">&nbsp;</td></tr></table>';
}
function itemsTable(list, title) {
  if (!list.length) return '';
  return '<p style="' + F + 'margin:22px 0 8px;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5c7479">' + title + '</p>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #10343c1f;border-radius:14px;overflow:hidden">' +
    list.map((i, n) => '<tr style="background:' + (n % 2 ? '#fffaf1' : '#ffffff') + '"><td style="padding:11px 14px;' + F + 'font-size:15px;color:#10343c;border-top:' + (n ? '1px solid #10343c14' : '0') + '">' +
      (i.critical ? '<span style="color:#d9482b;font-weight:700">&#9679;</span> <b>' + esc(i.label) + '</b>' : esc(i.label)) + '</td>' +
      '<td align="right" style="padding:11px 14px;white-space:nowrap;border-top:' + (n ? '1px solid #10343c14' : '0') + '">' + pill(i.state) + '</td></tr>').join('') +
    '</table>' + (list.some(i => i.critical) ? '<p style="' + F + 'margin:8px 2px 0;font-size:12px;color:#5c7479"><span style="color:#d9482b">&#9679;</span> = critical, needs time to arrange</p>' : '');
}
const para = s => '<p style="' + F + 'margin:14px 0;font-size:16px;line-height:1.6;color:#10343c">' + s + '</p>';
const button = (label, url) => '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 8px"><tr><td style="background:#0b3b45;border-radius:99px"><a href="' + url + '" style="display:inline-block;padding:14px 28px;' + F + 'font-size:16px;font-weight:700;color:#ffffff;text-decoration:none">' + label + '</a></td></tr></table>';

function shell(preheader, badge, headline, inner) {
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f6f0e4">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' + esc(preheader) + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f0e4"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fffaf1;border-radius:24px;overflow:hidden;border:1px solid #10343c1f">' +
    '<tr><td style="background:#0b3b45;padding:28px 30px">' +
      '<div style="' + F + 'font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7fd0ee">2M 5L Island Excursion · Phuket &amp; Ao Nang</div>' +
      '<div style="' + F + 'font-size:26px;line-height:1.25;color:#ffffff;font-weight:700;margin-top:8px">' + headline + '</div>' +
      '<div style="margin-top:14px"><span style="display:inline-block;background:#ff6f4e;color:#ffffff;border-radius:99px;padding:4px 14px;' + F + 'font-size:13px;font-weight:700">' + badge + '</span></div></td></tr>' +
    '<tr><td style="padding:8px 30px 28px">' + inner +
      '<p style="' + F + 'margin:22px 0 0;font-size:13px;line-height:1.6;color:#5c7479">How it works: open the Immigration page, enter your passport number, and set each row to In progress or Done. It saves automatically.</p>' +
      '<p style="' + F + 'margin:16px 0 0;font-size:16px;color:#10343c">Thanks,<br><b>Aniket</b></p></td></tr>' +
    '</table></td></tr></table></body></html>';
}

const flightCard = () => '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 6px;background:#e3f3f3;border-radius:16px"><tr><td style="padding:16px 18px;' + F + 'color:#10343c">' +
  '<div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#5c7479">Your flight</div>' +
  '<div style="font-size:15px;margin-top:6px">IndiGo <b>6E 1217</b> · Bengaluru T2 → Phuket</div>' +
  '<div style="font-size:15px;margin-top:2px">Departs <b>Sat 12 Dec, 06:20 IST</b> · report at the airport by <b>02:30 AM</b> (early hours of Sat 12 Dec)</div>' +
  '<div style="margin-top:10px;font-size:13px;color:#5c7479">PNR (same for all 7 of us)</div>' +
  '<div style="font:700 26px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.14em;color:#0b3b45">' + CONFIG.PNR + '</div></td></tr></table>';
const boardingAsk = () => para('<b>Please generate your boarding pass tonight.</b> Open the IndiGo boarding pass page, enter the PNR above with your name, complete web check-in, and save the boarding pass on your phone (download the PDF too, in case the network is slow at the airport).') + button('Generate my boarding pass', CONFIG.BOARDING_URL);

// ---------- templates: (traveller, status, ctx{days}) -> {subject, html} ----------
const dayWord = n => n === 1 ? '1 day' : n + ' days';
const firstCritical = st => (st.pending.find(i => i.critical) || st.pending[0] || {label:'your checklist'}).label.replace(/ \(.*/, '');
const CHK = CONFIG.IMMIGRATION_URL;

const TEMPLATES = {
  welcome: (t, st, c) => ({
    subject: t.first + ', your Thailand checklist is ready (' + dayWord(c.days) + ' to go)',
    html: shell('Our trip is about a month away. Here is the one site you need to focus on.', dayWord(c.days) + ' to takeoff', 'Hello ' + esc(t.first) + ' 👋',
      para('I know you are quite busy, but this is the checklist website you need to focus on. Our trip is due in <b>about a month</b> (' + CONFIG.FLIGHT + '), and a few things take real time to arrange.') +
      para('The site has the whole plan: map, day by day, bookings, costs and forex. Your private <b>Immigration</b> page holds your documents and a personal checklist of everything to sort before we fly: forex and a $ reserve, proof of funds, printouts, TDAC and data.') +
      (st.started ? para('You have already made a start. Nice. Keep going.') : para('<b>You have not started on any of the items yet.</b> Please open it, work through each row, and mark every item <b>Done</b> once you have fulfilled it.')) +
      progressBlock(st) + itemsTable(st.items, 'Your checklist') + button('Open my checklist', CHK) +
      para('Nothing to message me afterwards. I can see the progress, so I will only nudge those who still have gaps.'))
  }),
  twoWeeks: (t, st, c) => ({
    subject: t.first + ', 14 days to go. I hope the salary is credited 😄',
    html: shell('Two weeks to takeoff. Time to start the forex exchange.', dayWord(c.days) + ' to takeoff', 'Hope the salary is credited, ' + esc(t.first) + ' 😄',
      para('We fly in <b>14 days</b> (' + CONFIG.FLIGHT + '), so I hope the salary has landed. Please <b>start the foreign currency exchange</b> now: <b>10,000 THB</b> and a <b>$300 reserve</b> each (in $50 or $100 notes). Exchanges run short on notes closer to travel, so sooner is better.') +
      para('The other critical items (proof of funds, TDAC) cannot be done at the last minute either. Here is where you stand:') +
      progressBlock(st) + itemsTable(st.pending, 'Still open') + button('Update my checklist', CHK) +
      para('Please sort these out and mark each one <b>Done</b> in the checklist.'))
  }),
  oneWeek: (t, st, c) => ({
    subject: '⚠️ ' + t.first + ', 1 week to go: critical items still open',
    html: shell('One week left. The critical items need you now.', dayWord(c.days) + ' to takeoff', 'One week left, ' + esc(t.first),
      para('<b>This is the critical stretch.</b> Forex exchanges get crowded and low on notes as travel gets close, proof of funds has to be in cash in hand, and TDAC must be submitted before we land. Starting today, I will remind you <b>twice a day</b> until your checklist is complete.') +
      progressBlock(st) + itemsTable(st.pending, 'Still open') + button('Update my checklist', CHK) +
      para('Please do these and mark each one <b>Done</b>.'))
  }),
  countdown: (t, st, c) => {
    const crit = st.pending.filter(i => i.critical);
    return {
      subject: t.first + ', ' + dayWord(c.days) + ' to travel: you still have not done ' + firstCritical(st) + (st.pending.length > 1 ? ' (+' + (st.pending.length - 1) + ' more)' : ''),
      html: shell(dayWord(c.days) + ' to travel and your checklist still has open items.', dayWord(c.days) + ' to takeoff', dayWord(c.days) + ' to travel, ' + esc(t.first),
        para('Only <b>' + dayWord(c.days) + '</b> left for the trip, and you still have not done this part:') +
        itemsTable(st.pending, 'Open items') + progressBlock(st) +
        para('Please do it and <b>mark the item Done in the checklist</b>.' + (crit.length ? ' The red ones cannot wait.' : '')) + button('Mark items done', CHK))
    };
  },
  deadline: (t, st, c) => ({
    subject: '⏰ ' + t.first + ', deadline today: finish your checklist & double-check TDAC with Aniket',
    html: shell('Today is the deadline for everything on the checklist.', dayWord(c.days) + ' to takeoff', 'Deadline day, ' + esc(t.first),
      para('<b>Today is the deadline to finish everything.</b>') +
      para('<b>TDAC (Thailand Digital Arrival Card):</b> please <b>double-check your TDAC with me (Aniket)</b> today, and mark it <b>Done</b> in the checklist only <b>once I confirm</b> it. It has to be submitted before we land in Phuket, and immigration may ask for it.') +
      progressBlock(st) + itemsTable(st.pending, 'Still open') + button('Finish my checklist', CHK) +
      para('If something is blocking you, tell the group today so we can fix it together.'))
  }),
  tdacCheck: (t, st, c) => ({
    subject: t.first + ', all items done 👏 one last check: TDAC',
    html: shell('Your checklist is complete. One last look at TDAC.', dayWord(c.days) + ' to takeoff', 'Nicely done, ' + esc(t.first) + ' 👏',
      para('Every item on your checklist is <b>Done</b>. Thank you for taking it seriously.') +
      para('One last check: please <b>double-check your TDAC (Thailand Digital Arrival Card) with me (Aniket)</b>. Keep the confirmation handy on your phone, and if I have not confirmed yours yet, set it back to In progress until I do. Everyone gets this reminder today.') +
      progressBlock(st) + button('Open my checklist', CHK))
  }),
  dayZero: (t, st, c) => st.complete ? ({
    subject: '✈️ Happy journey, ' + t.first + '!',
    html: shell('Everything is done. See you at the airport.', 'Tomorrow we fly', 'Happy journey, ' + esc(t.first) + '! ✈️',
      para('Every item on your checklist is done. 🎉 Nothing left but one last job tonight, then pack and enjoy.') +
      flightCard() + boardingAsk() +
      para('Be at <b>Bengaluru T2 by 02:30 AM</b> (the early hours of Sat 12 Dec). Keep your passport, tickets and chargers in the cabin bag.') +
      para('<b>Have a safe and happy trip!</b>') + button('Open the trip plan', CONFIG.SITE_URL))
  }) : ({
    subject: '🚨 ' + t.first + ', last call: ' + st.pending.length + ' item' + (st.pending.length > 1 ? 's' : '') + ' still open before tomorrow’s flight',
    html: shell('We fly tomorrow and some items are still not done.', 'Tomorrow we fly', 'Last call, ' + esc(t.first),
      para('We fly <b>tomorrow</b> (' + CONFIG.FLIGHT + '). These items are still not marked Done:') +
      itemsTable(st.pending, 'Still open') + progressBlock(st) + flightCard() +
      para('Please <b>do this tonight and mark the checklist done</b>, for a safe and happy trip. If you are stuck or cannot get to something, <b>reach out or call it out in the group</b> right now so we can sort it together.') + button('Open my checklist', CHK) + boardingAsk())
  })
};

// ---------- sending ----------
const audience = (who, st) => who === 'all' || (who === 'notDone' && !st.complete) || (who === 'done' && st.complete);
const todayIST = () => Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
const daysTo = d => Math.round((Date.parse(CONFIG.TRIP_DATE + 'T00:00:00Z') - Date.parse(d + 'T00:00:00Z')) / 864e5);
const plain = h => h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function send(t, kind, st, date, manual) {
  const m = TEMPLATES[kind](t, st, {days: daysTo(date)});
  MailApp.sendEmail({
    to: CONFIG.TEST_MODE ? CONFIG.TEST_EMAIL : t.email,
    subject: (CONFIG.TEST_MODE && !manual ? '[TEST for ' + t.name + '] ' : '') + m.subject,
    htmlBody: m.html, body: plain(m.html), name: CONFIG.FROM_NAME, replyTo: CONFIG.OWNER_EMAIL
  });
}

// hour = 11 or 17 (null = every slot of that date, for manual runs)
function runFor(date, hour) {
  const props = PropertiesService.getScriptProperties();
  SCHEDULE.filter(s => s.date === date && (hour == null || s.hour === hour)).forEach(s => {
    TRAVELLERS.forEach(t => {
      const key = [s.date, s.hour, s.kind, t.hash].join('|');
      if (!CONFIG.TEST_MODE && props.getProperty(key)) return;      // never send the same mail twice
      const st = getStatus(t);
      if (!audience(s.who, st)) return;
      send(t, s.kind, st, s.date);
      if (!CONFIG.TEST_MODE) props.setProperty(key, '1');
    });
  });
}
const run11 = () => runFor(todayIST(), 11);
const run17 = () => runFor(todayIST(), 17);
function sendWelcomeNow() { runFor('2026-11-10', null); }   // manual send of the welcome (it is also scheduled for Tue 10 Nov 5 PM)

// ---------- progress alerts to you ----------
function checkProgress() {
  const props = PropertiesService.getScriptProperties();
  const prev = JSON.parse(props.getProperty('snap') || 'null'), snap = {}, lines = [], rows = [];
  const label = k => (ITEMS.find(i => i.k === k) || {label: k}).label.replace(/ \(.*/, '');
  TRAVELLERS.forEach(t => {
    const raw = getRaw(t), st = statusOf(raw);
    snap[t.hash] = Object.fromEntries(ITEMS.map(i => [i.k, (raw[i.k] && raw[i.k][0]) | 0]));
    rows.push([t.first, st.done, st.total]);
    if (prev) ITEMS.forEach(i => {
      const a = (prev[t.hash] || {})[i.k] | 0, b = snap[t.hash][i.k];
      if (a !== b) lines.push('<b>' + esc(t.first) + '</b> set <i>' + esc(label(i.k)) + '</i>: ' + PILL[a][0] + ' → <b>' + PILL[b][0] + '</b>');
    });
  });
  props.setProperty('snap', JSON.stringify(snap));
  if (!prev || !lines.length) return;                               // first run only records a baseline
  const table = rows.map(r => '<tr><td style="padding:4px 14px 4px 0">' + esc(r[0]) + '</td><td><b>' + r[1] + '/' + r[2] + '</b></td></tr>').join('');
  MailApp.sendEmail({to: CONFIG.OWNER_EMAIL, name: CONFIG.FROM_NAME,
    subject: 'Checklist update: ' + lines.length + ' change' + (lines.length > 1 ? 's' : ''),
    htmlBody: '<div style="' + F + 'font-size:15px;color:#10343c"><p><b>What changed</b></p><p>' + lines.join('<br>') + '</p><p><b>Where everyone is now</b></p><table>' + table + '</table></div>'});
}

// ---------- manual send from the tracker (deploy as Web app) ----------
// Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone. Copy the /exec URL.
function doGet(e) {
  const p = (e && e.parameter) || {}, out = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  if (p.token !== CONFIG.WEB_TOKEN) return out({ok:false, msg:'unauthorized'});
  const props = PropertiesService.getScriptProperties(), date = todayIST(), key = h => 'manual|' + date + '|' + h;
  if (p.action === 'status') return out({ok:true, test:CONFIG.TEST_MODE, sent:TRAVELLERS.filter(t => props.getProperty(key(t.hash))).map(t => t.hash)});
  if (p.action === 'send') {
    const lock = LockService.getScriptLock(); lock.waitLock(10000);
    try {
      const t = TRAVELLERS.find(x => x.hash === p.hash);
      if (!t) return out({ok:false, msg:'Unknown traveller'});
      if (props.getProperty(key(t.hash))) return out({ok:false, already:true, msg:'Already emailed today'});   // one manual email per person per day
      const st = getStatus(t);
      if (st.complete) return out({ok:false, msg:'All items are done'});
      send(t, 'countdown', st, date, true);   // manual: no [TEST] prefix
      if (!CONFIG.TEST_MODE) props.setProperty(key(t.hash), '1');
      return out({ok:true, test:CONFIG.TEST_MODE});
    } finally { lock.releaseLock(); }
  }
  return out({ok:false, msg:'bad request'});
}

// ---------- test + setup ----------
// Sends every template, using YOUR live status, only to TEST_EMAIL
function previewAll() {
  const t = TRAVELLERS[0], st = getStatus(t), prev = CONFIG.TEST_MODE;
  CONFIG.TEST_MODE = true;
  const pendingDemo = st.complete ? statusOf({}) : st;
  const dates = {welcome:'2026-11-10', twoWeeks:'2026-11-28', oneWeek:'2026-12-05', countdown:'2026-12-07', deadline:'2026-12-10', tdacCheck:'2026-12-10', dayZero:'2026-12-11'};
  const allDone = statusOf(Object.fromEntries(ITEMS.map(i => [i.k, [2, 1]])));
  Object.keys(TEMPLATES).forEach(k => send(t, k, k === 'tdacCheck' ? allDone : pendingDemo, dates[k]));
  send(t, 'dayZero', allDone, dates.dayZero);                        // the "happy journey" variant
  CONFIG.TEST_MODE = prev;
}

// Run once: 11:00 + 17:00 mail slots and a 30-minute progress watcher
function setup() {
  ScriptApp.getProjectTriggers().forEach(tr => ScriptApp.deleteTrigger(tr));
  ScriptApp.newTrigger('run11').timeBased().everyDays(1).atHour(11).nearMinute(0).create();
  ScriptApp.newTrigger('run17').timeBased().everyDays(1).atHour(17).nearMinute(0).create();
  ScriptApp.newTrigger('checkProgress').timeBased().everyMinutes(30).create();
}
