const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const M = require('./models');
const reports = require('./reports');

// ---------- auth helpers ----------
const auth = (req, res, next) => {
  try { req.user = jwt.verify((req.get('authorization') || '').replace('Bearer ', ''), process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Please log in' }); }
};
const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Not allowed' });

// ---------- generic CRUD: list, create, update, delete ----------
function crud(Model, o = {}) {
  const r = express.Router();
  const read = o.read || ['admin', 'user'], write = o.write || ['admin'];
  const clean = (u, b) => { const d = o.clean ? o.clean(u, b) : { ...b }; delete d.createdBy; delete d.respondedBy; return d; };
  const stamp = Model.schema.path('createdBy');
  r.get('/', allow(...read), async (req, res) => {
    // ?q= searches o.search fields on any date; otherwise ?from=YYYY-MM-DD&to=YYYY-MM-DD filters on the module's date field
    const text = o.search && String(req.query.q || '').trim();
    const where = text ? { $or: o.search.map(f => ({ [f]: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })) }
      : o.dateField ? reports.within(o.dateField, reports.period(req.query)) : {};
    const q = Model.find(where).sort(o.sort || { createdAt: -1 }).limit(2000).lean();
    if (o.hide) q.select(o.hide);
    if (o.hideUser && req.user.role !== 'admin') q.select(o.hideUser);
    const rows = await q;
    res.json(o.decorate ? await o.decorate(rows) : rows);
  });
  r.post('/', allow(...write), async (req, res) => {
    const d = await Model.create({ ...clean(req.user, req.body), ...(stamp && { createdBy: req.user.id }) });
    res.status(201).json(o.hide ? await Model.findById(d._id).select(o.hide) : d);
  });
  r.put('/:id', allow(...write), async (req, res) => {
    const d = await Model.findByIdAndUpdate(req.params.id, clean(req.user, req.body), { new: true, runValidators: true });
    d ? res.json(d) : res.sendStatus(404);
  });
  r.delete('/:id', allow(...(o.del || ['admin'])), async (req, res) => {
    const d = await Model.findByIdAndDelete(req.params.id);
    if (d && o.onDelete) await o.onDelete(d);
    res.sendStatus(204);
  });
  return r;
}

const api = express.Router();

// ---------- login ----------
api.post('/auth/login', async (req, res) => {
  const u = await M.User.findOne({ email: String(req.body.email || '').toLowerCase().trim() });
  if (!u || !bcrypt.compareSync(req.body.password || '', u.password)) return res.status(401).json({ error: 'Wrong email or password' });
  const user = { id: u._id, name: u.name, role: u.role };
  res.json({ token: jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '7d' }), user });
});
api.use(auth);
api.get('/auth/me', (req, res) => res.json(req.user));

