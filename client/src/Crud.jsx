import { useEffect, useState } from 'react';
import { api, money, upload, openFile } from './api.js';
import { todayIso } from './Module.jsx';

// One reusable screen: list + add + update + delete, driven by a list of fields.
// `period` (from Module) filters dated lists and sets the default date of new records.
// Dropdown fields (`from`) can store another field than _id (`valueKey`), label options (`optionLabel`)
// and fill in other fields when an option is picked (`onPick(item, form)` returns the changes).
// `search: true` turns the dropdown into a type-to-search box for long lists.
// Other field options: `readOnly` (shown greyed, never sent), `colors: { value: '#hex' }` (coloured pill in the table),
// `editValue(row)` (value to start from when editing), `type: 'lines'` (service lines with quantity, `from` the price list)
// and `type: 'file'` (receipt upload). `searchable` adds a search box that looks across all dates.
// `onInput(value, form)` returns other fields to update as one is typed in; `send: false` keeps a field out of the save.
// An action with `fields` opens a small form first and calls `run(row, values)`; `intro(row)` is shown above it.
// Live-search dropdown: every typed word must appear in the option, e.g. "gab ram" finds "Gaborone to Ramotswa"
function SearchSelect({ value, items, label, valueOf, onChange, required }) {
  const [q, setQ] = useState(null);                       // null = list closed
  const [hi, setHi] = useState(0);
  const words = (q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const list = items.filter(o => words.every(w => label(o).toLowerCase().includes(w)));
  const choose = o => { onChange(o ? String(valueOf(o)) : ''); setQ(null); };
  const key = e => {
    if (q === null) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, list.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (list[hi]) choose(list[hi]); }
    else if (e.key === 'Escape') setQ(null);
  };
  return (
    <div className="combo">
      <input value={q ?? value ?? ''} placeholder={value || 'Type to search…'} required={required && !value}
        onFocus={() => { setQ(''); setHi(0); }} onBlur={() => setQ(null)} onKeyDown={key}
        onChange={e => { setQ(e.target.value); setHi(0); }} />
      {q !== null && (
        <ul className="combo-list">
          {value && <li className="muted" onMouseDown={e => { e.preventDefault(); choose(null); }}>Clear selection</li>}
          {list.map((o, i) => (
            <li key={o._id} className={i === hi ? 'hi' : ''} ref={el => i === hi && el?.scrollIntoView({ block: 'nearest' })}
              onMouseEnter={() => setHi(i)} onMouseDown={e => { e.preventDefault(); choose(o); }}>{label(o)}</li>
          ))}
          {!list.length && <li className="muted">No matches</li>}
        </ul>
      )}
    </div>
  );
}

