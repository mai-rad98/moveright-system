import { useEffect, useState } from 'react';
import { Amounts } from './Crud.jsx';
import { api, money, openFile, downloadFile } from './api.js';

export const monthName = p => new Date(p + '-15T12:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const day = d => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const pill = status => <span className="badge" style={{ '--c': status === 'final' ? '#1a8f4c' : '#d97706' }}>{status === 'final' ? 'Final' : 'Draft'}</span>;
const fileName = s => `payslip-${s.period}-${s.name.replace(/[^\w]+/g, '-').toLowerCase()}.pdf`;
const sum = a => (a || []).reduce((t, x) => t + (Number(x.amount) || 0), 0);

// Preview opens the PDF in a new tab; Download saves it
const SlipButtons = ({ base, s }) => (
  <>
    <button className="ghost" onClick={() => openFile(`${base}/payslips/${s._id}/pdf`)}>Preview</button>
    <button className="ghost" onClick={() => downloadFile(`${base}/payslips/${s._id}/pdf?download=1`, fileName(s))}>Download</button>
  </>
);

// Edit one payslip of a draft payroll: basic, allowances, deductions, PAYE override (blank = worked out)
function EditSlip({ slip, onDone }) {
  const [f, setF] = useState({ basic: slip.basic, allowances: slip.allowances, deductions: slip.deductions, payeOverride: slip.payeOverride ?? '' });
  const [err, setErr] = useState('');
  const save = async e => {
    e.preventDefault(); setErr('');
    try { await api(`/payroll/payslips/${slip._id}`, { method: 'PUT', body: f }); onDone(); } catch (x) { setErr(x.message); }
  };
  const gross = (+f.basic || 0) + sum(f.allowances);
  return (
    <form className="f no-print" onSubmit={save}>
      <div className="wide act-h"><strong>Edit payslip: {slip.name}</strong><span className="muted">Gross so far {money(gross)}. PAYE is worked out from gross unless you enter an amount.</span></div>
      <div><label>Basic salary</label><input type="number" step="any" min="0" value={f.basic} onChange={e => setF({ ...f, basic: e.target.value })} /></div>
      <div><label>PAYE override (leave blank to work it out)</label><input type="number" step="any" min="0" value={f.payeOverride} onChange={e => setF({ ...f, payeOverride: e.target.value })} /></div>
      <div className="wide"><label>Allowances and extras (added to pay)</label><Amounts value={f.allowances} placeholder="e.g. Overtime" onChange={v => setF({ ...f, allowances: v })} /></div>
      <div className="wide"><label>Deductions other than PAYE</label><Amounts value={f.deductions} placeholder="e.g. Pension" onChange={v => setF({ ...f, deductions: v })} /></div>
      {err && <p className="err wide">{err}</p>}
      <div className="row"><button>Save payslip</button><button type="button" className="ghost" onClick={onDone}>Cancel</button></div>
    </form>
  );
}

function Run({ id, onBack }) {
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null);
  const [sure, setSure] = useState('');                   // 'finalise' | 'delete' | 'rebuild' waiting for a second click
  const [err, setErr] = useState('');
  const load = () => api(`/payroll/${id}`).then(setD).catch(e => setErr(e.message));
  useEffect(() => { load(); }, [id]);
  const act = async (what, method = 'POST') => {
    setErr('');
    try { await api(`/payroll/${id}${what === 'delete' ? '' : '/' + what}`, { method: what === 'delete' ? 'DELETE' : method }); setSure(''); what === 'delete' ? onBack() : load(); }
    catch (x) { setErr(x.message); }
  };
  if (!d) return <p className="muted">{err || 'Loading…'}</p>;
  const { run, payslips } = d, draft = run.status === 'draft', t = run.totals || {};
  const confirm = (what, label, cls = '') => sure === what
    ? <><button className={cls} onClick={() => act(what)}>Yes, {label.toLowerCase()}</button><button className="ghost" onClick={() => setSure('')}>Cancel</button></>
    : <button className={cls || 'ghost'} onClick={() => setSure(what)}>{label}</button>;
  return (
    <>
      <div className="row">
        <button className="ghost" onClick={onBack}>← All payrolls</button>
        <h2>{monthName(run.period)} payroll</h2>{pill(run.status)}
      </div>
      <p className="muted">
        Pay date {day(run.payDate)}.{' '}
        {draft ? 'Check each payslip, then finalise. Finalised payslips are locked and employees can see them.' : `Finalised ${day(run.finalisedAt)}.`}
      </p>
      <div className="grid">
        <div className="stat" style={{ '--c': '#0a2b5e' }}><span className="lbl">Employees</span><b>{t.employees || 0}</b></div>
        <div className="stat" style={{ '--c': '#2563eb' }}><span className="lbl">Gross pay</span><b>{money(t.gross)}</b></div>
        <div className="stat" style={{ '--c': '#c0392b' }}><span className="lbl">PAYE</span><b>{money(t.paye)}</b></div>
        <div className="stat" style={{ '--c': '#d97706' }}><span className="lbl">Other deductions</span><b>{money(t.deductions)}</b></div>
        <div className="stat" style={{ '--c': '#1a8f4c' }}><span className="lbl">Net pay</span><b>{money(t.net)}</b></div>
      </div>
      {draft && (
        <div className="row no-print">
          {confirm('finalise', 'Finalise payroll')}
          {confirm('rebuild', 'Rebuild from employee details')}
          {confirm('delete', 'Delete draft', 'danger')}
        </div>
      )}
      {err && <p className="err">{err}</p>}
      {edit && <EditSlip slip={edit} onDone={() => { setEdit(null); load(); }} />}
      <section className="card">
        <div className="scroll">
          <table className="ledger">
            <thead><tr><th>Employee</th><th>Job title</th><th className="num">Basic</th><th className="num">Allowances</th><th className="num">Gross</th>
              <th className="num">PAYE</th><th className="num">Other deductions</th><th className="num">Net pay</th><th></th></tr></thead>
            <tbody>
              {payslips.map(s => (
                <tr key={s._id}>
                  <td>{s.name}</td><td>{s.jobTitle}</td>
                  <td className="num">{money(s.basic)}</td><td className="num">{money(sum(s.allowances))}</td><td className="num">{money(s.gross)}</td>
                  <td className="num">{money(s.paye)}{s.payeOverride !== null && s.payeOverride !== undefined && <small className="muted"> (set)</small>}</td>
                  <td className="num">{money(sum(s.deductions))}</td><td className="num"><b>{money(s.net)}</b></td>
                  <td className="acts no-print">
                    {draft && <button className="ghost" onClick={() => setEdit(s)}>Edit</button>}
                    <SlipButtons base="/payroll" s={s} />
                  </td>
                </tr>
              ))}
              {!payslips.length && <tr><td colSpan="9" className="muted">No active employees were on the payroll for this month.</td></tr>}
            </tbody>
            {payslips.length > 0 && (
              <tfoot><tr><td>Total</td><td></td><td className="num">{money(payslips.reduce((a, s) => a + s.basic, 0))}</td>
                <td className="num">{money(payslips.reduce((a, s) => a + sum(s.allowances), 0))}</td><td className="num">{money(t.gross)}</td>
                <td className="num">{money(t.paye)}</td><td className="num">{money(t.deductions)}</td><td className="num">{money(t.net)}</td><td></td></tr></tfoot>
            )}
          </table>
        </div>
      </section>
    </>
  );
}

