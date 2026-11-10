const express = require('express');
const M = require('./models');

// ---------- period helpers (Gaborone is UTC+2, no daylight saving) ----------
const H = 2 * 3600e3, DAY = 86400e3;
const startOf = s => new Date(s + 'T00:00:00+02:00');
const local = d => new Date(+new Date(d) + H).toISOString();          // ISO string in Gaborone time
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// ?from=YYYY-MM-DD&to=YYYY-MM-DD -> dates, plus the equal-length period just before it (for comparisons)
// Whole calendar months (e.g. 1-31 Oct) compare with the same number of months before (1-30 Sep).
function period(q = {}) {
  const from = isDay(q.from) ? startOf(q.from) : null;
  const to = isDay(q.to) ? new Date(+startOf(q.to) + DAY - 1) : null;
  if (!from || !to) return { from, to, prev: null };
  const [fy, fm, fd] = q.from.split('-').map(Number), [ty, tm, td] = q.to.split('-').map(Number);
  const months = (ty * 12 + tm) - (fy * 12 + fm) + 1;
  if (fd === 1 && td === new Date(Date.UTC(ty, tm, 0)).getUTCDate() && months > 0) {
    const start = new Date(Date.UTC(fy, fm - 1 - months, 1)).toISOString().slice(0, 10);
    return { from, to, prev: { from: startOf(start), to: new Date(from - 1) } };
  }
  return { from, to, prev: { from: new Date(2 * from - to - 1), to: new Date(from - 1) } };
}
const within = (field, p) => (p.from || p.to ? { [field]: { ...(p.from && { $gte: p.from }), ...(p.to && { $lte: p.to }) } } : {});

// ---------- number helpers ----------
const sum = (a, f) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const rate = (a, b) => (b ? (a / b) * 100 : 0);
const groupBy = (a, f) => a.reduce((m, x) => ((m[f(x) ?? 'none'] ||= []).push(x), m), {});
const cap = s => String(s || 'none').charAt(0).toUpperCase() + String(s || 'none').slice(1);
const count = f => a => a.filter(f).length;

// A headline figure; `better` says which direction is good when compared with the previous period
const kpi = (label, f, fmt = 'num', better = 'up', hint) => ({ label, f, fmt, better, hint });

// Stacked bar chart with one bar per day (or per month for long periods), one segment per series
function chart(title, p, docs, dateOf, series, fmt = 'num') {
  docs = docs.filter(d => dateOf(d));
  const first = p.from || (docs.length ? new Date(Math.min(...docs.map(d => +new Date(dateOf(d))))) : null);
  const last = p.to || new Date();
  const unit = first && last - first > 62 * DAY ? 'month' : 'day';
  const key = d => local(d).slice(0, unit === 'day' ? 10 : 7);
  const keys = [];
  for (let k = first && key(first), end = key(last); k && k <= end;) {
    keys.push(k);
    if (unit === 'day') k = new Date(Date.parse(k) + DAY).toISOString().slice(0, 10);
    else { const [y, m] = k.split('-').map(Number); k = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; }
  }
  const rows = keys.map(k => ({ label: k, ...Object.fromEntries(series.map(s => [s.key, 0])) }));
  const at = Object.fromEntries(rows.map(r => [r.label, r]));
  for (const d of docs) { const r = at[key(dateOf(d))]; if (r) series.forEach(s => { r[s.key] += s.value(d); }); }
  return { title: `${title} per ${unit}`, fmt, series: series.map(({ key, label }) => ({ key, label })), rows };
}

// Rows grouped by a key, each column computed from the group, plus a share-of-total column and a totals line
function table({ title, head, docs, by, cols, keys, name = cap, share = cols[0].key, limit }) {
  const g = groupBy(docs, by);
  const row = (n, a) => ({ name: n, ...Object.fromEntries(cols.map(c => [c.key, c.value(a)])) });
  const total = row('Total', docs);
  let rows = (keys || Object.keys(g)).map(k => row(name(k), g[k] || []));
  if (!keys) rows.sort((a, b) => b[share] - a[share]);
  if (limit) rows = rows.slice(0, limit);
  rows.forEach(r => { r.share = rate(r[share], total[share]); });
  total.share = total[share] ? 100 : 0;
  return { title, cols: [{ key: 'name', label: head }, ...cols.map(({ key, label, fmt }) => ({ key, label, fmt })), { key: 'share', label: 'Share', fmt: 'pct' }], rows, total };
}

const done = j => j.status === 'completed';
const servicesTotal = j => sum(j.services || [], s => (s.price || 0) * (s.qty || 1));
const routeCharge = j => j.routePrice ?? j.price;                 // price of the route alone, without services
// Jobs pick a route from Prices; older jobs had free-text From / To instead
const route = j => j.location || (j.pickup || j.dropoff ? `${j.pickup || '?'} → ${j.dropoff || '?'}` : 'No route');
const isEnquiry = x => x.kind === 'message' && x.category !== 'other';
// Email quotes: answered once staff have sent a reply (the automatic confirmation does not count)
const answered = q => (q.messages || []).some(m => m.kind === 'reply');
const firstReply = q => { const m = (q.messages || []).find(x => x.kind === 'reply'); return m && new Date(m.at) - new Date(q.createdAt); };
const completedRevenue = p => M.Job.find({ ...within('date', p), status: 'completed' }).lean();