// One row per service: pick the service (copies its name and price), set the quantity
function Lines({ value, items, onChange }) {
  const lines = value || [];
  const set = (i, patch) => onChange(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="lines">
      {lines.map((x, i) => (
        <div className="line" key={i}>
          <select value={x.service || ''} onChange={e => {
            const s = items.find(o => o._id === e.target.value);
            set(i, s ? { service: s._id, name: s.name, price: s.price } : { service: '', name: '', price: 0 });
          }}>
            <option value="">Choose a service</option>
            {items.map(o => <option key={o._id} value={o._id}>{o.name} ({money(o.price)}{o.unit ? ' ' + o.unit : ''})</option>)}
            {x.service && !items.some(o => o._id === x.service) && <option value={x.service}>{x.name}</option>}
          </select>
          <input type="number" min="1" step="1" value={x.qty} onChange={e => set(i, { qty: e.target.value })} title="Quantity" />
          <span className="line-total">{money((x.price || 0) * (+x.qty || 1))}</span>
          <button type="button" className="ghost" title="Remove" onClick={() => onChange(lines.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="ghost" onClick={() => onChange([...lines, { service: '', name: '', price: 0, qty: 1 }])}>+ Add service</button>
    </div>
  );
}

// Uploads straight away and keeps { id, name, type } in the form
function FileField({ value, onChange }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (value?.id) return (
    <div className="row file">
      <button type="button" className="ghost" onClick={() => openFile(value.id)}>View {value.name}</button>
      <button type="button" className="ghost" onClick={() => onChange(null)}>Remove</button>
    </div>
  );
  return (
    <div className="file">
      <input type="file" accept="application/pdf,image/*" disabled={busy} onChange={async e => {
        const file = e.target.files[0]; if (!file) return;
        setBusy(true); setErr('');
        try { onChange(await upload(file)); } catch (x) { setErr(x.message); e.target.value = ''; }
        setBusy(false);
      }} />
      {busy && <small className="muted">Uploading…</small>}
      {err && <small className="err">{err}</small>}
    </div>
  );
}

export default function Crud({ title, endpoint, fields, computed = [], actions = [], canAdd = true, canEdit = true, canDelete = true, period, searchable }) {
  const [rows, setRows] = useState([]);
  const [refs, setRefs] = useState({});
  const [form, setForm] = useState(null);
  const [act, setAct] = useState(null);                    // { a: action, r: row } while an action's form is open
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const inForm = fields.filter(f => !f.formHidden);

  const [q, setQ] = useState('');
  const [find, setFind] = useState('');                    // the search text, applied 250 ms after typing stops
  useEffect(() => { const t = setTimeout(() => setFind(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const query = find ? `?q=${encodeURIComponent(find)}` : period?.dated ? `?from=${period.from}&to=${period.to}` : '';
  const load = () => api(endpoint + query).then(d => { setRows(d); return d; }).catch(e => { setErr(e.message); return []; });
  const reload = () => { period?.changed(); return load(); };
  useEffect(() => { load(); }, [endpoint, query]);
  useEffect(() => {
    [...new Set(fields.filter(f => f.from).map(f => f.from))].forEach(from => api('/' + from).then(d => setRefs(r => ({ ...r, [from]: d }))).catch(() => {}));
  }, []);

  const day = period?.entryDate || todayIso();
  const localDT = v => { const d = new Date(v); return new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); };
  const formFields = act ? act.a.fields : inForm;
  const blankOf = list => Object.fromEntries(list.map(f => [f.name,
    f.type === 'date' ? day : f.type === 'datetime' ? day + localDT(Date.now()).slice(10) : f.type === 'lines' ? [] : f.type === 'file' ? null : f.options ? f.options[0] : '']));
  const blank = () => { setAct(null); setForm(blankOf(inForm)); };
  const open = (a, r) => { setAct({ a, r }); setForm(blankOf(a.fields)); };
  const close = () => { setForm(null); setAct(null); };
  const edit = r => setAct(null) || setForm({ _id: r._id, ...Object.fromEntries(inForm.map(f => [f.name,
    f.editValue ? f.editValue(r) ?? '' : f.type === 'date' ? (r[f.name] || '').slice(0, 10) : f.type === 'datetime' ? (r[f.name] ? localDT(r[f.name]) : '')
      : f.type === 'lines' ? r[f.name] || [] : f.type === 'file' ? r[f.name] || null : r[f.name] ?? ''])) });

  const change = (f, v) => setForm({ ...form, [f.name]: v, ...(f.onInput && f.onInput(v, form)) });
  const pick = (f, v) => {
    const item = f.onPick && refs[f.from]?.find(o => String(o[f.valueKey || '_id']) === v);
    setForm({ ...form, [f.name]: v, ...(item && f.onPick(item, form)) });
  };

  const save = async e => {
    e.preventDefault(); setErr(''); setNote('');
    const body = {};
    formFields.forEach(f => {
      const v = form[f.name];
      if (f.calc || f.readOnly || f.send === false) return;   // calculated, assigned and helper fields are not saved
      if (f.type === 'number') { if (v !== '' && v !== null) body[f.name] = Number(v); }
      else if (f.type === 'datetime') { if (v) body[f.name] = new Date(v).toISOString(); }
      else body[f.name] = v;
    });
    try {
      const saved = act ? await act.a.run(act.r, body) : await api(endpoint + (form._id ? '/' + form._id : ''), { method: form._id ? 'PUT' : 'POST', body });
      close();
      const list = await reload();
      // A record dated outside the dates shown is saved but not in this list: say so rather than letting it vanish
      if (!act && saved?._id && !list.some(x => x._id === saved._id))
        setNote('Saved. It is dated outside the dates shown above, so it is not in this list. Change the Date at the top (or search) to see it.');
    }
    catch (x) { setErr(x.message); }
  };
  const del = async r => { if (confirm('Delete this record?')) { await api(endpoint + '/' + r._id, { method: 'DELETE' }); reload(); } };

  const show = (f, r) => {
    const v = r[f.name];
    if (f.from) return f.valueKey ? v ?? '' : refs[f.from]?.find(x => x._id === v)?.[f.labelKey || 'name'] || '';
    if (f.type === 'date') return (v || '').slice(0, 10);
    if (f.type === 'datetime') return v ? new Date(v).toLocaleString() : '';
    if (f.type === 'checkbox') return v ? 'Yes' : 'No';
    if (f.type === 'lines') return (v || []).map(x => `${x.name} ×${x.qty}`).join(', ');
    if (f.type === 'file') return v?.name || '';
    if (f.money) return money(v);
    return v ?? '';
  };

  // `colors` is { value: '#hex' }, or a function of the row for labels that change (e.g. dates)
  const pill = (text, colors, r) => text === '' ? '' : <span className="badge" style={{ '--c': (typeof colors === 'function' ? colors(r) : colors[text]) || '#64748b' }}>{text}</span>;
  const cell = (f, r) => {
    if (f.type === 'file') return r[f.name]?.id ? <button className="ghost" onClick={() => openFile(r[f.name].id)}>View</button> : '';
    return f.colors ? pill(show(f, r), f.colors, r) : show(f, r);
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
      <div className="row"><h2>{title}</h2><span className="muted">{rows.length} records{find && ' (searching all dates)'}</span>
        {searchable && <input className="search no-print" type="search" placeholder={searchable} value={q} onChange={e => setQ(e.target.value)} />}
        <button className="ghost no-print" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
        {canAdd && <button className="no-print" onClick={blank}>+ Add</button>}</div>
      {err && <p className="err">{err}</p>}
      {note && <p className="note">{note} <button className="ghost" onClick={() => setNote('')}>OK</button></p>}

      {form && (
        <form className="f no-print" onSubmit={save}>
          {act && <div className="wide act-h"><strong>{act.a.label}{act.r.ref ? `: ${act.r.ref}` : ''}</strong>{act.a.intro?.(act.r)}</div>}
          {formFields.map(f => (
            <div key={f.name} className={f.type === 'lines' ? 'wide' : ''}>
              <label>{f.label}</label>
              {f.calc ? (
                <input disabled value={money(f.calc(form))} />
              ) : f.readOnly ? (
                <input disabled className="ro" value={form[f.name] || ''} placeholder="Assigned when saved" />
              ) : f.type === 'lines' ? (
                <Lines value={form[f.name]} items={refs[f.from] || []} onChange={v => change(f, v)} />
              ) : f.type === 'file' ? (
                <FileField value={form[f.name]} onChange={v => setForm({ ...form, [f.name]: v })} />
              ) : f.search && f.from ? (
                <SearchSelect value={form[f.name]} items={refs[f.from] || []} required={f.required}
                  label={o => (f.optionLabel ? f.optionLabel(o) : o[f.labelKey || 'name'])} valueOf={o => o[f.valueKey || '_id']}
                  onChange={v => pick(f, v)} />
              ) : f.options || f.from ? (
                <select value={form[f.name] ?? ''} onChange={e => pick(f, e.target.value)}>
                  {f.from && <option value="">None</option>}
                  {f.options ? f.options.map(o => <option key={o}>{o}</option>)
                    : (refs[f.from] || []).map(o => <option key={o._id} value={o[f.valueKey || '_id']}>{f.optionLabel ? f.optionLabel(o) : o[f.labelKey || 'name']}</option>)}
                  {f.valueKey && form[f.name] && !(refs[f.from] || []).some(o => o[f.valueKey] === form[f.name]) && <option>{form[f.name]}</option>}
                </select>
              ) : (
                <input type={f.type === 'datetime' ? 'datetime-local' : f.type || 'text'} step="any" required={f.required}
                  value={form[f.name] ?? ''} onChange={e => change(f, e.target.value)}
                  placeholder={f.type === 'password' && form._id ? 'Leave blank to keep' : ''} />
              )}
            </div>
          ))}
          <div className="row"><button>{form._id ? 'Update' : 'Save'}</button><button type="button" className="ghost" onClick={close}>Cancel</button></div>
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
                {fields.filter(f => !f.hideInTable).map(f => <td key={f.name}>{cell(f, r)}</td>)}
                {computed.map(c => <td key={c.label}>{c.colors ? pill(c.fn(r), c.colors, r) : c.fn(r)}</td>)}
                <td className="acts no-print">
                  {actions.filter(a => !a.show || a.show(r)).map(a => <button key={a.label} className="ghost" onClick={async () => { if (a.fields) return open(a, r); await a.run(r); reload(); }}>{a.label}</button>)}
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
