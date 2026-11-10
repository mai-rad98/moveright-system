const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const M = require('./models');
const reports = require('./reports');
const payroll = require('./payroll');

// ---------- auth helpers ----------
// The role is read fresh on every request, so a changed or removed login takes effect straight away
const auth = async (req, res, next) => {
  let t;
  try { t = jwt.verify((req.get('authorization') || '').replace('Bearer ', ''), process.env.JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Please log in' }); }
  const u = t.id && await M.User.findById(t.id).select('name role').lean().catch(() => null);
  if (!u) return res.status(401).json({ error: 'Please log in' });
  req.user = { id: String(u._id), name: u.name, role: u.role };
  next();
};
const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Not allowed' });
const { ROLES, MANAGERS } = M;
const isManager = u => MANAGERS.includes(u.role);

// ---------- generic CRUD: list, create, update, delete ----------
function crud(Model, o = {}) {
  const r = express.Router();
  const read = o.read || ROLES, write = o.write || MANAGERS;
  const clean = (u, b) => { const d = o.clean ? o.clean(u, b) : { ...b }; delete d.createdBy; delete d.respondedBy; return d; };
  const stamp = Model.schema.path('createdBy');
  r.get('/', allow(...read), async (req, res) => {
    // ?q= searches o.search fields on any date; otherwise ?from=YYYY-MM-DD&to=YYYY-MM-DD filters on the module's date field
    const text = o.search && String(req.query.q || '').trim();
    const where = text ? { $or: o.search.map(f => ({ [f]: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })) }
      : o.dateField ? reports.within(o.dateField, reports.period(req.query)) : {};
    const q = Model.find(where).sort(o.sort || { createdAt: -1 }).limit(2000).lean();
    if (o.hide) q.select(o.hide);
    if (o.hideUser && !isManager(req.user)) q.select(o.hideUser);
    const rows = await q;
    res.json(o.decorate ? await o.decorate(rows) : rows);
  });
  // o.after(doc, req) runs once a record is saved (e.g. to create a login); if it fails a new record is removed again
  r.post('/', allow(...write), async (req, res) => {
    if (o.beforeCreate) await o.beforeCreate(req);
    let d = await Model.create({ ...clean(req.user, req.body), ...(stamp && { createdBy: req.user.id }) });
    if (o.after) try { d = (await o.after(d, req)) || d; } catch (e) { await Model.findByIdAndDelete(d._id); throw e; }
    res.status(201).json(o.hide ? await Model.findById(d._id).select(o.hide) : d);
  });
  r.put('/:id', allow(...write), async (req, res) => {
    if (o.beforeUpdate) await o.beforeUpdate(req.params.id, req);
    let d = await Model.findByIdAndUpdate(req.params.id, clean(req.user, req.body), { new: true, runValidators: true });
    if (d && o.after) d = (await o.after(d, req)) || d;
    if (!d) return res.sendStatus(404);
    res.json(o.hide ? await Model.findById(d._id).select(o.hide) : d);
  });
  r.delete('/:id', allow(...(o.del || MANAGERS)), async (req, res) => {
    if (o.beforeDelete) await o.beforeDelete(req.params.id, req);
    const d = await Model.findByIdAndDelete(req.params.id);
    if (d && o.onDelete) await o.onDelete(d);
    res.sendStatus(204);
  });
  return r;
}

const api = express.Router();
const fail = (status, message) => Object.assign(new Error(message), { status });

// ---------- files (PDF or photo, up to 5 MB) kept in MongoDB ----------
const upload = express.raw({ type: ['application/pdf', 'image/*'], limit: '5mb' });
const fileIn = req => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw fail(400, 'Choose a PDF or an image');
  return { data: req.body, type: req.get('content-type'), name: decodeURIComponent(req.get('x-file-name') || 'file'), size: req.body.length };
};
const fileOut = (res, d) => d ? res.type(d.type).set('Content-Disposition', `inline; filename="${encodeURIComponent(d.name)}"`).send(d.data) : res.sendStatus(404);

// ---------- login ----------
api.post('/auth/login', async (req, res) => {
  const u = await M.User.findOne({ email: String(req.body.email || '').toLowerCase().trim() });
  if (!u || !bcrypt.compareSync(req.body.password || '', u.password)) return res.status(401).json({ error: 'Wrong email or password' });
  const user = { id: u._id, name: u.name, role: u.role };
  res.json({ token: jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '7d' }), user });
});
api.use(auth);
api.get('/auth/me', (req, res) => res.json(req.user));