// ---------- modules ----------
api.use('/users', crud(M.User, {
  read: ['admin'], write: ['admin'], hide: '-password',
  clean: (u, b) => { const d = { ...b }; if (d.password) d.password = bcrypt.hashSync(d.password, 10); else delete d.password; return d; },
}));
api.use('/services', crud(M.Service, { sort: { name: 1 } }));                    // everyone reads, admin edits
api.use('/locations', crud(M.Location, {
  sort: { name: 1 }, hideUser: '-partner -partnerPrice -markup',
  clean: (u, b) => {
    const d = { ...b };
    if (d.partner === '') d.partner = null;
    if (d.partnerPrice !== undefined) d.price = (Number(d.partnerPrice) || 0) + (Number(d.markup) || 0);
    return d;
  },
}));
api.use('/partners', crud(M.Partner, { read: ['admin'], write: ['admin'], sort: { name: 1 } }));
api.use('/expenses', crud(M.Expense, {
  read: ['admin'], write: ['admin'], sort: { date: -1 }, dateField: 'date',
  onDelete: d => d.receipt?.id && M.Receipt.findByIdAndDelete(d.receipt.id),
}));
api.use('/receipts', (() => {                                 // expense receipts: PDF or photo, up to 5 MB
  const r = express.Router();
  r.use(allow('admin'));
  r.post('/', express.raw({ type: ['application/pdf', 'image/*'], limit: '5mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Choose a PDF or an image' });
    const d = await M.Receipt.create({ data: req.body, type: req.get('content-type'), name: decodeURIComponent(req.get('x-file-name') || 'receipt'), size: req.body.length });
    res.status(201).json({ id: d._id, name: d.name, type: d.type });
  });
  r.get('/:id', async (req, res) => {
    const d = await M.Receipt.findById(req.params.id);
    if (!d) return res.sendStatus(404);
    res.type(d.type).set('Content-Disposition', `inline; filename="${encodeURIComponent(d.name)}"`).send(d.data);
  });
  return r;
})());
api.use('/jobs', crud(M.Job, {
  write: ['admin', 'user'], sort: { date: -1 }, dateField: 'date', hideUser: '-partner -partnerCost', search: ['ref', 'phone', 'customer'],
  clean: (u, b) => {
    const d = { ...b };
    if (u.role !== 'admin') { delete d.partner; delete d.partnerCost; }
    if (d.partner === '') d.partner = null;
    if (d.services) d.services = d.services.filter(s => s.name).map(s => ({ ...s, service: s.service || null, price: Number(s.price) || 0, qty: Math.max(1, Number(s.qty) || 1) }));
    // total = route price + each service x quantity (older jobs without a route price keep their price)
    if (d.routePrice !== undefined) d.price = (Number(d.routePrice) || 0) + (d.services || []).reduce((s, x) => s + x.price * x.qty, 0);
    return d;
  },
}));
// ---------- inbox follow-ups ----------
// Answered enquiries that are not yet a job are due for a follow-up 2 days after they came in,
// then 2 days after each follow-up, until they become a job or are marked "not interested".
const FOLLOW_UP_DAYS = 2;
const gabDay = d => new Date(+new Date(d) + 2 * 3600e3).toISOString().slice(0, 10);   // date in Gaborone (UTC+2)
function followUp(x, hasJob) {
  if (hasJob) return { state: 'became a job' };
  if (!x.responded) return { state: 'awaiting reply' };
  const last = (x.followUps || []).reduce((a, f) => (!a || f.at > a.at ? f : a), null);
  if (last?.outcome === 'not interested') return { state: 'not interested' };
  const due = new Date(+new Date(last?.at || x.receivedAt) + FOLLOW_UP_DAYS * 86400e3);
  const [d, t] = [gabDay(due), gabDay(Date.now())];
  return { due, state: d < t ? 'overdue' : d === t ? 'due today' : 'upcoming' };
}
const withJobs = async rows => {                             // show which enquiries became jobs, and their follow-up
  const jobs = await M.Job.find({ ref: { $in: rows.map(x => x.ref).filter(Boolean) } }).select('ref status customer').lean();
  const byRef = Object.fromEntries(jobs.map(j => [j.ref, { status: j.status, customer: j.customer }]));
  return rows.map(x => ({ ...x, job: byRef[x.ref] || null, followUp: followUp(x, !!byRef[x.ref]) }));
};
const OUTCOMES = M.Interaction.schema.path('followUps').schema.path('outcome').enumValues;

api.use('/interactions', (() => {
  const r = express.Router();
  // Everything overdue or due today, from any date (the Inbox list itself is filtered by the period picker)
  r.get('/follow-ups', async (req, res) => {
    const rows = await withJobs(await M.Interaction.find({ responded: true }).lean());
    res.json(rows.filter(x => ['overdue', 'due today'].includes(x.followUp.state)).sort((a, b) => a.followUp.due - b.followUp.due));
  });
  r.post('/:id/follow-up', async (req, res) => {
    const at = req.body.at ? new Date(req.body.at) : new Date();
    if (!OUTCOMES.includes(req.body.outcome) || isNaN(at)) return res.status(400).json({ error: 'Choose an outcome and a valid date' });
    const d = await M.Interaction.findByIdAndUpdate(req.params.id,
      { $push: { followUps: { at, outcome: req.body.outcome, note: String(req.body.note || ''), by: req.user.id } } }, { new: true }).lean();
    d ? res.json((await withJobs([d]))[0]) : res.sendStatus(404);
  });
  r.post('/:id/respond', async (req, res) => {
    const d = await M.Interaction.findById(req.params.id);
    if (!d) return res.sendStatus(404);
    if (!d.responded) { d.responded = true; d.respondedAt = new Date(); d.respondedBy = req.user.id; await d.save(); }
    res.json(d);
  });
  r.use(crud(M.Interaction, {
    write: ['admin', 'user'], sort: { receivedAt: -1 }, dateField: 'receivedAt',
    // the ref is assigned and follow-ups are recorded through their own action, never through Edit
    clean: (u, b) => { const d = { ...b }; ['ref', 'job', 'followUp', 'followUps'].forEach(k => delete d[k]); return d; },
    decorate: withJobs,
  }));
  return r;
})());