// The money picture for a set of jobs, expenses and payslips (used by the financial report)
function figures(jobs, expenses, slips) {
  const c = jobs.filter(done);
  const revenue = sum(c, x => x.price), services = sum(c, servicesTotal), partner = sum(c, x => x.partnerCost);
  const opex = sum(expenses, x => x.amount), payroll = sum(slips, x => x.gross), gross = revenue - partner;
  const byCat = {};
  for (const x of expenses) byCat[x.category || 'other'] = (byCat[x.category || 'other'] || 0) + (x.amount || 0);
  return {
    revenue, services, routes: revenue - services, partner, gross, opex, payroll, net: gross - opex - payroll, jobs: c.length, byCat,
    wages: byCat.wages || 0, all: jobs.length, cancelled: jobs.filter(x => x.status === 'cancelled').length,
    lost: sum(jobs.filter(x => x.status === 'cancelled'), x => x.price),
    pipeline: sum(jobs.filter(x => ['quoted', 'confirmed'].includes(x.status)), x => x.price),
  };
}

// ---------- one report per module ----------
const reports = {
  inbox: {
    load: p => M.Interaction.find(within('receivedAt', p)).lean(),
    kpis: () => [
      kpi('Total received', d => d.length),
      kpi('Messages', count(x => x.kind === 'message')),
      kpi('Comments', count(x => x.kind === 'comment')),
      kpi('Enquiries', count(isEnquiry), 'num', 'up', 'Price, location and booking messages'),
      kpi('Response rate', d => rate(count(x => x.responded)(d), d.length), 'pct'),
      kpi('Awaiting reply', count(x => !x.responded), 'num', 'down'),
      kpi('Follow-ups recorded', d => sum(d, x => (x.followUps || []).length)),
      kpi('Lost (not interested)', count(x => [...(x.followUps || [])].sort((a, b) => a.at - b.at).at(-1)?.outcome === 'not interested'), 'num', 'down'),
      kpi('Average response time', d => {
        const r = d.filter(x => x.responded && x.respondedAt && x.receivedAt);
        return r.length ? sum(r, x => new Date(x.respondedAt) - new Date(x.receivedAt)) / r.length / 3600e3 : 0;
      }, 'hours', 'down', 'Received to marked responded'),
    ],
    build: (d, p) => {
      const cols = [
        { key: 'n', label: 'Received', value: a => a.length },
        { key: 'msg', label: 'Messages', value: count(x => x.kind === 'message') },
        { key: 'cmt', label: 'Comments', value: count(x => x.kind === 'comment') },
        { key: 'resp', label: 'Responded', value: count(x => x.responded) },
        { key: 'rate', label: 'Response rate', fmt: 'pct', value: a => rate(count(x => x.responded)(a), a.length) },
      ];
      return {
        charts: [chart('Received', p, d, x => x.receivedAt, ['facebook', 'whatsapp'].map(c => ({ key: c, label: cap(c), value: x => +(x.channel === c) })))],
        tables: [
          table({ title: 'By channel', head: 'Channel', docs: d, by: x => x.channel, cols, keys: ['facebook', 'whatsapp'] }),
          table({ title: 'By category', head: 'Category', docs: d, by: x => x.category, cols, keys: ['price', 'location', 'booking', 'other'] }),
        ],
      };
    },
  },

  quotes: {
    roles: M.QUOTE_ROLES,
    load: p => M.Quote.find(within('createdAt', p)).lean(),
    kpis: () => [
      kpi('Quote requests', d => d.length),
      kpi('Replied to', count(answered)),
      kpi('Reply rate', d => rate(count(answered)(d), d.length), 'pct'),
      kpi('Awaiting first reply', count(x => !answered(x) && x.status !== 'closed'), 'num', 'down'),
      kpi('Customer replies waiting', count(x => x.status === 'customer replied'), 'num', 'down', 'The customer wrote back and nobody has answered yet'),
      kpi('Average first-reply time', d => {
        const r = d.map(firstReply).filter(Boolean);
        return r.length ? sum(r, x => x) / r.length / 3600e3 : 0;
      }, 'hours', 'down', 'Request received to first email from staff'),
    ],
    build: (d, p) => {
      const cols = [
        { key: 'n', label: 'Requests', value: a => a.length },
        { key: 'replied', label: 'Replied to', value: count(answered) },
        { key: 'rate', label: 'Reply rate', fmt: 'pct', value: a => rate(count(answered)(a), a.length) },
      ];
      return {
        charts: [chart('Quote requests', p, d, x => x.createdAt, [
          { key: 'replied', label: 'Replied to', value: x => +answered(x) },
          { key: 'waiting', label: 'Not replied yet', value: x => +!answered(x) },
        ])],
        tables: [
          table({ title: 'By service', head: 'Service', docs: d, by: x => x.service || 'Not given', cols, name: String }),
          table({ title: 'By status', head: 'Status', docs: d, by: x => x.status, cols, keys: M.Quote.schema.path('status').enumValues }),
        ],
      };
    },
  },

  jobs: {
    load: p => M.Job.find(within('date', p)).lean(),
    kpis: admin => [
      kpi('Jobs (by move date)', d => d.length),
      kpi('Completed', count(done)),
      kpi('Revenue (completed)', d => sum(d.filter(done), x => x.price), 'money'),
      kpi('Average job value', d => { const c = d.filter(done); return c.length ? sum(c, x => x.price) / c.length : 0; }, 'money'),
      kpi('Services revenue', d => sum(d.filter(done), servicesTotal), 'money', 'up', 'Extra services on completed jobs'),
      kpi('Open pipeline', d => sum(d.filter(x => ['quoted', 'confirmed'].includes(x.status)), x => x.price), 'money', 'up', 'Quoted and confirmed jobs'),
      kpi('Cancellation rate', d => rate(count(x => x.status === 'cancelled')(d), d.length), 'pct', 'down'),
      ...(admin ? [
        kpi('Paid to partners', d => sum(d.filter(done), x => x.partnerCost), 'money', 'down'),
        kpi('Gross margin', d => sum(d.filter(done), x => (x.price || 0) - (x.partnerCost || 0)), 'money'),
        kpi('Gross margin %', d => { const c = d.filter(done); return rate(sum(c, x => (x.price || 0) - (x.partnerCost || 0)), sum(c, x => x.price)); }, 'pct'),
      ] : []),
    ],
    build: (d, p, admin) => {
      const statuses = ['quoted', 'confirmed', 'completed', 'cancelled'];
      const c = d.filter(done);
      return {
        charts: [
          chart('Jobs', p, d, x => x.date, statuses.map(s => ({ key: s, label: cap(s), value: x => +(x.status === s) }))),
          admin
            ? chart('Revenue (completed)', p, c, x => x.date, [
              { key: 'partner', label: 'Paid to partner', value: x => x.partnerCost || 0 },
              { key: 'margin', label: 'Our margin', value: x => Math.max(0, (x.price || 0) - (x.partnerCost || 0)) },
            ], 'money')
            : chart('Revenue (completed)', p, c, x => x.date, [{ key: 'revenue', label: 'Revenue', value: x => x.price || 0 }], 'money'),
        ],
        tables: [
          table({ title: 'By status', head: 'Status', docs: d, by: x => x.status, keys: statuses, cols: [
            { key: 'n', label: 'Jobs', value: a => a.length },
            { key: 'value', label: 'Value', fmt: 'money', value: a => sum(a, x => x.price) },
          ] }),
          table({ title: 'By source', head: 'Source', docs: d, by: x => x.source, keys: ['facebook', 'whatsapp', 'referral', 'other'], cols: [
            { key: 'n', label: 'Jobs', value: a => a.length },
            { key: 'done', label: 'Completed', value: count(done) },
            { key: 'rate', label: 'Completion rate', fmt: 'pct', value: a => rate(count(done)(a), a.length) },
            { key: 'rev', label: 'Revenue', fmt: 'money', value: a => sum(a.filter(done), x => x.price) },
          ] }),
          table({ title: 'Services sold', head: 'Service', docs: c.flatMap(j => j.services || []), by: x => x.name, name: k => k, share: 'rev', cols: [
            { key: 'qty', label: 'Quantity', value: a => sum(a, x => x.qty || 1) },
            { key: 'rev', label: 'Revenue', fmt: 'money', value: a => sum(a, x => (x.price || 0) * (x.qty || 1)) },
          ] }),
          table({ title: 'Top routes', head: 'Route', docs: d, by: route, name: k => k, limit: 10, cols: [
            { key: 'n', label: 'Jobs', value: a => a.length },
            { key: 'rev', label: 'Revenue', fmt: 'money', value: a => sum(a.filter(done), x => x.price) },
            { key: 'avg', label: 'Average price', fmt: 'money', value: a => (a.length ? sum(a, x => x.price) / a.length : 0) },
          ] }),
        ],
      };
    },
  },

  expenses: {
    managers: true,
    load: async p => {
      const [rows, jobs] = await Promise.all([M.Expense.find(within('date', p)).lean(), completedRevenue(p)]);
      const first = p.from || (rows.length ? new Date(Math.min(...rows.map(x => +new Date(x.date)))) : new Date());
      // days so far, not days still to come ("This month" runs to the end of the month)
      return { rows, revenue: sum(jobs, x => x.price), partnerCost: sum(jobs, x => x.partnerCost), days: Math.max(1, Math.round((Math.min(p.to || Date.now(), Date.now()) - first) / DAY)) };
    },
    kpis: () => [
      kpi('Total spent', d => sum(d.rows, x => x.amount), 'money', 'down'),
      kpi('Number of entries', d => d.rows.length, 'num', 'down'),
      kpi('Average per entry', d => (d.rows.length ? sum(d.rows, x => x.amount) / d.rows.length : 0), 'money', 'down'),
      kpi('Largest single expense', d => Math.max(0, ...d.rows.map(x => x.amount || 0)), 'money', 'down'),
      kpi('Average spend per day', d => sum(d.rows, x => x.amount) / d.days, 'money', 'down'),
      kpi('Expenses as % of revenue', d => rate(sum(d.rows, x => x.amount), d.revenue), 'pct', 'down', 'Revenue from completed jobs'),
      kpi('Net profit', d => d.revenue - d.partnerCost - sum(d.rows, x => x.amount), 'money', 'up', 'Revenue minus partner payments minus expenses'),
    ],
    build: (d, p) => {
      const cats = [...new Set(d.rows.map(x => x.category || 'other'))];
      return {
        charts: [chart('Spend', p, d.rows, x => x.date, cats.map(c => ({ key: c, label: cap(c), value: x => ((x.category || 'other') === c ? x.amount || 0 : 0) })), 'money')],
        tables: [
          table({ title: 'By category', head: 'Category', docs: d.rows, by: x => x.category || 'other', share: 'amount', cols: [
            { key: 'n', label: 'Entries', value: a => a.length },
            { key: 'amount', label: 'Amount', fmt: 'money', value: a => sum(a, x => x.amount) },
            { key: 'avg', label: 'Average', fmt: 'money', value: a => (a.length ? sum(a, x => x.amount) / a.length : 0) },
          ] }),
          {
            title: 'Largest expenses',
            cols: [{ key: 'date', label: 'Date', fmt: 'date' }, { key: 'name', label: 'Expense' }, { key: 'category', label: 'Category' }, { key: 'amount', label: 'Amount', fmt: 'money' }],
            rows: [...d.rows].sort((a, b) => b.amount - a.amount).slice(0, 10).map(x => ({ date: x.date, name: x.title, category: cap(x.category), amount: x.amount })),
          },
        ],
      };
    },
  },

  partners: {
    managers: true,
    load: async p => ({ partners: await M.Partner.find().sort({ name: 1 }).lean(), jobs: await M.Job.find(within('date', p)).lean() }),
    kpis: () => {
      const pj = d => d.jobs.filter(j => j.partner), pd = d => pj(d).filter(done);
      const margin = d => sum(pd(d), x => (x.price || 0) - (x.partnerCost || 0));
      return [
        kpi('Partners on file', d => d.partners.length),
        kpi('Jobs given to partners', d => pj(d).length),
        kpi('Share of jobs outsourced', d => rate(pj(d).length, d.jobs.length), 'pct'),
        kpi('Paid to partners', d => sum(pd(d), x => x.partnerCost), 'money', 'down', 'Completed jobs'),
        kpi('Revenue on partner jobs', d => sum(pd(d), x => x.price), 'money'),
        kpi('Our margin', margin, 'money'),
        kpi('Effective markup', d => rate(margin(d), sum(pd(d), x => x.partnerCost)), 'pct', 'up', 'Our margin as % of partner payments'),
      ];
    },
    build: (d, p) => {
      const names = Object.fromEntries(d.partners.map(x => [String(x._id), x.name]));
      const pj = d.jobs.filter(j => j.partner);
      return {
        charts: [chart('Partner job revenue', p, pj.filter(done), x => x.date, [
          { key: 'partner', label: 'Paid to partner', value: x => x.partnerCost || 0 },
          { key: 'margin', label: 'Our margin', value: x => Math.max(0, (x.price || 0) - (x.partnerCost || 0)) },
        ], 'money')],
        tables: [table({
          title: 'Partner statement', head: 'Partner', docs: pj, by: x => String(x.partner), keys: Object.keys(names), name: k => names[k] || 'Removed partner', share: 'paid',
          cols: [
            { key: 'n', label: 'Jobs', value: a => a.length },
            { key: 'done', label: 'Completed', value: count(done) },
            { key: 'rev', label: 'Revenue', fmt: 'money', value: a => sum(a.filter(done), x => x.price) },
            { key: 'paid', label: 'Paid to partner', fmt: 'money', value: a => sum(a.filter(done), x => x.partnerCost) },
            { key: 'margin', label: 'Our margin', fmt: 'money', value: a => sum(a.filter(done), x => (x.price || 0) - (x.partnerCost || 0)) },
            { key: 'pct', label: 'Margin %', fmt: 'pct', value: a => { const c = a.filter(done); return rate(sum(c, x => (x.price || 0) - (x.partnerCost || 0)), sum(c, x => x.price)); } },
          ],
        })],
      };
    },
  },

  prices: {
    load: async p => {
      const [locs, svcs, partners, jobs] = await Promise.all([
        M.Location.find().sort({ name: 1 }).lean(), M.Service.find().sort({ name: 1 }).lean(), M.Partner.find().select('name').lean(),
        M.Job.find({ ...within('date', p), status: { $ne: 'cancelled' } }).lean(),
      ]);
      // A job counts for the route it picked; older jobs count when their From or To mentions the route name
      const hits = j => locs.filter(l => j.location ? j.location === l.name : [j.pickup, j.dropoff].some(s => (s || '').toLowerCase().includes(l.name.toLowerCase())));
      return { locs, svcs, partners, jobs: jobs.map(j => ({ ...j, locs: hits(j) })) };
    },
    kpis: admin => {
      const vs = d => {                                  // average % charged above (or below) the listed price
        const v = d.jobs.filter(j => routeCharge(j) > 0 && j.locs.length).map(j => { const list = Math.max(...j.locs.map(l => l.price)); return list ? rate(routeCharge(j) - list, list) : 0; });
        return v.length ? sum(v, x => x) / v.length : 0;
      };
      return [
        kpi('Routes priced', d => d.locs.length),
        kpi('Services priced', d => d.svcs.length),
        kpi('Average route price', d => (d.locs.length ? sum(d.locs, x => x.price) / d.locs.length : 0), 'money', 'up', 'Full price quoted to clients'),
        ...(admin ? [kpi('Average markup per route', d => (d.locs.length ? sum(d.locs, x => x.markup) / d.locs.length : 0), 'money', 'up', 'Client price minus partner price')] : []),
        kpi('Jobs on listed routes', d => d.jobs.filter(j => j.locs.length).length, 'num', 'up', 'Jobs whose route is on the price list'),
        kpi('Route coverage', d => rate(d.jobs.filter(j => j.locs.length).length, d.jobs.length), 'pct', 'up', 'Share of jobs on a priced route'),
        kpi('Charged vs list price', vs, 'pct', 'up', 'Average difference, jobs on listed routes'),
      ];
    },
    build: (d, p, admin) => {
      const partnerName = Object.fromEntries(d.partners.map(x => [String(x._id), x.name]));
      const rows = d.locs.map(l => {
        const js = d.jobs.filter(j => j.locs.some(x => x._id.equals(l._id))), priced = js.filter(j => routeCharge(j) > 0);
        const avg = priced.length ? sum(priced, routeCharge) / priced.length : 0;
        return { name: l.name, ...(admin && { partner: partnerName[l.partner] || '', cost: l.partnerPrice, markup: l.markup }), list: l.price, n: js.length, done: count(done)(js), rev: sum(js.filter(done), x => x.price), avg, vs: avg && l.price ? rate(avg - l.price, l.price) : 0 };
      }).sort((a, b) => b.n - a.n);
      const stats = (name, a) => ({ name, n: a.length, min: a.length ? Math.min(...a.map(x => x.price)) : 0, avg: a.length ? sum(a, x => x.price) / a.length : 0, max: a.length ? Math.max(...a.map(x => x.price)) : 0 });
      return {
        charts: [{ title: 'Jobs per route (top 15)', fmt: 'num', series: [{ key: 'n', label: 'Jobs' }], rows: rows.slice(0, 15).map(r => ({ label: r.name, n: r.n })) }],
        tables: [
          {
            title: 'Route demand and price realisation',
            cols: [{ key: 'name', label: 'Route' },
              ...(admin ? [{ key: 'partner', label: 'Partner' }, { key: 'cost', label: 'Partner price', fmt: 'money' }, { key: 'markup', label: 'Our markup', fmt: 'money' }] : []),
              { key: 'list', label: 'Client price', fmt: 'money' }, { key: 'n', label: 'Jobs' }, { key: 'done', label: 'Completed' }, { key: 'rev', label: 'Revenue', fmt: 'money' }, { key: 'avg', label: 'Average charged', fmt: 'money' }, { key: 'vs', label: 'vs list', fmt: 'pct' }],
            rows,
            // a job can match two locations (From and To), so the total counts each job once
            total: (m => ({ name: 'Total', n: m.length, done: count(done)(m), rev: sum(m.filter(done), x => x.price) }))(d.jobs.filter(j => j.locs.length)),
          },
          {
            title: 'Price list summary',
            cols: [{ key: 'name', label: 'List' }, { key: 'n', label: 'Items' }, { key: 'min', label: 'Lowest', fmt: 'money' }, { key: 'avg', label: 'Average', fmt: 'money' }, { key: 'max', label: 'Highest', fmt: 'money' }],
            rows: [stats('Routes', d.locs), stats('Services', d.svcs)],
          },
        ],
      };
    },
  },

  // Bank-style financial report: income statement, ratios, 12-month trend and breakdowns
  finance: {
    managers: true,
    load: async p => {
      const [jobs, expenses, runs, partners] = await Promise.all([
        M.Job.find(within('date', p)).lean(), M.Expense.find(within('date', p)).lean(),
        M.PayrollRun.find({ status: 'final', ...within('payDate', p) }).lean(), M.Partner.find().select('name').lean(),
      ]);
      const slips = runs.length ? await M.Payslip.find({ run: { $in: runs.map(r => r._id) } }).lean() : [];
      return { jobs, expenses, slips, partners, f: figures(jobs, expenses, slips) };
    },
    kpis: () => [
      kpi('Revenue', d => d.f.revenue, 'money', 'up', 'Completed jobs'),
      kpi('Gross profit', d => d.f.gross, 'money', 'up', 'Revenue minus partner payments'),
      kpi('Gross margin', d => rate(d.f.gross, d.f.revenue), 'pct'),
      kpi('Operating expenses', d => d.f.opex, 'money', 'down'),
      kpi('Payroll', d => d.f.payroll, 'money', 'down', 'Gross pay, finalised payroll'),
      kpi('Net profit', d => d.f.net, 'money', 'up', 'After partners, expenses and payroll'),
      kpi('Net margin', d => rate(d.f.net, d.f.revenue), 'pct'),
      kpi('Completed jobs', d => d.f.jobs),
    ],
    build: async (d, p, admin, prev) => {
      const f = d.f, g = prev?.f;
      // income statement: each line with % of revenue and the change against the previous period
      const line = (name, get, kind) => {
        const cur = get(f), was = g ? get(g) : null;
        return { name, kind, cur, pctRev: rate(cur, f.revenue), ...(g && { prev: was, change: cur - was, changePct: was ? rate(cur - was, Math.abs(was)) : null }) };
      };
      const cats = [...new Set([...Object.keys(f.byCat), ...Object.keys(g?.byCat || {})])].sort((a, b) => (f.byCat[b] || 0) - (f.byCat[a] || 0));
      const statement = {
        title: 'Income statement',
        cols: [{ key: 'name', label: 'Line' }, { key: 'cur', label: 'This period', fmt: 'money' }, { key: 'pctRev', label: '% of revenue', fmt: 'pct' },
          ...(g ? [{ key: 'prev', label: 'Previous period', fmt: 'money' }, { key: 'change', label: 'Change', fmt: 'smoney' }, { key: 'changePct', label: 'Change %', fmt: 'spct' }] : [])],
        rows: [
          { name: 'Revenue', kind: 'header' },
          line('Moves (route charges)', x => x.routes), line('Extra services', x => x.services),
          line('Total revenue', x => x.revenue, 'subtotal'),
          { name: 'Cost of sales', kind: 'header' },
          line('Partner payments', x => x.partner),
          line('Gross profit', x => x.gross, 'subtotal'),
          { name: 'Operating expenses', kind: 'header' },
          ...cats.map(c => line(cap(c), x => x.byCat[c] || 0)),
          line('Salaries and wages (payroll)', x => x.payroll),
          line('Total operating expenses', x => x.opex + x.payroll, 'subtotal'),
          line('Net profit', x => x.net, 'total'),
        ],
        note: f.wages && f.payroll ? `Expenses include ${cap('wages')} entries of P ${f.wages.toLocaleString()} as well as finalised payroll. Check they are not the same salaries counted twice.` : undefined,
      };

      // ratios: percentages change in points, amounts in Pula
      const ratio = (name, get, fmt) => {
        const cur = get(f), was = g ? get(g) : null;
        return { name, cur, fmt, ...(g && { prev: was, change: cur - was, cfmt: fmt === 'pct' ? 'pts' : fmt === 'money' ? 'smoney' : 'snum' }) };
      };
      const fixed = x => x.opex + x.payroll, perJob = x => (x.jobs ? x.gross / x.jobs : 0);
      const ratios = {
        title: 'Key ratios',
        cols: [{ key: 'name', label: 'Measure' }, { key: 'cur', label: 'This period', rowFmt: 'fmt' },
          ...(g ? [{ key: 'prev', label: 'Previous period', rowFmt: 'fmt' }, { key: 'change', label: 'Change', rowFmt: 'cfmt' }] : [])],
        rows: [
          ratio('Gross margin', x => rate(x.gross, x.revenue), 'pct'),
          ratio('Net margin', x => rate(x.net, x.revenue), 'pct'),
          ratio('Partner payments as % of revenue', x => rate(x.partner, x.revenue), 'pct'),
          ratio('Operating expenses as % of revenue', x => rate(x.opex, x.revenue), 'pct'),
          ratio('Payroll as % of revenue', x => rate(x.payroll, x.revenue), 'pct'),
          ratio('Extra services as % of revenue', x => rate(x.services, x.revenue), 'pct'),
          ratio('Completed jobs', x => x.jobs, 'num'),
          ratio('Average job value', x => (x.jobs ? x.revenue / x.jobs : 0), 'money'),
          ratio('Gross profit per job', perJob, 'money'),
          ratio('Break-even jobs (to cover expenses and payroll)', x => (perJob(x) > 0 ? Math.ceil(fixed(x) / perJob(x)) : 0), 'num'),
          ratio('Cancellation rate', x => rate(x.cancelled, x.all), 'pct'),
          ratio('Value of cancelled jobs', x => x.lost, 'money'),
          ratio('Open pipeline (quoted and confirmed)', x => x.pipeline, 'money'),
        ],
      };

      // last 12 months up to the end of the period
      const end = new Date(+(p.to || new Date()) + 2 * 3600e3), months = [];
      for (let i = 11; i >= 0; i--) months.push(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
      const span = { from: new Date(months[0] + '-01T00:00:00+02:00'), to: p.to || new Date() };
      const [tj, te, tr] = await Promise.all([M.Job.find({ ...within('date', span), status: 'completed' }).lean(), M.Expense.find(within('date', span)).lean(),
        M.PayrollRun.find({ status: 'final', ...within('payDate', span) }).lean()]);
      const ts = tr.length ? await M.Payslip.find({ run: { $in: tr.map(r => r._id) } }).lean() : [];
      const month = x => local(x).slice(0, 7);
      const trendRows = months.map(m => {
        const t = figures(tj.filter(x => month(x.date) === m), te.filter(x => month(x.date) === m), ts.filter(x => month(x.payDate) === m));
        return { name: new Date(m + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }), label: m,
          revenue: t.revenue, partner: t.partner, gross: t.gross, opex: t.opex, payroll: t.payroll, net: t.net, margin: rate(t.net, t.revenue) };
      });
      const tot = k => sum(trendRows, x => x[k]);
      const trend = {
        title: 'Last 12 months',
        cols: [{ key: 'name', label: 'Month' }, ...[['revenue', 'Revenue'], ['partner', 'Partner payments'], ['gross', 'Gross profit'], ['opex', 'Expenses'], ['payroll', 'Payroll'], ['net', 'Net profit']]
          .map(([key, label]) => ({ key, label, fmt: 'money' })), { key: 'margin', label: 'Net margin', fmt: 'pct' }],
        rows: trendRows,
        total: { name: 'Total', revenue: tot('revenue'), partner: tot('partner'), gross: tot('gross'), opex: tot('opex'), payroll: tot('payroll'), net: tot('net'), margin: rate(tot('net'), tot('revenue')) },
      };

      const c = d.jobs.filter(done);
      const names = Object.fromEntries(d.partners.map(x => [String(x._id), x.name]));
      return {
        charts: [
          { title: 'Revenue per month (last 12 months)', fmt: 'money', series: [{ key: 'revenue', label: 'Revenue' }], rows: trendRows },
          { title: 'Costs per month (last 12 months)', fmt: 'money', series: [{ key: 'partner', label: 'Partner payments' }, { key: 'opex', label: 'Expenses' }, { key: 'payroll', label: 'Payroll' }], rows: trendRows },
        ],
        tables: [
          statement, ratios, trend,
          table({ title: 'Revenue by source', head: 'Source', docs: c, by: x => x.source, share: 'rev', cols: [
            { key: 'n', label: 'Jobs', value: a => a.length },
            { key: 'rev', label: 'Revenue', fmt: 'money', value: a => sum(a, x => x.price) },
            { key: 'gp', label: 'Gross profit', fmt: 'money', value: a => sum(a, x => (x.price || 0) - (x.partnerCost || 0)) },
          ] }),
          table({ title: 'Revenue by route (top 10)', head: 'Route', docs: c, by: route, name: k => k, share: 'rev', limit: 10, cols: [
            { key: 'n', label: 'Jobs', value: a => a.length },
            { key: 'rev', label: 'Revenue', fmt: 'money', value: a => sum(a, x => x.price) },
            { key: 'gp', label: 'Gross profit', fmt: 'money', value: a => sum(a, x => (x.price || 0) - (x.partnerCost || 0)) },
          ] }),
          table({ title: 'Partner payments', head: 'Partner', docs: c.filter(x => x.partner), by: x => String(x.partner), name: k => names[k] || 'Removed partner', share: 'paid', cols: [
            { key: 'n', label: 'Jobs', value: a => a.length },
            { key: 'rev', label: 'Revenue', fmt: 'money', value: a => sum(a, x => x.price) },
            { key: 'paid', label: 'Paid to partner', fmt: 'money', value: a => sum(a, x => x.partnerCost) },
            { key: 'gp', label: 'Our margin', fmt: 'money', value: a => sum(a, x => (x.price || 0) - (x.partnerCost || 0)) },
          ] }),
          table({ title: 'Operating expenses by category', head: 'Category', docs: d.expenses, by: x => x.category || 'other', share: 'amount', cols: [
            { key: 'n', label: 'Entries', value: a => a.length },
            { key: 'amount', label: 'Amount', fmt: 'money', value: a => sum(a, x => x.amount) },
          ] }),
          table({ title: 'Payroll by employee', head: 'Employee', docs: d.slips, by: x => x.name, name: k => k, share: 'gross', cols: [
            { key: 'gross', label: 'Gross pay', fmt: 'money', value: a => sum(a, x => x.gross) },
            { key: 'paye', label: 'PAYE', fmt: 'money', value: a => sum(a, x => x.paye) },
            { key: 'other', label: 'Other deductions', fmt: 'money', value: a => sum(a, x => x.totalDeductions - x.paye) },
            { key: 'net', label: 'Net pay', fmt: 'money', value: a => sum(a, x => x.net) },
          ] }),
        ],
      };
    },
  },

  // Who entered what: one row per person (everyone is an employee with a login)
  team: {
    managers: true,
    load: async p => {
      const [users, jobs, inbox, replies, exps] = await Promise.all([
        M.User.find().select('-password').sort({ name: 1 }).lean(),
        M.Job.find(within('createdAt', p)).lean(),
        M.Interaction.find(within('createdAt', p)).lean(),
        M.Interaction.find({ ...within('respondedAt', p), responded: true }).lean(),
        M.Expense.find(within('createdAt', p)).lean(),
      ]);
      return { users, newUsers: users.filter(u => (!p.from || u.createdAt >= p.from) && (!p.to || u.createdAt <= p.to)).length, jobs, inbox, replies, exps };
    },
    kpis: () => {
      const logged = d => [...d.jobs, ...d.inbox, ...d.exps].filter(x => x.createdBy).length;
      return [
        kpi('People with a login', d => d.users.length),
        kpi('Managers', d => count(u => M.MANAGERS.includes(u.role))(d.users), 'num', 'up', 'Admins and operations managers'),
        kpi('Other roles', d => count(u => !M.MANAGERS.includes(u.role))(d.users)),
        kpi('New people', d => d.newUsers),
        kpi('Records entered', logged, 'num', 'up', 'Jobs, inbox items and expenses added by someone'),
        kpi('Replies marked', d => d.replies.filter(x => x.respondedBy).length),
      ];
    },
    build: (d, p) => {
      const who = x => String(x.createdBy || '');
      const rows = [...d.users.map(u => ({ id: String(u._id), name: u.name, role: cap(u.role) })), { id: '', name: 'Automatic or not tracked', role: '' }].map(u => {
        const j = d.jobs.filter(x => who(x) === u.id), i = d.inbox.filter(x => who(x) === u.id), e = d.exps.filter(x => who(x) === u.id);
        const r = d.replies.filter(x => String(x.respondedBy || '') === u.id).length;
        return { name: u.name, role: u.role, jobs: j.length, value: sum(j, x => x.price), inbox: i.length, replies: r, exps: e.length, total: j.length + i.length + e.length + r };
      });
      const total = { name: 'Total', ...Object.fromEntries(['jobs', 'value', 'inbox', 'replies', 'exps', 'total'].map(k => [k, sum(rows, x => x[k])])) };
      rows.forEach(r => { r.share = rate(r.total, total.total); });
      total.share = total.total ? 100 : 0;
      const series = [['jobs', 'Jobs', d.jobs], ['inbox', 'Inbox items', d.inbox], ['exps', 'Expenses', d.exps]];
      const all = series.flatMap(([k, , a]) => a.filter(x => x.createdBy).map(x => ({ k, createdAt: x.createdAt })));
      return {
        charts: [chart('Records entered', p, all, x => x.createdAt, series.map(([key, label]) => ({ key, label, value: x => +(x.k === key) })))],
        tables: [{
          title: 'Team activity',
          cols: [{ key: 'name', label: 'Person' }, { key: 'role', label: 'Role' }, { key: 'jobs', label: 'Jobs added' }, { key: 'value', label: 'Job value', fmt: 'money' }, { key: 'inbox', label: 'Inbox items' }, { key: 'replies', label: 'Replies marked' }, { key: 'exps', label: 'Expenses' }, { key: 'total', label: 'Total actions' }, { key: 'share', label: 'Share', fmt: 'pct' }],
          rows, total,
        }],
      };
    },
  },
};