// ---------- self-service for employees: only ever their own records ----------
api.use('/me', (() => {
  const r = express.Router();
  r.use(async (req, res, next) => {
    req.employee = await M.Employee.findOne({ user: req.user.id }).lean();
    req.employee ? next() : res.status(404).json({ error: 'No employee record is linked to this login' });
  });
  r.get('/', (req, res) => res.json({ firstName: req.employee.firstName, surname: req.employee.surname, jobTitle: req.employee.jobTitle }));
  r.get('/documents', async (req, res) =>
    res.json(await M.EmployeeDocument.find({ employee: req.employee._id }).select('-data').sort({ createdAt: -1 }).lean()));
  r.get('/documents/:id', async (req, res) => fileOut(res, await M.EmployeeDocument.findOne({ _id: req.params.id, employee: req.employee._id })));
  // only payslips from finalised payroll runs
  const finalRuns = async () => (await M.PayrollRun.find({ status: 'final' }).select('_id').lean()).map(x => x._id);
  r.get('/payslips', async (req, res) =>
    res.json(await M.Payslip.find({ employee: req.employee._id, run: { $in: await finalRuns() } }).sort({ period: -1 }).lean()));
  r.get('/payslips/:id/pdf', async (req, res) => {
    const slip = await M.Payslip.findOne({ _id: req.params.id, employee: req.employee._id, run: { $in: await finalRuns() } }).lean();
    if (!slip) return res.sendStatus(404);
    payroll.payslipPdf(slip, await M.PayrollRun.findById(slip.run).lean(), res, req.query.download === '1');
  });
  return r;
})());

