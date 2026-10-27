import { useEffect, useState } from 'react';
import { api, money } from './api.js';
import { todayIso } from './Module.jsx';

// One reusable screen: list + add + update + delete, driven by a list of fields.
// `period` (from Module) filters dated lists and sets the default date of new records.
export default function Crud({ title, endpoint, fields, computed = [], actions = [], canAdd = true, canEdit = true, canDelete = true, period }) {
  const [rows, setRows] = useState([]);
  const [refs, setRefs] = useState({});
  const [form, setForm] = useState(null);
  const [err, setErr] = useState('');
  const inForm = fields.filter(f => !f.formHidden);

  const query = period?.dated ? `?from=${period.from}&to=${period.to}` : '';
  const load = () => api(endpoint + query).then(setRows).catch(e => setErr(e.message));
  const reload = () => { load(); period?.changed(); };
  useEffect(() => { load(); }, [query]);
  useEffect(() => {
    fields.filter(f => f.from).forEach(f => api('/' + f.from).then(d => setRefs(r => ({ ...r, [f.from]: d }))).catch(() => {}));
  }, []);

  const day = period?.entryDate || todayIso();
  const localDT = v => { const d = new Date(v); return new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); };
  const blank = () => setForm(Object.fromEntries(inForm.map(f => [f.name,
    f.type === 'date' ? day : f.type === 'datetime' ? day + localDT(Date.now()).slice(10) : f.options ? f.options[0] : ''])));
  const edit = r => setForm({ _id: r._id, ...Object.fromEntries(inForm.map(f => [f.name,
    f.type === 'date' ? (r[f.name] || '').slice(0, 10) : f.type === 'datetime' ? (r[f.name] ? localDT(r[f.name]) : '') : r[f.name] ?? ''])) });

  const save = async e => {
    e.preventDefault(); setErr('');
    const body = {};
    inForm.forEach(f => {
      const v = form[f.name];
      if (f.calc) return;                                 // calculated fields are worked out by the server
      if (f.type === 'number') { if (v !== '' && v !== null) body[f.name] = Number(v); }
      else if (f.type === 'datetime') { if (v) body[f.name] = new Date(v).toISOString(); }
      else body[f.name] = v;
    });
    try { await api(endpoint + (form._id ? '/' + form._id : ''), { method: form._id ? 'PUT' : 'POST', body }); setForm(null); reload(); }
    catch (x) { setErr(x.message); }
  };
  const del = async r => { if (confirm('Delete this record?')) { await api(endpoint + '/' + r._id, { method: 'DELETE' }); reload(); } };

  const show = (f, r) => {
    const v = r[f.name];
    if (f.from) return refs[f.from]?.find(x => x._id === v)?.[f.labelKey || 'name'] || '';
    if (f.type === 'date') return (v || '').slice(0, 10);
    if (f.type === 'datetime') return v ? new Date(v).toLocaleString() : '';
    if (f.type === 'checkbox') return v ? 'Yes' : 'No';
    if (f.money) return money(v);
    return v ?? '';
  };

  // Download exactly what the table shows as a spreadsheet-friendly CSV
  const exportCsv = () => {
    const cols = [...fields.filter(f => !f.hideInTable).map(f => [f.label, r => show(f, r)]), ...computed.map(c => [c.label, c.fn])];
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.map(c => cell(c[0])), ...rows.map(r => cols.map(c => cell(c[1](r))))].map(l => l.join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }));
    a.download = `${title.split(':')[0].trim().toLowerCase().replace(/\W+/g, '-')}${period?.dated && period.from ? `-${period.from}-to-${period.to || todayIso()}` : ''}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <section className="card">
      <div className="row"><h2>{title}</h2><span className="muted">{rows.length} records</span>
        <button className="ghost no-print" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
        {canAdd && <button className="no-print" onClick={blank}>+ Add</button>}</div>
      {err && <p className="err">{err}</p>}

      {form && (
        <form className="f no-print" onSubmit={save}>
          {inForm.map(f => (
            <div key={f.name}>
              <label>{f.label}</label>
              {f.calc ? (
                <input disabled value={money(f.calc(form))} />
              ) : f.options || f.from ? (
                <select value={form[f.name] ?? ''} onChange={e => setForm({ ...form, [f.name]: e.target.value })}>
                  {f.from && <option value="">None</option>}
                  {f.options ? f.options.map(o => <option key={o}>{o}</option>)
                    : (refs[f.from] || []).map(o => <option key={o._id} value={o._id}>{o[f.labelKey || 'name']}</option>)}
                </select>
              ) : (
                <input type={f.type === 'datetime' ? 'datetime-local' : f.type || 'text'} step="any" required={f.required}
                  value={form[f.name] ?? ''} onChange={e => setForm({ ...form, [f.name]: e.target.value })}
                  placeholder={f.type === 'password' && form._id ? 'Leave blank to keep' : ''} />
              )}
            </div>
          ))}
          <div className="row"><button>{form._id ? 'Update' : 'Save'}</button><button type="button" className="ghost" onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      )}

      <div className="scroll">
        <table>
          <thead><tr>
            {fields.filter(f => !f.hideInTable).map(f => <th key={f.name}>{f.label}</th>)}
            {computed.map(c => <th key={c.label}>{c.label}</th>)}<th className="no-print"></th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r._id}>
                {fields.filter(f => !f.hideInTable).map(f => <td key={f.name}>{show(f, r)}</td>)}
                {computed.map(c => <td key={c.label}>{c.fn(r)}</td>)}
                <td className="acts no-print">
                  {actions.filter(a => !a.show || a.show(r)).map(a => <button key={a.label} className="ghost" onClick={async () => { await a.run(r); reload(); }}>{a.label}</button>)}
                  {canEdit && <button className="ghost" onClick={() => edit(r)}>Edit</button>}
                  {canDelete && <button className="danger" onClick={() => del(r)}>Delete</button>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan="20" className="muted">Nothing here yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
