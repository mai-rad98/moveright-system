import { useEffect, useState } from 'react';
import { api, money, getUser } from './api.js';

// Colour codes used across the dashboard
const C = { navy: '#0a2b5e', orange: '#ff6a00', green: '#1a8f4c', red: '#c0392b', blue: '#2563eb', purple: '#7c3aed', teal: '#0f9d8a', amber: '#d97706', gray: '#64748b' };

const Stat = ({ label, value, color = C.navy, hint, big }) => (
  <div className={'stat' + (big ? ' big' : '')} style={{ '--c': color }}>
    <span className="lbl">{label}</span>
    <b>{value}</b>
    {hint && <small>{hint}</small>}
  </div>
);

const Section = ({ title, note, children }) => (
  <section className="sec">
    <div className="sec-h"><h2>{title}</h2>{note && <span>{note}</span>}</div>
    {children}
  </section>
);

const fmt = d => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function Dashboard() {
  const admin = getUser()?.role === 'admin';
  const [d, setD] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [err, setErr] = useState('');
  const load = () => api(`/analytics?from=${from}&to=${to}`).then(setD).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (err) return <p className="err">{err}</p>;
  if (!d) return <p>Loading…</p>;
  const t = d.today, f = d.finance;
  const max = Math.max(1, ...d.perDay.map(x => x.facebook + x.whatsapp));
  const period = `${fmt(d.range.from)} to ${fmt(d.range.to)}`;

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Dashboard</h1>
          <p>{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="tools">
          <label>Period</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          <input type="date" value={to} onChange={e => setTo(e.target.value)} />
          <button onClick={load}>Apply</button>
        </div>
      </div>

      {admin && f && (
        <Section title="Money (completed jobs)" note={period}>
          <div className="grid">
            <Stat big label="Net profit" value={money(f.netProfit)} color={f.netProfit < 0 ? C.red : C.green} hint="Revenue minus partner payments minus expenses" />
            <Stat label="Revenue" value={money(f.revenue)} color={C.blue} hint={`${f.completedJobs} completed jobs`} />
            <Stat label="Paid to partners" value={money(f.partnerCost)} color={C.amber} />
            <Stat label="Our markup / share" value={money(f.markup)} color={C.teal} hint="Revenue minus partner payments" />
            <Stat label="Business expenses" value={money(f.expenses)} color={C.red} />
          </div>
        </Section>
      )}

      <Section title="Today" note="Messages and comments">
        <div className="grid">
          <Stat label="Messages received" value={t.messages} color={C.navy} />
          <Stat label="Facebook / WhatsApp" value={`${t.facebook} / ${t.whatsapp}`} color={C.blue} />
          <Stat label="Price enquiries" value={t.priceEnquiries} color={C.orange} />
          <Stat label="Location enquiries" value={t.locationEnquiries} color={C.purple} />
          <Stat label="Booking enquiries" value={t.bookingEnquiries} color={C.teal} />
          <Stat label="Comments responded to" value={t.commentsResponded} color={C.green} />
          <Stat label="Comments waiting" value={t.commentsPending} color={t.commentsPending ? C.red : C.gray} />
        </div>
      </Section>

      <Section title="Messages per day" note="Last 14 days">
        <div className="card chart">
          <div className="legend">
            <span><i style={{ background: C.navy }} />Facebook</span>
            <span><i style={{ background: C.orange }} />WhatsApp</span>
          </div>
          <div className="bars">
            {d.perDay.map(x => (
              <div className="bar" key={x.date} title={`${x.date}: Facebook ${x.facebook}, WhatsApp ${x.whatsapp}`}>
                <small>{x.facebook + x.whatsapp || ''}</small>
                <div style={{ height: `${x.whatsapp / max * 100}%`, background: C.orange }} />
                <div style={{ height: `${x.facebook / max * 100}%`, background: C.navy }} />
                <small>{x.date.slice(8)}</small>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Enquiries and jobs" note={period}>
        <div className="grid">
          <Stat label="Enquiries (price, location, booking)" value={d.jobs.enquiries} color={C.purple} />
          <Stat label="Jobs from Facebook / WhatsApp" value={d.jobs.fromChat} color={C.navy} />
          <Stat label="Enquiries that became jobs (approx.)" value={d.jobs.conversionPercent + '%'} color={C.orange} />
          <Stat label="Jobs quoted" value={d.jobs.byStatus.quoted || 0} color={C.amber} />
          <Stat label="Jobs confirmed" value={d.jobs.byStatus.confirmed || 0} color={C.blue} />
          <Stat label="Jobs completed" value={d.jobs.byStatus.completed || 0} color={C.green} />
          <Stat label="Jobs cancelled" value={d.jobs.byStatus.cancelled || 0} color={C.gray} />
        </div>
      </Section>
    </>
  );
}
