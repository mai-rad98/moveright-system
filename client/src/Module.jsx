import { useEffect, useState } from 'react';
import { api, money, getUser } from './api.js';

// ---------- dates (all as YYYY-MM-DD in local time) ----------
const iso = d => new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
const shift = (s, days) => { const d = new Date(s + 'T12:00'); d.setDate(d.getDate() + days); return iso(d); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 864e5);
export const todayIso = () => iso(new Date());
const longDate = s => new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

const presets = () => {
  const t = todayIso(), d = new Date();
  return [
    ['Today', t, t],
    ['Yesterday', shift(t, -1), shift(t, -1)],
    ['Last 7 days', shift(t, -6), t],
    ['This month', iso(new Date(d.getFullYear(), d.getMonth(), 1)), t],
    ['Last month', iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), iso(new Date(d.getFullYear(), d.getMonth(), 0))],
    ['This year', iso(new Date(d.getFullYear(), 0, 1)), t],
    ['All time', '', ''],
  ];
};

// The chosen period is shared by every module (kept for this browser tab), so picking
// "Yesterday" in Inbox and then opening Jobs keeps you on yesterday.
const load = () => { try { return JSON.parse(sessionStorage.getItem('mr_period')); } catch { return null; } };
export function usePeriod() {
  const [p, setP] = useState(() => load() || { from: presets()[3][1], to: presets()[3][2] });
  const set = v => { setP(v); try { sessionStorage.setItem('mr_period', JSON.stringify(v)); } catch {} };
  return [p, set];
}

// The date new records get: today when it is inside the period, otherwise the nearest end of it
export const entryDate = ({ from, to }) => {
  const t = todayIso();
  if (to && to < t) return to;
  if (from && from > t) return from;
  return t;
};

function PeriodBar({ p, set }) {
  const label = presets().find(([, f, t]) => f === p.from && t === p.to)?.[0] || 'Custom';
  const len = p.from && p.to ? daysBetween(p.from, p.to) + 1 : 0;
  const move = dir => set({ from: shift(p.from, dir * len), to: shift(p.to, dir * len) });
  return (
    <div className="tools period">
      <label>Date</label>
      <select value={label} onChange={e => { const x = presets().find(([n]) => n === e.target.value); if (x) set({ from: x[1], to: x[2] }); }}>
        {presets().map(([n]) => <option key={n}>{n}</option>)}
        {label === 'Custom' && <option>Custom</option>}
      </select>
      <button className="ghost" title="Previous period" disabled={!len} onClick={() => move(-1)}>◀</button>
      <input type="date" value={p.from} max={p.to || undefined} onChange={e => set({ from: e.target.value, to: p.to && e.target.value > p.to ? e.target.value : p.to })} />
      <span className="muted">to</span>
      <input type="date" value={p.to} min={p.from || undefined} onChange={e => set({ from: p.from && e.target.value < p.from ? e.target.value : p.from, to: e.target.value })} />
      <button className="ghost" title="Next period" disabled={!len} onClick={() => move(1)}>▶</button>
    </div>
  );
}

// ---------- report rendering ----------
const COLORS = ['#0a2b5e', '#ff6a00', '#1a8f4c', '#7c3aed', '#0f9d8a', '#d97706', '#c0392b', '#2563eb', '#64748b'];
const n1 = v => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
export const fmtVal = (v, f) => {
  if (v === undefined || v === null || v === '') return '';
  if (f === 'money') return money(v);
  if (f === 'pct') return n1(v) + '%';
  if (f === 'hours') return v < 1 ? Math.round(v * 60) + ' min' : n1(v) + ' h';
  if (f === 'date') return longDate(v);
  return typeof v === 'number' ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }) : v;
};

function Delta({ k }) {
  if (k.prev === null || k.prev === undefined) return null;
  const diff = k.value - k.prev;
  if (Math.abs(diff) < 1e-9) return <small className="delta flat">No change vs previous period</small>;
  const good = (diff > 0) === (k.better === 'up');
  const txt = k.fmt === 'pct' ? `${n1(Math.abs(diff))} pts` : k.prev ? `${n1(Math.abs(diff / k.prev) * 100)}%` : 'new';
  return <small className={'delta ' + (good ? 'good' : 'bad')} title={`Previous period: ${fmtVal(k.prev, k.fmt)}`}>{diff > 0 ? '▲' : '▼'} {txt} vs previous period</small>;
}