// ---------- employees (each one has a login with their role) ----------
// Only an admin may give, change or remove the admin role; nobody may change their own role.
async function checkRoleChange(req, current) {
  const role = req.body.role, admin = req.user.role === 'admin';
  if (!admin && (role === 'admin' || current?.role === 'admin')) throw fail(400, 'Only an admin can give the admin role or change an admin');
  if (current && String(current.user) === req.user.id && role && role !== current.role) throw fail(400, 'You cannot change your own role');
}
async function syncLogin(emp, req) {
  const password = String(req.body.password || '');
  const fields = { name: `${emp.firstName} ${emp.surname}`, email: emp.email, role: emp.role };
  if (password) fields.password = bcrypt.hashSync(password, 10);
  if (await M.User.exists({ email: emp.email, _id: { $ne: emp.user } })) throw fail(400, 'Another login already uses this email');
  if (emp.user && await M.User.findByIdAndUpdate(emp.user, fields)) return emp;
  if (!password) throw fail(400, 'Set a password: every employee needs a login');
  const u = await M.User.create(fields);
  return M.Employee.findByIdAndUpdate(emp._id, { user: u._id }, { new: true });
}
api.use('/employees', allow(...MANAGERS), (() => {
  const r = express.Router();
  // documents per employee
  r.get('/:id/documents', async (req, res) =>
    res.json(await M.EmployeeDocument.find({ employee: req.params.id }).select('-data').sort({ createdAt: -1 }).lean()));
  r.post('/:id/documents', upload, async (req, res) => {
    if (!(await M.Employee.exists({ _id: req.params.id }))) return res.sendStatus(404);
    const category = M.EmployeeDocument.schema.path('category').enumValues.includes(req.query.category) ? req.query.category : 'other';
    const d = await M.EmployeeDocument.create({ ...fileIn(req), employee: req.params.id, category });
    res.status(201).json({ _id: d._id, name: d.name, type: d.type, size: d.size, category: d.category, createdAt: d.createdAt });
  });
  r.get('/:id/documents/:doc', async (req, res) => fileOut(res, await M.EmployeeDocument.findOne({ _id: req.params.doc, employee: req.params.id })));
  r.delete('/:id/documents/:doc', async (req, res) => { await M.EmployeeDocument.deleteOne({ _id: req.params.doc, employee: req.params.id }); res.sendStatus(204); });
  r.use(crud(M.Employee, {
    read: MANAGERS, write: MANAGERS, sort: { surname: 1, firstName: 1 }, search: ['firstName', 'surname', 'email', 'jobTitle', 'role'],
    clean: (u, b) => {
      const d = { ...b };
      ['user', 'password', 'documents', 'login', 'access'].forEach(k => delete d[k]);
      if (d.deductions) d.deductions = d.deductions.filter(x => x.name).map(x => ({ name: x.name, amount: Number(x.amount) || 0 }));
      return d;
    },
    beforeCreate: async req => {
      await checkRoleChange(req, null);
      if (!req.body.password) throw fail(400, 'Set a password: every employee needs a login');
    },
    beforeUpdate: async (id, req) => checkRoleChange(req, await M.Employee.findById(id).lean()),
    after: syncLogin,
    decorate: async rows => {
      const n = await M.EmployeeDocument.aggregate([{ $match: { employee: { $in: rows.map(x => x._id) } } }, { $group: { _id: '$employee', n: { $sum: 1 } } }]);
      const by = Object.fromEntries(n.map(x => [String(x._id), x.n]));
      return rows.map(x => ({ ...x, documents: by[String(x._id)] || 0, login: !!x.user }));
    },
    beforeDelete: async (id, req) => {
      const e = await M.Employee.findById(id);
      if (e?.user && String(e.user) === req.user.id) throw fail(400, 'You cannot delete your own employee record');
      if (e?.role === 'admin' && req.user.role !== 'admin') throw fail(400, 'Only an admin can remove an admin');
    },
    onDelete: async e => { if (e.user) await M.User.findByIdAndDelete(e.user); await M.EmployeeDocument.deleteMany({ employee: e._id }); },
  }));
  return r;
})());

