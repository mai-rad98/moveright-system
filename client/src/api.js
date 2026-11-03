// Empty locally (Vite proxies /api). On Render, set VITE_API_URL to the backend address.
const API = (import.meta.env.VITE_API_URL || '').replace(/[/]$/, '') + '/api';

export const getUser = () => JSON.parse(localStorage.getItem('mr_user') || 'null');
export const money = n => 'P ' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

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

export async function upload(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('That file is larger than 5 MB');
  const r = await fetch(API + '/receipts', {
    method: 'POST', body: file,
    headers: { ...auth(), 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Upload failed');
  return r.json();
}

export async function openFile(id) {
  const w = window.open('', '_blank');                     // open first so pop-up blockers allow it
  const r = await fetch(API + '/receipts/' + id, { headers: auth() });
  if (!r.ok) { w?.close(); alert('Could not open the receipt'); return; }
  const url = URL.createObjectURL(await r.blob());
  if (w) w.location = url; else location.href = url;
}