function Chart({ c }) {
  const max = Math.max(1, ...c.rows.map(r => c.series.reduce((s, x) => s + r[x.key], 0)));
  const dated = /^\d{4}-\d{2}/.test(c.rows[0]?.label || '');
  const short = l => (!dated ? l : l.length === 10 ? l.slice(8) : new Date(l + '-01T12:00').toLocaleDateString(undefined, { month: 'short' }));
  return (
    <div className="card chart">
      <div className="row"><h3>{c.title}</h3><span className="muted">Highest: {fmtVal(max, c.fmt)}</span></div>
      {c.series.length > 1 && (
        <div className="legend">{c.series.map((s, i) => <span key={s.key}><i style={{ background: COLORS[i % COLORS.length] }} />{s.label}</span>)}</div>
      )}
      {!c.rows.length ? <p className="muted">No data for this period.</p> : (
        <div className="bars">
          {c.rows.map(r => {
            const tot = c.series.reduce((s, x) => s + r[x.key], 0);
            return (
              <div className="bar" key={r.label} title={`${r.label}: ` + c.series.map(s => `${s.label} ${fmtVal(r[s.key], c.fmt)}`).join(', ')}>
                <small>{tot && c.fmt !== 'money' ? tot : ''}</small>
                {[...c.series].reverse().map(s => (
                  <div key={s.key} style={{ height: `${r[s.key] / max * 100}%`, background: COLORS[c.series.indexOf(s) % COLORS.length] }} />
                ))}
                <small className="lab">{short(r.label)}</small>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Table({ t }) {
  const num = c => c.fmt && c.fmt !== 'date' || ['n', 'jobs', 'done', 'inbox', 'replies', 'exps', 'total'].includes(c.key);
  return (
    <div className="card">
      <h3 className="t-h">{t.title}</h3>
      <div className="scroll">
        <table className="ledger">
          <thead><tr>{t.cols.map(c => <th key={c.key} className={num(c) ? 'num' : ''}>{c.label}</th>)}</tr></thead>
          <tbody>
            {t.rows.map((r, i) => <tr key={i}>{t.cols.map(c => <td key={c.key} className={num(c) ? 'num' : ''}>{fmtVal(r[c.key], c.fmt)}</td>)}</tr>)}
            {!t.rows.length && <tr><td colSpan={t.cols.length} className="muted">No data for this period.</td></tr>}
          </tbody>
          {t.total && t.rows.length > 0 && (
            <tfoot><tr>{t.cols.map(c => <td key={c.key} className={num(c) ? 'num' : ''}>{fmtVal(t.total[c.key], c.fmt)}</td>)}</tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function Report({ name, p, version }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(true);
  useEffect(() => { setErr(''); api(`/reports/${name}?from=${p.from}&to=${p.to}`).then(setD).catch(e => setErr(e.message)); }, [name, p.from, p.to, version]);
  if (err) return <p className="err">{err}</p>;
  if (!d) return <p className="muted">Loading report…</p>;
  const range = d.range.from ? `${longDate(d.range.from)} to ${longDate(d.range.to || Date.now())}` : 'All time';
  return (
    <section className="report">
      <div className="report-h">
        <div>
          <strong>Report: {range}</strong>
          <small>
            {d.range.prevFrom && <>Compared with {longDate(d.range.prevFrom)} to {longDate(d.range.prevTo)} · </>}
            Generated {new Date(d.generatedAt).toLocaleString()} by {getUser()?.name}
          </small>
        </div>
        <div className="row no-print">
          <button className="ghost" onClick={() => setOpen(!open)}>{open ? 'Hide report' : 'Show report'}</button>
          <button className="ghost" onClick={() => window.print()}>Print / PDF</button>
        </div>
      </div>
      {open && (
        <>
          <div className="grid">
            {d.kpis.map((k, i) => (
              <div className="stat" key={k.label} style={{ '--c': COLORS[i % COLORS.length] }}>
                <span className="lbl">{k.label}</span>
                <b>{fmtVal(k.value, k.fmt)}</b>
                <Delta k={k} />
                {k.hint && <small>{k.hint}</small>}
              </div>
            ))}
          </div>
          <div className="charts">{d.charts.map(c => <Chart key={c.title} c={c} />)}</div>
          <div className="tables">{d.tables.map(t => <Table key={t.title} t={t} />)}</div>
        </>
      )}
    </section>
  );
}

// A module page: title, the shared period bar, the module's report, then its records.
// `children` gets the period info so the records list can filter on it and new records default to it.
export default function Module({ title, note, report, dated, children }) {
  const [p, setP] = usePeriod();
  const [version, setVersion] = useState(0);
  const info = { ...p, dated, entryDate: entryDate(p), changed: () => setVersion(v => v + 1) };
  return (
    <>
      <div className="page-h">
        <div>
          <h1>{title}</h1>
          <p>{dated
            ? (p.from ? `Showing records dated ${longDate(p.from)} to ${longDate(p.to || todayIso())}. New records default to ${longDate(entryDate(p))}.` : 'Showing all records.')
            : note || 'The date only changes the report; the list below always shows everything.'}</p>
        </div>
        <PeriodBar p={p} set={setP} />
      </div>
      <Report name={report} p={p} version={version} />
      {children(info)}
    </>
  );
}