// ---------- payroll (admin) ----------
api.use('/payroll', allow(...MANAGERS), (() => {
  const r = express.Router();
  const draftOnly = async runId => {
    const run = await M.PayrollRun.findById(runId);
    if (!run) throw fail(404, 'Payroll not found');
    if (run.status !== 'draft') throw fail(400, 'This payroll is finalised and can no longer be changed');
    return run;
  };
  const amounts = a => (Array.isArray(a) ? a.filter(x => x.name).map(x => ({ name: x.name, amount: Number(x.amount) || 0 })) : undefined);

  r.put('/payslips/:id', async (req, res) => {
    const slip = await M.Payslip.findById(req.params.id);
    if (!slip) return res.sendStatus(404);
    await draftOnly(slip.run);
    const b = req.body;
    if (b.basic !== undefined) slip.basic = Number(b.basic) || 0;
    if (amounts(b.allowances)) slip.allowances = amounts(b.allowances);
    if (amounts(b.deductions)) slip.deductions = amounts(b.deductions);
    if (b.payeOverride !== undefined) slip.payeOverride = b.payeOverride === '' || b.payeOverride === null ? null : Number(b.payeOverride) || 0;
    payroll.recalc(slip);
    await slip.save();
    await payroll.updateTotals(slip.run);
    res.json(slip);
  });
  r.get('/payslips/:id/pdf', async (req, res) => {
    const slip = await M.Payslip.findById(req.params.id).lean();
    if (!slip) return res.sendStatus(404);
    payroll.payslipPdf(slip, await M.PayrollRun.findById(slip.run).lean(), res, req.query.download === '1');
  });

  r.get('/', async (req, res) => {
    await payroll.ensureDraft();                             // catches up on the 28th even if the server was asleep
    res.json({ current: payroll.thisPeriod(), runs: await M.PayrollRun.find().sort({ period: -1 }).lean() });
  });
  r.post('/run', async (req, res) => {                       // run payroll for a chosen month by hand
    const period = String(req.body.period || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw fail(400, 'Choose a month');
    if (await M.PayrollRun.exists({ period })) throw fail(409, 'Payroll for that month already exists');
    res.status(201).json(await payroll.draftRun(period));
  });
  r.get('/:id', async (req, res) => {
    const run = await M.PayrollRun.findById(req.params.id).lean();
    if (!run) return res.sendStatus(404);
    res.json({ run, payslips: await M.Payslip.find({ run: run._id }).sort({ name: 1 }).lean() });
  });
  r.post('/:id/rebuild', async (req, res) => {               // start the draft again from current employee details
    const run = await draftOnly(req.params.id);
    await M.Payslip.deleteMany({ run: run._id });
    res.json(await payroll.addPayslips(run));
  });
  r.post('/:id/finalise', async (req, res) => {
    const run = await draftOnly(req.params.id);
    if (!(await M.Payslip.exists({ run: run._id }))) throw fail(400, 'There are no payslips in this payroll');
    run.status = 'final'; run.finalisedAt = new Date(); run.finalisedBy = req.user.id;
    res.json(await run.save());
  });
  r.delete('/:id', async (req, res) => {
    const run = await draftOnly(req.params.id);
    await M.Payslip.deleteMany({ run: run._id });
    await run.deleteOne();
    res.sendStatus(204);
  });
  return r;
})());

api.use('/services', crud(M.Service, { sort: { name: 1 } }));                    // everyone reads (job form), managers edit
api.use('/locations', crud(M.Location, {
  sort: { name: 1 }, hideUser: '-partner -partnerPrice -markup',
  clean: (u, b) => {
    const d = { ...b };
    if (d.partner === '') d.partner = null;
    if (d.partnerPrice !== undefined) d.price = (Number(d.partnerPrice) || 0) + (Number(d.markup) || 0);
    return d;
  },
}));
api.use('/partners', crud(M.Partner, { read: MANAGERS, sort: { name: 1 } }));
api.use('/expenses', crud(M.Expense, {
  read: MANAGERS, sort: { date: -1 }, dateField: 'date',
  onDelete: d => d.receipt?.id && M.Receipt.findByIdAndDelete(d.receipt.id),
}));
api.use('/receipts', (() => {                                 // expense receipts
  const r = express.Router();
  r.use(allow(...MANAGERS));
  r.post('/', upload, async (req, res) => {
    const d = await M.Receipt.create(fileIn(req));
    res.status(201).json({ id: d._id, name: d.name, type: d.type });
  });
  r.get('/:id', async (req, res) => fileOut(res, await M.Receipt.findById(req.params.id)));
  return r;
})());
api.use('/jobs', crud(M.Job, {
  write: ROLES, sort: { date: -1 }, dateField: 'date', hideUser: '-partner -partnerCost', search: ['ref', 'phone', 'customer'],
  clean: (u, b) => {
    const d = { ...b };
    if (!isManager(u)) { delete d.partner; delete d.partnerCost; }
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
    write: ROLES, sort: { receivedAt: -1 }, dateField: 'receivedAt',
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
  const from = req.query.from ? new Date(req.query.from + 'T00:00:00+02:00')
    : req.query.from === '' ? new Date(0) : new Date(Date.UTC(g.getUTCFullYear(), g.getUTCMonth(), 1) - H);   // '' = All time
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
  if (isManager(req.user)) {
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