// Build a report as data: used for the page (JSON) and for PDF / Excel exports
async function build(name, req) {
  const r = Object.hasOwn(reports, name) && reports[name];
  if (!r) throw Object.assign(new Error('No such report'), { status: 404 });
  const admin = M.MANAGERS.includes(req.user.role);       // managers see everything, including partner costs
  if (r.managers && !admin) throw Object.assign(new Error('Not allowed'), { status: 403 });
  if (r.roles && !r.roles.includes(req.user.role)) throw Object.assign(new Error('Not allowed'), { status: 403 });
  const p = period(req.query);
  const [cur, prev] = await Promise.all([r.load(p), p.prev && r.load(p.prev)]);
  return {
    range: { from: p.from, to: p.to, prevFrom: p.prev?.from, prevTo: p.prev?.to },
    generatedAt: new Date(),
    kpis: r.kpis(admin).map(({ f, ...k }) => ({ ...k, value: f(cur), prev: prev ? f(prev) : null })),
    ...(await r.build(cur, p, admin, prev)),
  };
}

const TITLES = { quotes: 'Email quotes report', inbox: 'Inbox report', jobs: 'Jobs report', expenses: 'Expenses report', partners: 'Partners report', prices: 'Prices report', team: 'Team activity report', finance: 'Financial report' };
const router = express.Router();
router.get('/:name/export', async (req, res) => {
  const data = await build(req.params.name, req);
  const { exportReport } = require('./export');
  await exportReport(res, req.query.format === 'xlsx' ? 'xlsx' : 'pdf', { ...data, title: TITLES[req.params.name] || 'Report', name: req.params.name, by: req.user.name });
});
router.get('/:name', async (req, res) => res.json(await build(req.params.name, req)));

module.exports = { router, period, within };