export function Payroll() {
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(null);
  const [month, setMonth] = useState('');
  const [err, setErr] = useState('');
  const load = () => api('/payroll').then(x => { setD(x); setMonth(m => m || x.current); }).catch(e => setErr(e.message));
  useEffect(() => { if (!open) load(); }, [open]);
  const run = async e => {
    e.preventDefault(); setErr('');
    try { const r = await api('/payroll/run', { method: 'POST', body: { period: month } }); setOpen(r._id); } catch (x) { setErr(x.message); }
  };
  const current = d?.runs.find(r => r.period === d.current);
  return (
    <>
      <div className="page-h">
        <div><h1>Payroll</h1><p>Payroll is drafted automatically on the 28th of each month. Check it, then finalise to release payslips.</p></div>
        {!open && (
          <form className="tools" onSubmit={run}>
            <label>Run payroll for</label>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} required />
            <button>Run payroll</button>
          </form>
        )}
      </div>
      {err && <p className="err">{err}</p>}
      {open ? <Run id={open} onBack={() => setOpen(null)} /> : !d ? <p className="muted">Loading…</p> : (
        <>
          {current?.status === 'draft' && (
            <p className="note">{monthName(current.period)} payroll is ready as a draft. <button onClick={() => setOpen(current._id)}>Review and finalise</button></p>
          )}
          <section className="card">
            <div className="scroll">
              <table className="ledger">
                <thead><tr><th>Month</th><th>Pay date</th><th>Status</th><th className="num">Employees</th><th className="num">Gross</th>
                  <th className="num">PAYE</th><th className="num">Other deductions</th><th className="num">Net pay</th><th></th></tr></thead>
                <tbody>
                  {d.runs.map(r => (
                    <tr key={r._id}>
                      <td><b>{monthName(r.period)}</b></td><td>{day(r.payDate)}</td><td>{pill(r.status)}</td>
                      <td className="num">{r.totals?.employees || 0}</td><td className="num">{money(r.totals?.gross)}</td><td className="num">{money(r.totals?.paye)}</td>
                      <td className="num">{money(r.totals?.deductions)}</td><td className="num"><b>{money(r.totals?.net)}</b></td>
                      <td className="acts"><button className="ghost" onClick={() => setOpen(r._id)}>Open</button></td>
                    </tr>
                  ))}
                  {!d.runs.length && <tr><td colSpan="9" className="muted">No payroll yet. It is drafted on the 28th, or use Run payroll.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}

export function MyPayslips() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/me/payslips').then(setRows).catch(e => setErr(e.message)); }, []);
  return (
    <>
      <div className="page-h"><div><h1>My payslips</h1><p>Your payslips appear here once payroll is finalised.</p></div></div>
      {err && <p className="err">{err}</p>}
      <section className="card">
        {!rows ? <p className="muted">Loading…</p> : (
          <div className="scroll">
            <table className="ledger">
              <thead><tr><th>Month</th><th>Pay date</th><th className="num">Gross</th><th className="num">Deductions</th><th className="num">Net pay</th><th></th></tr></thead>
              <tbody>
                {rows.map(s => (
                  <tr key={s._id}>
                    <td><b>{monthName(s.period)}</b></td><td>{day(s.payDate)}</td><td className="num">{money(s.gross)}</td>
                    <td className="num">{money(s.totalDeductions)}</td><td className="num"><b>{money(s.net)}</b></td>
                    <td className="acts"><SlipButtons base="/me" s={s} /></td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan="6" className="muted">No payslips yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