// ---------- module reports ----------
api.use('/reports', reports.router);

// ---------- analytics ----------
api.get('/analytics', async (req, res) => {
  const H = 2 * 3600e3, DAY = 86400e3;                       // Gaborone is UTC+2, no daylight saving
  const g = new Date(Date.now() + H); g.setUTCHours(0, 0, 0, 0);
  const sod = new Date(g - H);                               // start of today, Gaborone time
  const from = req.query.from ? new Date(req.query.from + 'T00:00:00+02:00') : new Date(Date.UTC(g.getUTCFullYear(), g.getUTCMonth(), 1) - H);
  const to = req.query.to ? new Date(req.query.to + 'T23:59:59+02:00') : new Date();
  const grp = (match, key) => M.Interaction.aggregate([{ $match: match }, { $group: { _id: key, n: { $sum: 1 } } }]);
  const map = a => Object.fromEntries(a.map(x => [x._id, x.n]));

  const [byChannel, byCategory, cmtToday, cmtResponded, cmtPending, perDay, enquiries, jobStatus, jobsFromChat] = await Promise.all([
    grp({ kind: 'message', receivedAt: { $gte: sod } }, '$channel'),
    grp({ kind: 'message', receivedAt: { $gte: sod } }, '$category'),
    M.Interaction.countDocuments({ kind: 'comment', receivedAt: { $gte: sod } }),
    M.Interaction.countDocuments({ kind: 'comment', respondedAt: { $gte: sod } }),
    M.Interaction.countDocuments({ kind: 'comment', responded: false }),
    M.Interaction.aggregate([
      { $match: { kind: 'message', receivedAt: { $gte: new Date(sod - 13 * DAY) } } },
      { $group: { _id: { d: { $dateToString: { format: '%Y-%m-%d', date: '$receivedAt', timezone: 'Africa/Gaborone' } }, c: '$channel' }, n: { $sum: 1 } } },
    ]),
    M.Interaction.countDocuments({ kind: 'message', category: { $ne: 'other' }, receivedAt: { $gte: from, $lte: to } }),
    M.Job.aggregate([{ $match: { createdAt: { $gte: from, $lte: to } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    M.Job.countDocuments({ createdAt: { $gte: from, $lte: to }, source: { $in: ['facebook', 'whatsapp'] } }),
  ]);

  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(sod - i * DAY + H).toISOString().slice(0, 10);
    const n = c => perDay.find(x => x._id.d === d && x._id.c === c)?.n || 0;
    days.push({ date: d, facebook: n('facebook'), whatsapp: n('whatsapp') });
  }
  const cat = map(byCategory), ch = map(byChannel);
  const out = {
    range: { from, to },
    today: {
      messages: (ch.facebook || 0) + (ch.whatsapp || 0), facebook: ch.facebook || 0, whatsapp: ch.whatsapp || 0,
      priceEnquiries: cat.price || 0, locationEnquiries: cat.location || 0, bookingEnquiries: cat.booking || 0, otherMessages: cat.other || 0,
      commentsReceived: cmtToday, commentsResponded: cmtResponded, commentsPending: cmtPending,
    },
    perDay: days,
    jobs: { byStatus: map(jobStatus), enquiries, fromChat: jobsFromChat, conversionPercent: enquiries ? Math.round(jobsFromChat / enquiries * 100) : 0 },
  };
  if (req.user.role === 'admin') {
    const [fin] = await M.Job.aggregate([{ $match: { status: 'completed', date: { $gte: from, $lte: to } } },
      { $group: { _id: null, jobs: { $sum: 1 }, revenue: { $sum: '$price' }, partnerCost: { $sum: '$partnerCost' } } }]);
    const [exp] = await M.Expense.aggregate([{ $match: { date: { $gte: from, $lte: to } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
    const revenue = fin?.revenue || 0, partnerCost = fin?.partnerCost || 0, expenses = exp?.total || 0;
    out.finance = { completedJobs: fin?.jobs || 0, revenue, partnerCost, markup: revenue - partnerCost, expenses, netProfit: revenue - partnerCost - expenses };
  }
  res.json(out);
});

// ---------- Facebook + WhatsApp webhooks (Meta) ----------
const hooks = express.Router();
const PRICE = /\b(price|prices|cost|costs|how much|quote|rate|rates|charge|charges|pula|bwp|p\d+)\b/i;
const BOOK = /\b(book|booking|available|availability|tomorrow|today|saturday|sunday|next week)\b/i;
const LOC = /\b(where|location|area|areas|do you (go|move|deliver)|serve|distance)\b/i;
const categorize = (text = '', locs = []) =>
  PRICE.test(text) ? 'price'
  : (LOC.test(text) || locs.some(l => text.toLowerCase().includes(l.toLowerCase()))) ? 'location'
  : BOOK.test(text) ? 'booking' : 'other';

const signedOk = req => {
  if (!process.env.META_APP_SECRET) return true;
  const got = req.get('x-hub-signature-256') || '';
  const want = 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET).update(req.rawBody || '').digest('hex');
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
};

hooks.get('/meta', (req, res) =>
  req.query['hub.verify_token'] === process.env.META_VERIFY_TOKEN ? res.send(req.query['hub.challenge']) : res.sendStatus(403));

hooks.post('/meta', async (req, res) => {
  if (!signedOk(req)) return res.sendStatus(401);
  res.sendStatus(200);                                       // reply to Meta straight away
  try {
    const locs = (await M.Location.find().select('name')).map(l => l.name);
    const add = d => M.Interaction.create({ ...d, category: d.kind === 'message' ? categorize(d.text, locs) : 'other' });
    const now = { responded: true, respondedAt: new Date() };
    for (const e of req.body.entry || []) {
      if (req.body.object === 'whatsapp_business_account') {
        for (const c of e.changes || []) {
          const names = Object.fromEntries((c.value?.contacts || []).map(x => [x.wa_id, x.profile?.name]));
          for (const m of c.value?.messages || [])
            await add({ channel: 'whatsapp', kind: 'message', from: names[m.from] || m.from, fromId: m.from, externalId: m.id, text: m.text?.body || `[${m.type}]` });
        }
      } else if (req.body.object === 'page') {
        for (const ev of e.messaging || []) {
          if (ev.message?.is_echo)                           // we replied: mark that person's messages as responded
            await M.Interaction.updateMany({ channel: 'facebook', kind: 'message', fromId: ev.recipient?.id, responded: false }, now);
          else if (ev.message)
            await add({ channel: 'facebook', kind: 'message', from: ev.sender?.id, fromId: ev.sender?.id, externalId: ev.message.mid, text: ev.message.text || '[attachment]' });
        }
        for (const c of e.changes || []) {
          const v = c.value || {};
          if (c.field !== 'feed' || v.item !== 'comment' || v.verb !== 'add') continue;
          if (v.from?.id && v.from.id === process.env.FB_PAGE_ID)   // our own reply: mark the comment we replied to
            await M.Interaction.updateOne({ externalId: v.parent_id }, now);
          else await add({ channel: 'facebook', kind: 'comment', from: v.from?.name, fromId: v.from?.id, externalId: v.comment_id, text: v.message });
        }
      }
    }
  } catch (err) { console.error('Webhook error', err.message); }
});

module.exports = { api, hooks };
