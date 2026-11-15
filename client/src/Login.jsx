import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, home } from './api.js';
import Icon from './Icon.jsx';

// Sign-in page in the same blue-and-orange style as the customer website
export default function Login() {
  const nav = useNavigate();
  const [f, setF] = useState({ email: '', password: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async e => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await api('/auth/login', { method: 'POST', body: f });
      localStorage.setItem('mr_token', r.token); localStorage.setItem('mr_user', JSON.stringify(r.user));
      nav(home(r.user));
    } catch (x) { setErr(x.message); setBusy(false); }
  };

  return (
    <div className="auth">
      {/* brand side: dark "command centre" panel */}
      <section className="auth-brand">
        <div className="auth-glow navy" aria-hidden />
        <div className="auth-glow orange" aria-hidden />
        <div className="auth-grid" aria-hidden />
        <div className="auth-brand-in">
          <div className="auth-logo">
            <img src="/logo.png" alt="" />
            <div><strong>MoveRight</strong><small>Management System</small></div>
          </div>
          <span className="auth-chip"><span className="auth-eyebrow"><i />Staff portal · Secure sign-in</span></span>
          <h1>Every move.<br /><span className="auth-gradient">One system.</span></h1>
          <p className="auth-lead">Enquiries, jobs, pricing, payroll and reports for the MoveRight team in Gaborone and beyond.</p>

          {/* decorative: a route being driven, like the website's live-move card */}
          <div className="auth-demo" aria-hidden>
            <span className="auth-float one"><Icon name="inbox" size={14} />Inbox & follow-ups</span>
            <span className="auth-float two"><Icon name="finance" size={14} />Payroll & reports</span>
            <div className="auth-card">
              <div className="auth-card-h">
                <span>LIVE OPERATIONS · MR-0042</span>
                <b><i />IN TRANSIT</b>
              </div>
              <div className="auth-map">
                <svg viewBox="0 0 320 120" fill="none">
                  <path d="M24 96 C 84 96, 84 34, 160 44 S 250 24, 296 22" stroke="rgb(255 255 255 / .12)" strokeWidth="6" strokeLinecap="round" />
                  <path d="M24 96 C 84 96, 84 34, 160 44" stroke="#f47920" strokeWidth="3" strokeLinecap="round" />
                  <path className="auth-dash" d="M160 44 S 250 24, 296 22" stroke="#f47920" strokeOpacity=".6" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="6 6" />
                  <circle cx="24" cy="96" r="6" fill="#0b1233" stroke="#f47920" strokeWidth="3" />
                  <circle cx="296" cy="22" r="6" fill="#0b1233" stroke="#fff" strokeOpacity=".7" strokeWidth="3" />
                </svg>
                <span className="auth-truck"><Icon name="jobs" size={15} /></span>
              </div>
              <div className="auth-stops">
                <span><i className="from" />Gaborone</span>
                <span><i className="to" />Ramotswa</span>
                <span className="auth-chip-sm"><Icon name="jobs" size={13} />Jobs & routes</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* sign-in side */}
      <section className="auth-side">
        <form className="auth-form" onSubmit={go}>
          <h2>Welcome back</h2>
          <p className="auth-sub">Sign in with your work email.</p>
          <label htmlFor="email">Email</label>
          <div className="auth-field">
            <Icon name="mail" size={17} />
            <input id="email" type="email" autoComplete="username" required autoFocus placeholder="you@moveright.co.bw"
              value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
          </div>
          <label htmlFor="password">Password</label>
          <div className="auth-field">
            <Icon name="lock" size={17} />
            <input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" required placeholder="Your password"
              value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
            <button type="button" className="auth-eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
              <Icon name={show ? 'eyeOff' : 'eye'} size={17} />
            </button>
          </div>
          {err && <p className="auth-err" role="alert">{err}</p>}
          <button className="auth-btn" disabled={busy}>{busy ? 'Signing in…' : <>Sign in <Icon name="arrow" size={17} /></>}</button>
          <p className="auth-help">Forgot your password? Ask an admin or operations manager to reset it on the Employees page.</p>
        </form>
        <p className="auth-foot">© {new Date().getFullYear()} MoveRight · Gaborone, Botswana</p>
      </section>
    </div>
  );
}
