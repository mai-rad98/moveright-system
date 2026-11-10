import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, getUser, isManager, roleName } from './api.js';
import Dashboard from './Dashboard.jsx';
import Icon from './Icon.jsx';
import { Inbox, Jobs, Prices, Partners, Expenses } from './pages.jsx';
import { Employees, MyDocuments } from './Employees.jsx';
import { Payroll, MyPayslips } from './Payroll.jsx';
import Quotes from './Quotes.jsx';
import Module from './Module.jsx';

const Finance = () => (
  <Module title="Financial reports" report="finance"
    note="Income statement, key ratios and trends for the chosen dates, compared with the period before. Export as PDF or Excel above.">
    {() => null}
  </Module>
);

const COUNT_TITLES = { due: 'Follow-ups due', quotes: 'New quote requests and customer replies to answer' };

// Where each role lands after logging in
const home = u => (!u ? '/login' : isManager(u) ? '/admin' : '/users');

function Login() {
  const nav = useNavigate();
  const [f, setF] = useState({ email: '', password: '' });
  const [err, setErr] = useState('');
  const go = async e => {
    e.preventDefault();
    try {
      const r = await api('/auth/login', { method: 'POST', body: f });
      localStorage.setItem('mr_token', r.token); localStorage.setItem('mr_user', JSON.stringify(r.user));
      nav(home(r.user));
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
  const loc = useLocation();
  const u = getUser();
  const [mini, setMini] = useState(() => { try { return localStorage.getItem('mr_side') === 'mini'; } catch { return false; } });
  const [open, setOpen] = useState(false);                 // phone: sidebar drawer
  const [counts, setCounts] = useState({});
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => {                                        // small numbers: follow-ups due (Inbox), quotes to answer (Email Quotes)
    const uses = key => groups.some(g => g.items.some(i => i[3] === key));
    if (uses('due')) api('/interactions/follow-ups').then(d => setCounts(c => ({ ...c, due: d.length }))).catch(() => {});
    if (uses('quotes')) api('/quotes/count').then(d => setCounts(c => ({ ...c, quotes: d.count }))).catch(() => {});
  }, [loc.pathname]);
  const toggle = () => setMini(m => { try { localStorage.setItem('mr_side', m ? '' : 'mini'); } catch {} return !m; });
  const logout = () => { localStorage.removeItem('mr_token'); localStorage.removeItem('mr_user'); nav('/login'); };
  const here = loc.pathname.replace(/\/$/, '');
  const current = groups.flatMap(g => g.items.map(i => ({ group: g.title, label: i[1], path: `${base}/${i[0]}`.replace(/\/$/, '') })))
    .find(i => i.path === here);
  const initials = (u?.name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const role = roleName(u?.role);
  // pick up a role that was changed since logging in (the server already applies it)
  useEffect(() => {
    api('/auth/me').then(me => {
      if (!me || me.role === u?.role) return;
      localStorage.setItem('mr_user', JSON.stringify({ ...u, name: me.name, role: me.role }));
      nav(home(me), { replace: true });
    }).catch(() => {});
  }, []);
  return (
    <div className={'shell' + (mini ? ' mini' : '') + (open ? ' open' : '')}>
      <aside className="side">
        <div className="brand">
          <img src="/logo.png" alt="MoveRight" />
          <div><strong>MoveRight</strong><small>Management System</small></div>
        </div>
        <nav>
          {groups.map(g => (
            <div className="grp" key={g.title}>
              <div className="grp-title">{g.title}</div>
              {g.items.map(([p, label, icon, count]) => (
                <NavLink key={p} end={p === ''} to={`${base}/${p}`} title={mini ? label : undefined}>
                  <Icon name={icon} /><span className="label">{label}</span>
                  {count && counts[count] > 0 && <span className="nav-count" title={COUNT_TITLES[count]}>{counts[count]}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div className="who" title={u?.name}>
            <span className="avatar">{initials}</span>
            <div><b>{u?.name}</b><small>{role}</small></div>
          </div>
          <button className="side-btn collapse-btn" onClick={toggle} title={mini ? 'Expand menu' : 'Collapse menu'}>
            <Icon name={mini ? 'expand' : 'collapse'} /><span className="label">Collapse menu</span>
          </button>
          <button className="side-btn" onClick={logout} title="Log out"><Icon name="logout" /><span className="label">Log out</span></button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />
      <div className="content">
        <header className="top">
          <button className="ghost burger" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <div className="crumbs">{current ? <>{current.group} <span>›</span> <b>{current.label}</b></> : <b>MoveRight</b>}</div>
          <span className="today">{new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
          <span className="avatar sm" title={`${u?.name} (${role})`}>{initials}</span>
        </header>
        <main><Outlet /></main>
      </div>
    </div>
  );
}

// Each area is open to certain roles only; anyone else is sent to their own area
function Guard({ roles, base, groups }) {
  const u = getUser();
  if (!u) return <Navigate to="/login" replace />;
  if (!roles.includes(u.role)) return <Navigate to={home(u)} replace />;
  return <Shell base={base} groups={typeof groups === 'function' ? groups(u) : groups} />;
}
// A page inside an area that only some of its roles may open
const Only = ({ roles, children }) => (roles.includes(getUser()?.role) ? children : <Navigate to={home(getUser())} replace />);

// [path, label, icon, count shown next to it]
const myRecords = { title: 'My records', items: [['my-payslips', 'My payslips', 'payslips'], ['my-documents', 'My documents', 'documents']] };
// Admins and operations managers
const managerNav = [
  { title: 'Overview', items: [['', 'Dashboard', 'dashboard']] },
  { title: 'Operations', items: [['inbox', 'Inbox', 'inbox', 'due'], ['quotes', 'Email Quotes', 'mail', 'quotes'], ['jobs', 'Jobs', 'jobs']] },
  { title: 'Pricing', items: [['prices', 'Prices', 'prices'], ['partners', 'Partners', 'partners']] },
  { title: 'Finance', items: [['finance', 'Financial reports', 'finance'], ['expenses', 'Expenses', 'expenses'], ['payroll', 'Payroll', 'payroll']] },
  { title: 'People', items: [['employees', 'Employees', 'employees']] },
  myRecords,
];
const MANAGERS = ['admin', 'operations manager'];
const OTHERS = ['sales and marketing', 'driver', 'cleaner', 'customer support'];
// Who answers website quote requests (same list as QUOTE_ROLES on the server)
const QUOTE_ROLES = [...MANAGERS, 'customer support', 'sales and marketing'];
// Sales and marketing, drivers, cleaners, customer support (only support and sales get Email Quotes)
const staffNav = u => [
  { title: 'Overview', items: [['', 'Dashboard', 'dashboard']] },
  { title: 'Operations', items: [['inbox', 'Inbox', 'inbox', 'due'],
    ...(QUOTE_ROLES.includes(u.role) ? [['quotes', 'Email Quotes', 'mail', 'quotes']] : []), ['jobs', 'Jobs', 'jobs']] },
  myRecords,
];

export default function App() {
  const u = getUser();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/admin" element={<Guard roles={MANAGERS} base="/admin" groups={managerNav} />}>
        <Route index element={<Dashboard />} />
        <Route path="inbox" element={<Inbox manager />} />
        <Route path="quotes" element={<Quotes manager />} />
        <Route path="jobs" element={<Jobs manager />} />
        <Route path="prices" element={<Prices manager />} />
        <Route path="partners" element={<Partners />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="finance" element={<Finance />} />
        <Route path="payroll" element={<Payroll />} />
        <Route path="employees" element={<Employees />} />
        <Route path="my-payslips" element={<MyPayslips />} />
        <Route path="my-documents" element={<MyDocuments />} />
      </Route>
      <Route path="/users" element={<Guard roles={OTHERS} base="/users" groups={staffNav} />}>
        <Route index element={<Dashboard />} />
        <Route path="inbox" element={<Inbox />} />
        <Route path="quotes" element={<Only roles={QUOTE_ROLES}><Quotes /></Only>} />
        <Route path="jobs" element={<Jobs />} />
        <Route path="my-payslips" element={<MyPayslips />} />
        <Route path="my-documents" element={<MyDocuments />} />
      </Route>
      <Route path="/me/*" element={<Navigate to={`${home(u)}/my-payslips`} replace />} />
      <Route path="*" element={<Navigate to={home(u)} replace />} />
    </Routes>
  );
}
