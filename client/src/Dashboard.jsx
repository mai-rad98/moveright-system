import { useEffect, useState } from 'react';
import { api, money, getUser } from './api.js';

const Stat = ({ label, value, tone }) => <div className="card stat"><b style={tone ? { color: tone } : null}>{value}</b><span>{label}</span></div>;

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
  const t = d.today, f = d.finance, max = Math.max(1, ...d.perDay.map(x => x.facebook + x.whatsapp));

  return (
    <>
      {admin && f && (
        <>
          <h2>Money (completed jobs)</h2>
          <div className="grid">
            <Stat label="Revenue" value={money(f.revenue)} />
            <Stat label="Paid to partners" value={money(f.partnerCost)} />
            <Stat label="Our markup / share" value={money(f.markup)} />
            <Stat label="Business expenses" value={money(f.expenses)} />
            <Stat label="Net profit" value={money(f.netProfit)} tone={f.netProfit < 0 ? '#c0392b' : '#1a8f4c'} />
          </div>
        </>
      )}
      <h2>Today</h2>
      <div className="grid">
        <Stat label="Messages received" value={t.messages} />
        <Stat label="Facebook / WhatsApp" value={`${t.facebook} / ${t.whatsapp}`} />
        <Stat label="Price enquiries" value={t.priceEnquiries} />
        <Stat label="Location enquiries" value={t.locationEnquiries} />
        <Stat label="Booking enquiries" value={t.bookingEnquiries} />
        <Stat label="Comments responded to" value={t.commentsResponded} tone="#1a8f4c" />
        <Stat label="Comments waiting" value={t.commentsPending} tone={t.commentsPending ? '#c0392b' : undefined} />
      </div>

      <section className="card">
        <h3>Messages per day (last 14 days)</h3>
        <div className="bars">
          {d.perDay.map(x => (
            <div className="bar" key={x.date} title={`${x.date}: Facebook ${x.facebook}, WhatsApp ${x.whatsapp}`}>
              <small>{x.facebook + x.whatsapp || ''}</small>
              <div style={{ height: `${x.whatsapp / max * 100}%`, background: 'var(--orange)' }} />
              <div style={{ height: `${x.facebook / max * 100}%`, background: 'var(--navy)' }} />
              <small>{x.date.slice(8)}</small>
            </div>
          ))}
        </div>
        <p className="muted"><span className="dot" style={{ background: 'var(--navy)' }} /> Facebook <span className="dot" style={{ background: 'var(--orange)' }} /> WhatsApp</p>
      </section>

      <div className="row">
        <h2>Period</h2>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ width: 160 }} />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ width: 160 }} />
        <button onClick={load}>Apply</button>
        <span className="muted">Default: this month</span>
      </div>
      <div className="grid">
        <Stat label="Enquiries (price, location, booking)" value={d.jobs.enquiries} />
        <Stat label="Jobs from Facebook / WhatsApp" value={d.jobs.fromChat} />
        <Stat label="Enquiries that became jobs (approx.)" value={d.jobs.conversionPercent + '%'} />
        {['quoted', 'confirmed', 'completed', 'cancelled'].map(s => <Stat key={s} label={`Jobs ${s}`} value={d.jobs.byStatus[s] || 0} />)}
      </div>

    </>
  );
}
