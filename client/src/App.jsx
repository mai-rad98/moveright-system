import { useState } from 'react';
import { Routes, Route, Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api, getUser } from './api.js';
import Dashboard from './Dashboard.jsx';
import { Inbox, Jobs, Prices, Partners, Expenses, Users } from './pages.jsx';

function Login() {
  const nav = useNavigate();
  const [f, setF] = useState({ email: '', password: '' });
  const [err, setErr] = useState('');
  const go = async e => {
    e.preventDefault();
    try {
      const r = await api('/auth/login', { method: 'POST', body: f });
      localStorage.setItem('mr_token', r.token); localStorage.setItem('mr_user', JSON.stringify(r.user));
      nav(r.user.role === 'admin' ? '/admin' : '/users');
    } catch (x) { setErr(x.message); }
  };
  return (
    <form className="card login" onSubmit={go}>
      <img src="/logo.png" alt="MoveRight" width="110" style={{ display: 'block', margin: '0 auto 10px' }} />
      <h2 style={{ textAlign: 'center' }}>MoveRight Management</h2>
      <label>Email</label><input type="email" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
      <label style={{ marginTop: 10 }}>Password</label><input type="password" required value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
      {err && <p className="err">{err}</p>}
      <button style={{ width: '100%', marginTop: 14 }}>Log in</button>
    </form>
  );
}

function Shell({ base, groups }) {
  const nav = useNavigate();
  const u = getUser();
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <img src="/logo.png" alt="MoveRight" />
          <div><strong>MoveRight</strong><small>{base === '/admin' ? 'Admin' : 'Staff'}</small></div>
        </div>
        <nav>
          {groups.map(g => (
            <div className="grp" key={g.title}>
              <div className="grp-title">{g.title}</div>
              {g.items.map(([p, label]) => (
                <NavLink key={p} end={p === ''} to={`${base}/${p}`}>{label}</NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="me">
          <span>{u?.name}</span>
          <button className="ghost" onClick={() => { localStorage.clear(); nav('/login'); }}>Log out</button>
        </div>
      </aside>
      <main><Outlet /></main>
    </div>
  );
}

function Guard({ admin, base, groups }) {
  const u = getUser();
  if (!u) return <Navigate to="/login" replace />;
  if (admin && u.role !== 'admin') return <Navigate to="/users" replace />;
  return <Shell base={base} groups={groups} />;
}

const adminNav = [
  { title: 'Overview', items: [['', 'Dashboard']] },
  { title: 'Operations', items: [['inbox', 'Inbox'], ['jobs', 'Jobs']] },
  { title: 'Pricing and partners', items: [['prices', 'Prices'], ['partners', 'Partners']] },
  { title: 'Finance', items: [['expenses', 'Expenses']] },
  { title: 'Admin', items: [['users', 'Users']] },
];
const staffNav = [
  { title: 'Overview', items: [['', 'Dashboard']] },
  { title: 'Operations', items: [['inbox', 'Inbox'], ['jobs', 'Jobs']] },
  { title: 'Pricing', items: [['prices', 'Prices']] },
];

export default function App() {
  const u = getUser();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/admin" element={<Guard admin base="/admin" groups={adminNav} />}>
        <Route index element={<Dashboard />} />
        <Route path="inbox" element={<Inbox admin />} />
        <Route path="jobs" element={<Jobs admin />} />
        <Route path="prices" element={<Prices admin />} />
        <Route path="partners" element={<Partners />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="users" element={<Users />} />
      </Route>
      <Route path="/users" element={<Guard base="/users" groups={staffNav} />}>
        <Route index element={<Dashboard />} />
        <Route path="inbox" element={<Inbox />} />
        <Route path="jobs" element={<Jobs />} />
        <Route path="prices" element={<Prices />} />
      </Route>
      <Route path="*" element={<Navigate to={u ? (u.role === 'admin' ? '/admin' : '/users') : '/login'} replace />} />
    </Routes>
  );
}
