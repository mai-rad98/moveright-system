// Empty locally (Vite proxies /api). On Render, set VITE_API_URL to the backend address.
const API = (import.meta.env.VITE_API_URL || '').replace(/[/]$/, '') + '/api';

export const getUser = () => JSON.parse(localStorage.getItem('mr_user') || 'null');

// Roles. Managers see everything; everyone else sees Dashboard, Inbox, Jobs and their own payslips and documents.
export const ROLES = ['admin', 'operations manager', 'sales and marketing', 'driver', 'cleaner', 'customer support'];
export const isManager = u => ['admin', 'operations manager'].includes(u?.role);
export const roleName = r => (r ? r.charAt(0).toUpperCase() + r.slice(1) : '');
// Whole amounts without cents (P 3,800); anything with cents always to two places (P 27,237.50)
export const money = n => {
  const v = Number(n || 0), a = Math.abs(v);
  return (v < 0 ? '-P ' : 'P ') + a.toLocaleString(undefined, { minimumFractionDigits: a % 1 ? 2 : 0, maximumFractionDigits: 2 });
};

export async function api(path, { method = 'GET', body } = {}) {
  const t = localStorage.getItem('mr_token');
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && path !== '/auth/login') { localStorage.clear(); location.href = '/login'; return; }
  if (!r.ok) {
    const txt = await r.text(); let msg = txt;
    try { msg = JSON.parse(txt).error || txt; } catch {}
    throw new Error(msg || r.statusText);
  }
  return r.status === 204 ? null : r.json();
}
// ---------- receipt files ----------
const auth = () => ({ Authorization: 'Bearer ' + localStorage.getItem('mr_token') });

// Upload a PDF or photo (max 5 MB) to `path`, e.g. '/receipts' or '/employees/<id>/documents?category=cv'
export async function upload(file, path = '/receipts') {
  if (file.size > 5 * 1024 * 1024) throw new Error('That file is larger than 5 MB');
  const r = await fetch(API + path, {
    method: 'POST', body: file,
    headers: { ...auth(), 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Upload failed');
  return r.json();
}

// Open a stored file (or PDF) in a new tab, e.g. openFile('/receipts/<id>')
export async function openFile(path) {
  const w = window.open('', '_blank');                     // open first so pop-up blockers allow it
  const r = await fetch(API + path, { headers: auth() });
  if (!r.ok) { w?.close(); alert('Could not open the file'); return; }
  const url = URL.createObjectURL(await r.blob());
  if (w) w.location = url; else location.href = url;
}

// Save a file from the API (e.g. a payslip PDF) under `name`
export async function downloadFile(path, name) {
  const r = await fetch(API + path, { headers: auth() });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Download failed');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await r.blob());
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
