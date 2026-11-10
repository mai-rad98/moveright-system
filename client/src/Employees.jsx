import { useEffect, useState } from 'react';
import Crud from './Crud.jsx';
import { api, upload, openFile, getUser, ROLES } from './api.js';
import Module from './Module.jsx';

const money0 = { type: 'number', money: true };
const CATEGORIES = { cv: 'CV', certificate: 'Certificate', id: 'ID / passport', contract: 'Contract', other: 'Other' };
const CAT_COLORS = { cv: '#2563eb', certificate: '#1a8f4c', id: '#7c3aed', contract: '#ff6a00', other: '#64748b' };
const size = n => (n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

// Documents for one employee. `base` is '/employees/<id>/documents' (admin) or '/me/documents' (the employee themself).
export function Documents({ base, title, onClose, canEdit }) {
  const [docs, setDocs] = useState(null);
  const [cat, setCat] = useState('cv');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sure, setSure] = useState(null);                  // id waiting for "Confirm delete"
  const load = () => api(base).then(setDocs).catch(e => setErr(e.message));
  useEffect(() => { load(); }, [base]);

  const add = async e => {
    const file = e.target.files[0]; if (!file) return;
    setBusy(true); setErr('');
    try { await upload(file, `${base}?category=${cat}`); load(); } catch (x) { setErr(x.message); }
    e.target.value = ''; setBusy(false);
  };
  const del = async id => { await api(`${base}/${id}`, { method: 'DELETE' }); setSure(null); load(); };

  return (
    <div className="docs">
      <div className="row">
        <h3>{title}</h3>
        {onClose && <button className="ghost" onClick={onClose}>Close</button>}
      </div>
      {canEdit && (
        <div className="row doc-add">
          <label>Add a document</label>
          <select value={cat} onChange={e => setCat(e.target.value)} style={{ width: 'auto' }}>
            {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input type="file" accept="application/pdf,image/*" disabled={busy} onChange={add} style={{ width: 'auto' }} />
          <span className="muted">{busy ? 'Uploading…' : 'PDF or photo, up to 5 MB'}</span>
        </div>
      )}
      {err && <p className="err">{err}</p>}
      {!docs ? <p className="muted">Loading…</p> : !docs.length ? <p className="muted">No documents yet.</p> : (
        <div className="scroll">
          <table>
            <thead><tr><th>Type</th><th>Document</th><th>Size</th><th>Added</th><th></th></tr></thead>
            <tbody>
              {docs.map(d => (
                <tr key={d._id}>
                  <td><span className="badge" style={{ '--c': CAT_COLORS[d.category] }}>{CATEGORIES[d.category]}</span></td>
                  <td>{d.name}</td>
                  <td>{size(d.size)}</td>
                  <td>{new Date(d.createdAt).toLocaleDateString()}</td>
                  <td className="acts">
                    <button className="ghost" onClick={() => openFile(`${base}/${d._id}`)}>View</button>
                    {canEdit && (sure === d._id
                      ? <><button className="danger" onClick={() => del(d._id)}>Confirm delete</button><button className="ghost" onClick={() => setSure(null)}>Keep</button></>
                      : <button className="danger" onClick={() => setSure(d._id)}>Delete</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Role colours; managers (admin, operations manager) in the darker tones
const ROLE_COLORS = { admin: '#0a2b5e', 'operations manager': '#2563eb', 'sales and marketing': '#db2777', driver: '#ff6a00', cleaner: '#0f9d8a', 'customer support': '#7c3aed' };

export const Employees = () => {
  // everyday roles first (a new employee defaults to the first one); only an admin can give the admin role (the server checks too)
  const roles = [...ROLES.slice(2), 'operations manager', ...(getUser()?.role === 'admin' ? ['admin'] : [])];
  return (
    <Module title="Employees" report="team"
      note="Everyone who works here. Each person logs in with their role: admins and operations managers see everything; sales and marketing, drivers, cleaners and customer support see Dashboard, Inbox, Jobs and their own payslips. Basic salary and recurring deductions feed the monthly payroll (salary 0 = not on payroll).">
      {p => (
        <Crud period={p} title="Employees" endpoint="/employees" searchable="Search name, email, job title or role" fields={[
          { name: 'firstName', label: 'Name', required: true },
          { name: 'surname', label: 'Surname', required: true },
          { name: 'email', label: 'Email (used to log in)', type: 'email', required: true },
          { name: 'role', label: 'Role', options: roles, colors: ROLE_COLORS },
          { name: 'password', label: 'Password (leave blank to keep when editing)', type: 'password', hideInTable: true, requiredNew: true },
          { name: 'phone', label: 'Phone', hideInTable: true },
          { name: 'idNumber', label: 'Omang / passport', hideInTable: true },
          { name: 'jobTitle', label: 'Job title', hideInTable: true },
          { name: 'salary', label: 'Basic salary (monthly)', ...money0, required: true },
          { name: 'startDate', label: 'Start date', type: 'date', hideInTable: true },
          { name: 'status', label: 'Status', options: ['active', 'left'], colors: { active: '#1a8f4c', left: '#64748b' } },
          { name: 'bankName', label: 'Bank', hideInTable: true },
          { name: 'bankAccount', label: 'Bank account', hideInTable: true },
          { name: 'deductions', label: 'Recurring deductions (each month)', type: 'amounts', hideInTable: true },
        ]} computed={[
          { label: 'Login', fn: r => (r.login ? 'Yes' : 'No login yet'), colors: { Yes: '#1a8f4c', 'No login yet': '#c0392b' } },
          { label: 'Documents', fn: r => (r.documents ? `${r.documents} file${r.documents > 1 ? 's' : ''}` : 'None') },
        ]} actions={[
          { label: 'Documents', panel: (r, close) => <Documents base={`/employees/${r._id}/documents`} title={`Documents: ${r.firstName} ${r.surname}`} onClose={close} canEdit /> },
        ]} />
      )}
    </Module>
  );
};

export const MyDocuments = () => (
  <>
    <div className="page-h"><div><h1>My documents</h1><p>Documents your employer keeps on file for you.</p></div></div>
    <section className="card"><Documents base="/me/documents" title="Documents" /></section>
  </>
);
