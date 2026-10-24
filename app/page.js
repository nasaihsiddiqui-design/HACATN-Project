'use client';
import { useState, useEffect } from 'react';
import { api, useAct, Msg, form } from '@/components/ui';
import * as V from '@/components/views';

const MENUS = {
  admin: [['dash', 'Dashboard'], ['setup', 'Company setup'], ['users', 'HR logins'], ['emps', 'Employees'], ['att', 'Attendance'], ['leave', 'Leave'], ['pay', 'Payroll'], ['ann', 'Announcements'], ['audit', 'Audit log'], ['ai', 'AI assistant'], ['profile', 'Account']],
  hr: [['dash', 'Dashboard'], ['emps', 'Employees'], ['att', 'Attendance board'], ['leave', 'Leave'], ['pay', 'Payroll'], ['setup', 'Company rules'], ['mine', 'My attendance'], ['slips', 'My payslips'], ['ann', 'Announcements'], ['ai', 'AI assistant'], ['profile', 'Account']],
  employee: [['dash', 'Dashboard'], ['mine', 'My attendance'], ['leave', 'Leave'], ['slips', 'Payslips'], ['ann', 'Announcements'], ['ai', 'AI assistant'], ['profile', 'Profile']],
};

function Auth({ children }) {
  return <div className="center"><h1>HCM Lite</h1>{children}</div>;
}

function FirstRun({ envAdmin, onDone }) {
  const a = useAct();
  const submit = (e) => { const b = form(e); a.run(async () => { await api('/setup', { method: 'POST', body: b }); onDone(); }); };
  return (
    <Auth>
      <div className="card"><h2>Set up your company</h2><p className="muted">This is a fresh install. Create the company and the Admin account.</p>
        <form onSubmit={submit}>
          <label>Company name<input name="companyName" required /></label>
          <label>Admin name<input name="name" /></label>
          <label>Admin email<input name="email" type="email" required={!envAdmin} placeholder={envAdmin ? 'taken from ADMIN_EMAIL if empty' : ''} /></label>
          <label>Admin password (8+ characters)<input name="password" type="password" minLength={8} required={!envAdmin} /></label>
          <button className="primary" disabled={a.busy}>Create company</button>
        </form><Msg m={a.m} /></div>
    </Auth>
  );
}

function Login({ company, onLogin }) {
  const a = useAct();
  const submit = (e) => { const b = form(e); a.run(async () => { const r = await api('/auth/login', { method: 'POST', body: b }); localStorage.setItem('hcm_token', r.token); onLogin(r.user); }); };
  return (
    <Auth>
      <div className="card"><h2>Sign in{company ? ` to ${company}` : ''}</h2>
        <form onSubmit={submit}><label>Email<input name="email" type="email" required autoFocus /></label><label>Password<input name="password" type="password" required /></label>
          <button className="primary" disabled={a.busy}>Sign in</button></form><Msg m={a.m} /></div>
    </Auth>
  );
}

function MustChange({ onDone, onLogout }) {
  const a = useAct();
  const submit = (e) => { const b = form(e); a.run(async () => { await api('/auth/change-password', { method: 'POST', body: b }); onDone(); }); };
  return (
    <Auth>
      <div className="card"><h2>Choose a new password</h2><p className="muted">You signed in with a temporary password. Set your own to continue.</p>
        <form onSubmit={submit}><label>Temporary password<input name="oldPassword" type="password" required /></label><label>New password (8+ characters)<input name="newPassword" type="password" minLength={8} required /></label>
          <div className="row"><button className="primary" disabled={a.busy}>Save password</button><button type="button" onClick={onLogout}>Sign out</button></div></form><Msg m={a.m} /></div>
    </Auth>
  );
}

function Bell() {
  const [d, setD] = useState({ items: [], unread: 0 }); const [open, setOpen] = useState(false);
  const load = () => api('/notifications').then(setD).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  const toggle = async () => { setOpen(!open); if (!open && d.unread) { await api('/notifications/read', { method: 'POST' }); setTimeout(load, 1500); } };
  return (
    <div className="bell"><button onClick={toggle} aria-label="Notifications">Notifications{d.unread > 0 && <span className="n">{d.unread}</span>}</button>
      {open && <div className="pop">{d.items.length ? d.items.map((n) => <div key={n._id}><b>{n.title}</b><div className="muted small">{n.body}</div></div>) : <div className="muted">No notifications yet.</div>}</div>}</div>
  );
}

export default function Home() {
  const [boot, setBoot] = useState(null); const [user, setUser] = useState(null); const [page, setPage] = useState('dash');
  const loadBoot = async () => {
    try {
      const st = await api('/setup/status'); setBoot(st);
      if (st.done && localStorage.getItem('hcm_token')) { try { setUser((await api('/auth/me')).user); } catch { localStorage.removeItem('hcm_token'); } }
    } catch (e) { setBoot({ error: e.message }); }
  };
  useEffect(() => { loadBoot(); }, []);
  const logout = () => { localStorage.removeItem('hcm_token'); setUser(null); setPage('dash'); };

  if (!boot) return <Auth><p className="muted">Loading…</p></Auth>;
  if (boot.error) return <Auth><div className="err">{boot.error}. Check MONGODB_URI and JWT_SECRET in your environment.</div></Auth>;
  if (!boot.done) return <FirstRun envAdmin={boot.envAdmin} onDone={loadBoot} />;
  if (!user) return <Login company={boot.company} onLogin={setUser} />;
  if (user.mustChange) return <MustChange onDone={async () => setUser((await api('/auth/me')).user)} onLogout={logout} />;

  const menu = MENUS[user.role]; const title = menu.find((m) => m[0] === page)?.[1];
  const views = {
    dash: <V.Dashboard user={user} go={setPage} />, setup: <V.SetupView user={user} />, users: <V.UsersView />, emps: <V.EmployeesView user={user} />,
    att: <V.AttendanceView user={user} />, mine: <V.MineView user={user} />, leave: <V.LeaveView user={user} />, pay: <V.PayrollView user={user} />,
    slips: <V.SlipsView />, ann: <V.AnnView user={user} />, audit: <V.AuditView />, ai: <V.AssistantView user={user} />, profile: <V.ProfileView user={user} />,
  };
  return (
    <div className="shell">
      <nav className="side" aria-label="Main menu"><h2>HCM Lite</h2><small>{boot.company}</small>
        {menu.map(([k, l]) => <button key={k} className={page === k ? 'on' : ''} onClick={() => setPage(k)}>{l}</button>)}</nav>
      <main className="main">
        <div className="top"><h1>{title}</h1><div className="row"><Bell /><span className="muted small">{user.name} · {user.role}</span><button onClick={logout}>Sign out</button></div></div>
        {views[page]}
      </main>
    </div>
  );
}
