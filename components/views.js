'use client';
import { useState, useEffect, useRef } from 'react';
import { api, useLoad, useAct, Msg, Card, Load, Kpi, Table, Badge, Bars, Line, money, hm, today, download, form } from './ui';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString();

/* ============ Check-in widget (web) ============ */
export function CheckWidget({ onChange }) {
  const s = useLoad(() => api('/attendance/today'));
  const a = useAct(); const [geo, setGeo] = useState(false);
  const rec = s.data?.record;
  const getPos = () => new Promise((res, rej) => navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }), () => rej(new Error('Could not read your location')), { enableHighAccuracy: true, timeout: 10000 }));
  const go = (kind) => a.run(async () => {
    const body = kind === 'checkin' && geo ? await getPos() : {};
    await api('/attendance/' + kind, { method: 'POST', body });
    await s.reload(); onChange && onChange();
  }, kind === 'checkin' ? 'Checked in. The server recorded the time.' : 'Checked out. Have a good evening.');
  return (
    <Card title="Today">
      <Load s={s}>
        <p>{!rec ? 'You have not checked in yet.' : <>Checked in at <b>{hm(rec.checkIn)}</b> <Badge v={rec.status} />{rec.checkOut && <> · out at <b>{hm(rec.checkOut)}</b> ({rec.hours} h)</>}</>}</p>
        <div className="row">
          <button className="primary" disabled={a.busy || !!rec} onClick={() => go('checkin')}>Check in</button>
          <button disabled={a.busy || !rec || !!rec?.checkOut} onClick={() => go('checkout')}>Check out</button>
          <label className="chk" style={{ margin: 0 }}><input type="checkbox" checked={geo} onChange={(e) => setGeo(e.target.checked)} /> Verify my location</label>
        </div>
        <Msg m={a.m} />
      </Load>
    </Card>
  );
}

/* ============ Dashboards ============ */
function Announcements({ list }) {
  if (!list?.length) return null;
  return <Card title="Announcements">{list.map((a) => <div className="ann" key={a._id}><b>{a.title}</b><div>{a.body}</div><span className="muted small">{a.by} · {new Date(a.at).toLocaleDateString()}</span></div>)}</Card>;
}

function EmpDash({ go }) {
  const s = useLoad(() => api('/dashboard'));
  return (
    <Load s={s}>{s.data && <>
      <Announcements list={s.data.announcements} />
      <CheckWidget onChange={s.reload} />
      <div className="grid g3" style={{ marginBottom: '1rem' }}>
        <Kpi label="Hours this week" value={s.data.hoursWeek} sub={`of ${s.data.target} h`} />
        <Kpi label="Late days this month" value={s.data.lateCount} tone="amber" />
        <Kpi label="Attendance this month" value={s.data.month.attendanceRate + '%'} />
        <Kpi label="Last payslip" value={s.data.lastPayslip ? money(s.data.lastPayslip.net) : '—'} sub={s.data.lastPayslip?.month || 'none yet'} tone="violet" />
      </div>
      <Card title="Leave left this year">
        <div className="grid g3">{s.data.balance.map((b) => <Kpi key={b.key} label={b.name} value={b.left == null ? '∞' : b.left} sub={b.quota == null ? 'unlimited' : `${b.used} used · ${b.pending} pending of ${b.quota}`} />)}</div>
      </Card>
      <button className="ai" onClick={() => go('ai')}>Ask my assistant</button>
    </>}</Load>
  );
}

function CompanyDash({ user }) {
  const [f, setF] = useState({ from: '', to: '', deptId: '' });
  const depts = useLoad(() => api('/lookup/departments'));
  const q = qs(f);
  const s = useLoad(() => api('/dashboard?' + q), [q]);
  const a = useAct(); const [sum, setSum] = useState(null);
  const summarize = () => a.run(async () => { const r = await api('/ai/summary', { method: 'POST', body: f }); setSum(r); if (!r.ok) throw new Error(r.answer); });
  const k = s.data?.kpis, x = s.data?.extras;
  return (
    <>
      <Card title="Filters">
        <div className="grid g3">
          <label>From<input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
          <label>To<input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
          <label>Department<select value={f.deptId} onChange={(e) => setF({ ...f, deptId: e.target.value })}><option value="">All</option>{(depts.data || []).map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</select></label>
        </div>
        <p className="muted small">Empty dates mean this month so far.</p>
      </Card>
      <Load s={s}>{k && <>
        <Announcements list={s.data.announcements} />
        <div className="grid g3" style={{ marginBottom: '1rem' }}>
          <Kpi label="Headcount" value={k.headcount} />
          <Kpi label="Present today" value={k.today.present} />
          <Kpi label="On leave today" value={k.today.onLeave} tone="violet" />
          <Kpi label="Late today" value={k.today.late} tone="amber" />
          <Kpi label="Pending approvals" value={k.pendingApprovals} tone="amber" />
          <Kpi label="Attendance rate" value={k.attendanceRate + '%'} />
          {user.role === 'admin' && x && <>
            <Kpi label="Attrition" value={k.attritionPct + '%'} sub={`${k.exits} exit(s)`} tone="red" />
            <Kpi label="Payroll cost (net)" value={money(x.payrollCost)} tone="violet" />
            <Kpi label="Average gross salary" value={money(x.avgSalary)} />
          </>}
        </div>
        <Card title="AI summary" right={<button className="ai sm" disabled={a.busy} onClick={summarize}>{a.busy ? 'Summarizing…' : 'Summarize'}</button>}>
          {sum?.bullets?.length ? <><ul>{sum.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul><span className="tag">{sum.label}</span></> : <p className="muted">Click Summarize for 3–5 insights from the numbers on this page.</p>}
          <Msg m={a.m} />
        </Card>
        <div className="cols">
          <Card title="Attendance trend"><Line data={k.trend} /></Card>
          <Card title="Absenteeism by department (%)"><Bars data={k.byDept} label="dept" value="absenteeism" suffix="%" /></Card>
          <Card title="Leave by type (approved days)"><Bars data={k.leaveByType} label="type" value="days" /></Card>
          <Card title="Top 5 late-comers"><Table cols={[{ h: 'Employee', k: 'name' }, { h: 'Late days', k: 'late' }]} rows={k.topLate} empty="No late arrivals in this range." /></Card>
          {user.role === 'admin' && x && <>
            <Card title="Headcount by department"><Bars data={k.byDept} label="dept" value="headcount" /></Card>
            <Card title="Payroll cost by department (net)"><Bars data={x.payByDept} label="dept" value="net" empty="No payroll run in this range." /></Card>
            <Card title="Average gross by department"><Bars data={x.avgSalaryByDept} label="dept" value="avg" /></Card>
            <Card title="Gender"><Bars data={x.gender} /></Card>
            <Card title="Tenure"><Bars data={x.tenure} /></Card>
            <Card title="Recent activity"><Table cols={[{ h: 'When', f: (r) => new Date(r.at).toLocaleString() }, { h: 'Who', k: 'actor' }, { h: 'Action', f: (r) => `${r.action} ${r.entity}` }]} rows={x.audit} empty="No activity yet." /></Card>
          </>}
        </div>
      </>}</Load>
    </>
  );
}
export const Dashboard = ({ user, go }) => user.role === 'employee' ? <EmpDash go={go} /> : <CompanyDash user={user} />;

/* ============ Company setup ============ */
function Lookup({ kind, title, fields, ro }) {
  const s = useLoad(() => api('/lookup/' + kind), [kind]); const a = useAct();
  const add = (e) => { const b = form(e); const t = e.target; a.run(async () => { await api('/lookup/' + kind, { method: 'POST', body: b }); t.reset(); s.reload(); }, 'Saved'); };
  const del = (id) => confirm('Delete this item?') && a.run(async () => { await api(`/lookup/${kind}/${id}`, { method: 'DELETE' }); s.reload(); }, 'Deleted');
  return (
    <Card title={title}>
      {!ro && <form className="row" onSubmit={add}>{fields.map((f) => <input key={f.n} name={f.n} type={f.t || 'text'} placeholder={f.p} required={!f.opt} style={{ flex: 1, minWidth: 110 }} />)}<button className="primary" disabled={a.busy}>Add</button></form>}
      <Msg m={a.m} />
      <Load s={s} empty="Nothing added yet.">
        <Table cols={[...fields.map((f) => ({ h: f.p, f: (r) => r[f.n] ?? (f.n === 'quota' ? 'unlimited' : '') })), ...(ro ? [] : [{ h: '', f: (r) => <button className="danger sm" onClick={() => del(r._id)}>Delete</button> }])]} rows={s.data} />
      </Load>
    </Card>
  );
}
export function SetupView({ user }) {
  const ro = user.role !== 'admin';
  const s = useLoad(() => api('/settings')); const a = useAct();
  const save = (e) => { const b = form(e); b.weekend = [...e.target.querySelectorAll('input[name=wk]:checked')].map((c) => +c.value); delete b.wk; a.run(async () => { await api('/settings', { method: 'PUT', body: b }); s.reload(); }, 'Settings saved. New rules apply to new records only.'); };
  const here = () => navigator.geolocation.getCurrentPosition((p) => { const f = document.getElementById('setup'); f.lat.value = p.coords.latitude; f.lng.value = p.coords.longitude; }, () => a.setM({ err: 'Could not read your location' }));
  return (
    <>
      <Card title="Company settings">
        <Load s={s}>{s.data && <form id="setup" onSubmit={save}>
          <div className="grid g3">
            <label>Company name<input name="companyName" defaultValue={s.data.companyName} disabled={ro} /></label>
            <label>Office start<input name="officeStart" type="time" defaultValue={s.data.officeStart} disabled={ro} /></label>
            <label>Grace (minutes)<input name="graceMin" type="number" min="0" defaultValue={s.data.graceMin} disabled={ro} /></label>
            <label>Half day under (hours)<input name="halfDayHours" type="number" min="0" step="0.5" defaultValue={s.data.halfDayHours} disabled={ro} /></label>
            <label>Office latitude<input name="lat" defaultValue={s.data.lat ?? ''} disabled={ro} /></label>
            <label>Office longitude<input name="lng" defaultValue={s.data.lng ?? ''} disabled={ro} /></label>
            <label>Radius (metres)<input name="radius" type="number" min="1" defaultValue={s.data.radius} disabled={ro} /></label>
          </div>
          <div className="row" style={{ marginBottom: '.6rem' }}>Weekend: {WD.map((d, i) => <label className="chk" key={i} style={{ margin: 0 }}><input type="checkbox" name="wk" value={i} defaultChecked={s.data.weekend.includes(i)} disabled={ro} />{d}</label>)}</div>
          {!ro && <div className="row"><button className="primary" disabled={a.busy}>Save settings</button><button type="button" onClick={here}>Use my current location</button></div>}
          <Msg m={a.m} />
        </form>}</Load>
      </Card>
      <div className="cols">
        <Lookup ro={ro} kind="departments" title="Departments" fields={[{ n: 'name', p: 'Name' }]} />
        <Lookup ro={ro} kind="designations" title="Designations" fields={[{ n: 'name', p: 'Name' }]} />
        <Lookup ro={ro} kind="leavetypes" title="Leave types and yearly quotas" fields={[{ n: 'key', p: 'Key' }, { n: 'name', p: 'Name' }, { n: 'quota', p: 'quota', t: 'number', opt: true }]} />
        <Lookup ro={ro} kind="holidays" title="Public holidays" fields={[{ n: 'date', p: 'Date', t: 'date' }, { n: 'name', p: 'Name' }]} />
      </div>
    </>
  );
}

/* ============ Logins (admin) ============ */
export function UsersView() {
  const s = useLoad(() => api('/users')); const a = useAct();
  const create = (e) => { const b = form(e), t = e.target; a.run(async () => { const r = await api('/users/hr', { method: 'POST', body: b }); t.reset(); s.reload(); return r; }, (r) => `HR login created for ${r.email}. Temporary password (shown once): ${r.tempPassword}`); };
  const toggle = (u) => a.run(async () => { await api(`/users/${u.id}/active`, { method: 'POST', body: { active: !u.active } }); s.reload(); }, u.active ? 'Login deactivated' : 'Login activated');
  const reset = (u) => a.run(() => api(`/users/${u.id}/reset`, { method: 'POST' }), (r) => `New temporary password for ${r.email}: ${r.tempPassword}`);
  return (
    <>
      <Card title="Create HR login">
        <form onSubmit={create}><div className="grid g3">
          <label>Name<input name="name" required /></label><label>Email<input name="email" type="email" required /></label>
          <label>Basic salary (optional)<input name="basic" type="number" min="0" /></label>
        </div><button className="primary" disabled={a.busy}>Create HR login</button></form>
        <Msg m={a.m} />
      </Card>
      <Card title="All logins"><Load s={s}><Table cols={[{ h: 'Name', k: 'name' }, { h: 'Email', k: 'email' }, { h: 'Role', f: (u) => <Badge v={u.role} /> }, { h: 'Status', f: (u) => <Badge v={u.active ? 'active' : 'exited'} /> },
        { h: '', f: (u) => u.role !== 'admin' && <div className="row"><button className="sm" onClick={() => toggle(u)}>{u.active ? 'Deactivate' : 'Activate'}</button><button className="sm" onClick={() => reset(u)}>Reset password</button></div> }]} rows={s.data} /></Load></Card>
    </>
  );
}

/* ============ Employees ============ */
function Employee360({ id, role, onClose, onSaved, depts }) {
  const s = useLoad(() => api('/employees/' + id), [id]); const a = useAct();
  const e = s.data?.employee;
  const save = (ev) => { const b = form(ev); a.run(async () => { await api('/employees/' + id, { method: 'PUT', body: b }); s.reload(); onSaved(); }, 'Employee updated'); };
  return (
    <Card title="Employee 360" right={<button className="sm" onClick={onClose}>Close</button>}>
      <Load s={s}>{e && <>
        <h3>{e.name} <Badge v={e.status} /></h3>
        <p className="muted">{e.code} · {e.designation} · {e.department} · joined {e.joinDate} · {e.email} · {e.phone || 'no phone'}</p>
        <div className="grid g3">
          <Kpi label="Attendance (30 days)" value={s.data.last30.attendanceRate + '%'} />
          <Kpi label="Late days" value={s.data.last30.late} tone="amber" /><Kpi label="Absent days" value={s.data.last30.absent} tone="red" />
          <Kpi label="Basic salary" value={money(e.basic)} tone="violet" />
        </div>
        <h3 style={{ marginTop: '1rem' }}>Leave balance</h3>
        <Table cols={[{ h: 'Type', k: 'name' }, { h: 'Quota', f: (b) => b.quota ?? '∞' }, { h: 'Used', k: 'used' }, { h: 'Pending', k: 'pending' }, { h: 'Left', f: (b) => b.left ?? '∞' }]} rows={s.data.balance} />
        {role === 'hr' && <form onSubmit={save} style={{ marginTop: '1rem' }}><h3>Edit details and salary</h3><div className="grid g3">
          <label>Basic salary<input name="basic" type="number" defaultValue={e.basic} /></label>
          <label>Designation<input name="designation" defaultValue={e.designation} /></label>
          <label>Department<select name="deptId" defaultValue={e.deptId || ''}>{depts.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</select></label>
          <label>Status<select name="status" defaultValue={e.status}><option>probation</option><option>active</option><option>exited</option></select></label>
          <label>Exit date<input name="exitDate" type="date" defaultValue={e.exitDate || ''} /></label>
          <label>Phone<input name="phone" defaultValue={e.phone} /></label>
        </div><button className="primary" disabled={a.busy}>Save changes</button></form>}
        <Msg m={a.m} />
      </>}</Load>
    </Card>
  );
}
export function EmployeesView({ user }) {
  const [f, setF] = useState({ q: '', deptId: '', status: '', page: 1 });
  const depts = useLoad(() => api('/lookup/departments')); const desg = useLoad(() => api('/lookup/designations'));
  const q = qs(f); const s = useLoad(() => api('/employees?' + q), [q]);
  const [sel, setSel] = useState(null); const [add, setAdd] = useState(false);
  const a = useAct(); const [csv, setCsv] = useState(''); const [rep, setRep] = useState(null);
  const create = (e) => { const b = form(e), t = e.target; a.run(async () => { const r = await api('/employees', { method: 'POST', body: b }); t.reset(); s.reload(); return r; }, (r) => `${r.employee.name} registered. Login: ${r.employee.email} · temporary password (shown once): ${r.tempPassword}`); };
  const imp = (dry) => a.run(async () => { const r = await api('/employees/import', { method: 'POST', body: { csv, dryRun: dry } }); setRep(r); if (!dry) { s.reload(); } return r; }, (r) => dry ? (r.ok ? `Dry run passed: ${r.rows} row(s) are valid.` : `Dry run found ${r.errors.length} problem(s), see below.`) : `${r.created} employees imported. Temporary passwords: ${r.credentials.map((c) => c.email + ' / ' + c.tempPassword).join(' ; ')}`);
  const exp = () => a.run(async () => { const r = await api('/employees/export'); download('employees.csv', r.csv); });
  const dl = depts.data || [];
  return (
    <>
      <Card title="Employees" right={user.role === 'hr' && <div className="row"><button className="primary sm" onClick={() => setAdd(!add)}>{add ? 'Close form' : 'Register employee'}</button><button className="sm" onClick={exp}>Export CSV</button></div>}>
        <div className="grid g3">
          <label>Search<input placeholder="name, code or email" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} /></label>
          <label>Department<select value={f.deptId} onChange={(e) => setF({ ...f, deptId: e.target.value, page: 1 })}><option value="">All</option>{dl.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</select></label>
          <label>Status<select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}><option value="">All</option><option>probation</option><option>active</option><option>exited</option></select></label>
        </div>
        <Load s={s} empty="No employees yet. HR registers employees from this page.">{s.data && <>
          <Table cols={[{ h: 'Code', k: 'code' }, { h: 'Name', f: (e) => <a href="#" onClick={(ev) => { ev.preventDefault(); setSel(e._id); }}>{e.name}</a> }, { h: 'Department', k: 'department' }, { h: 'Designation', k: 'designation' }, { h: 'Status', f: (e) => <Badge v={e.status} /> }]} rows={s.data.items} />
          <div className="row" style={{ marginTop: '.6rem' }}><button className="sm" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>Previous</button><span className="muted small">Page {s.data.page} · {s.data.total} total</span><button className="sm" disabled={s.data.page * s.data.limit >= s.data.total} onClick={() => setF({ ...f, page: f.page + 1 })}>Next</button></div>
        </>}</Load>
      </Card>
      {sel && <Employee360 id={sel} role={user.role} depts={dl} onClose={() => setSel(null)} onSaved={s.reload} />}
      {user.role === 'hr' && add && <>
        <Card title="Register employee">
          <form onSubmit={create}><div className="grid g3">
            <label>Employee code<input name="code" required /></label><label>Name<input name="name" required /></label><label>Email<input name="email" type="email" required /></label>
            <label>Department<select name="deptId" required><option value="">Choose…</option>{dl.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</select></label>
            <label>Designation<input name="designation" list="desg" required /><datalist id="desg">{(desg.data || []).map((d) => <option key={d._id} value={d.name} />)}</datalist></label>
            <label>Join date<input name="joinDate" type="date" defaultValue={today()} required /></label>
            <label>Basic salary<input name="basic" type="number" min="1" required /></label>
            <label>Gender<select name="gender"><option value="">—</option><option>female</option><option>male</option><option>other</option></select></label>
            <label>Phone<input name="phone" /></label>
          </div><button className="primary" disabled={a.busy}>Register and create login</button></form>
        </Card>
        <Card title="CSV import">
          <p className="muted small">Columns: code, name, email, department, designation, joinDate, basic (optional: gender, phone). Run a dry run first.</p>
          <input type="file" accept=".csv" onChange={(e) => e.target.files[0]?.text().then(setCsv)} />
          <textarea rows={4} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="Or paste CSV text here" style={{ marginTop: '.5rem' }} />
          <div className="row" style={{ marginTop: '.5rem' }}><button disabled={a.busy || !csv} onClick={() => imp(true)}>Dry run</button><button className="primary" disabled={a.busy || !csv} onClick={() => imp(false)}>Import</button></div>
          {rep?.errors?.length > 0 && <Table cols={[{ h: 'Row', k: 'row' }, { h: 'Field', k: 'field' }, { h: 'Reason', k: 'reason' }]} rows={rep.errors} />}
        </Card>
      </>}
      <Msg m={a.m} />
    </>
  );
}

/* ============ Attendance ============ */
export function AttendanceView({ user }) {
  const [date, setDate] = useState(today()); const [deptId, setDeptId] = useState('');
  const depts = useLoad(() => api('/lookup/departments'));
  const s = useLoad(() => api('/attendance/board?' + qs({ date, deptId })), [date, deptId]);
  return (
    <>
      <Card title="Daily attendance board">
        <div className="grid g3"><label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Department<select value={deptId} onChange={(e) => setDeptId(e.target.value)}><option value="">All</option>{(depts.data || []).map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</select></label></div>
        <Load s={s} empty="No employees on this date.">
          <Table cols={[{ h: 'Code', k: 'code' }, { h: 'Name', k: 'name' }, { h: 'Department', k: 'department' }, { h: 'Status', f: (r) => <Badge v={r.status} /> }, { h: 'In', f: (r) => hm(r.checkIn) }, { h: 'Out', f: (r) => hm(r.checkOut) }, { h: 'Hours', k: 'hours' }, { h: 'Source', k: 'source' }]} rows={s.data} />
        </Load>
      </Card>
      <Corrections user={user} />
    </>
  );
}
function Corrections({ user }) {
  const s = useLoad(() => api('/corrections')); const a = useAct();
  const decide = (id, approve) => { const comment = prompt(approve ? 'Comment (optional)' : 'Reason for rejecting') || ''; a.run(async () => { await api(`/corrections/${id}/decision`, { method: 'POST', body: { approve, comment } }); s.reload(); }, approve ? 'Approved' : 'Rejected'); };
  return (
    <Card title="Attendance corrections"><Msg m={a.m} />
      <Load s={s} empty="No correction requests.">
        <Table cols={[{ h: 'Employee', f: (c) => c.employee }, { h: 'Date', k: 'date' }, { h: 'In', f: (c) => c.checkIn || '—' }, { h: 'Out', f: (c) => c.checkOut || '—' }, { h: 'Reason', f: (c) => <span className="wrap">{c.reason}</span> }, { h: 'Status', f: (c) => <Badge v={c.status} /> },
          { h: '', f: (c) => user.role === 'hr' && c.status === 'pending' && c.employeeId !== user.employeeId && <div className="row"><button className="primary sm" onClick={() => decide(c._id, true)}>Approve</button><button className="danger sm" onClick={() => decide(c._id, false)}>Reject</button></div> }]} rows={s.data} />
      </Load>
    </Card>
  );
}
export function MineView({ user }) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const cal = useLoad(() => api('/attendance/me?month=' + month), [month]);
  const cor = useLoad(() => api('/corrections')); const a = useAct();
  const req = (e) => { const b = form(e), t = e.target; a.run(async () => { await api('/corrections', { method: 'POST', body: b }); t.reset(); cor.reload(); }, 'Request sent to HR'); };
  return (
    <>
      <CheckWidget onChange={cal.reload} />
      <Card title="My attendance" right={<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }} />}>
        <Load s={cal}><Table cols={[{ h: 'Date', f: (r) => `${r.date} ${WD[new Date(r.date + 'T00:00:00Z').getUTCDay()]}` }, { h: 'Status', f: (r) => <Badge v={r.status} /> }, { h: 'In', f: (r) => hm(r.checkIn) }, { h: 'Out', f: (r) => hm(r.checkOut) }, { h: 'Hours', k: 'hours' }]} rows={cal.data} /></Load>
      </Card>
      <Card title="Request a correction">
        <form onSubmit={req}><div className="grid g3">
          <label>Date<input name="date" type="date" max={today()} required /></label><label>Check-in time<input name="checkIn" type="time" /></label><label>Check-out time<input name="checkOut" type="time" /></label>
        </div><label>Reason<input name="reason" required /></label><button className="primary" disabled={a.busy}>Send request</button></form>
        <Msg m={a.m} />
        <Load s={cor} empty="No requests yet."><Table cols={[{ h: 'Date', k: 'date' }, { h: 'Reason', k: 'reason' }, { h: 'Status', f: (c) => <Badge v={c.status} /> }, { h: 'HR comment', k: 'comment' }]} rows={(cor.data || []).filter((c) => c.employeeId === user.employeeId)} empty="No requests yet." /></Load>
      </Card>
    </>
  );
}

/* ============ Leave ============ */
export function LeaveView({ user }) {
  const canApply = user.role !== 'admin';
  const types = useLoad(() => api('/lookup/leavetypes'));
  const bal = useLoad(() => canApply ? api('/leave/balance') : Promise.resolve([]));
  const list = useLoad(() => api('/leave'));
  const [f, setF] = useState({ type: 'casual', start: '', end: '', reason: '' });
  const [text, setText] = useState(''); const a = useAct(); const sm = useAct();
  const refresh = () => { list.reload(); bal.reload(); };
  const smart = () => sm.run(async () => { const r = await api('/ai/leave', { method: 'POST', body: { text } }); if (!r.form) throw new Error(r.answer); setF(r.form); }, 'Form pre-filled by AI. Check it, then confirm.');
  const apply = (e) => { e.preventDefault(); a.run(async () => { await api('/leave', { method: 'POST', body: f }); setF({ ...f, start: '', end: '', reason: '' }); setText(''); refresh(); }, 'Leave request sent'); };
  const cancel = (id) => a.run(async () => { await api(`/leave/${id}/cancel`, { method: 'POST' }); refresh(); }, 'Cancelled');
  const decide = (id, approve) => { const comment = prompt(approve ? 'Comment (optional)' : 'Reason for rejecting') || ''; a.run(async () => { await api(`/leave/${id}/decision`, { method: 'POST', body: { approve, comment } }); refresh(); }, approve ? 'Approved' : 'Rejected'); };
  const mgr = user.role !== 'employee';
  return (
    <>
      {canApply && <>
        <Card title="Leave balance"><Load s={bal}><div className="grid g3">{(bal.data || []).map((b) => <Kpi key={b.key} label={b.name} value={b.left == null ? '∞' : b.left} sub={b.quota == null ? 'unlimited' : `${b.used} used · ${b.pending} pending`} />)}</div></Load></Card>
        <Card title="Apply for leave">
          <div className="row" style={{ marginBottom: '.8rem' }}><input style={{ flex: 1, minWidth: 220 }} value={text} onChange={(e) => setText(e.target.value)} placeholder='e.g. "Need next Monday and Tuesday off for my sister’s wedding"' /><button className="ai" disabled={sm.busy || !text.trim()} onClick={smart}>{sm.busy ? 'Reading…' : 'Fill with AI'}</button></div>
          <Msg m={sm.m} />
          <form onSubmit={apply}><div className="grid g3">
            <label>Type<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{(types.data || []).map((t) => <option key={t._id} value={t.key}>{t.name}</option>)}</select></label>
            <label>From<input type="date" required value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
            <label>To<input type="date" required value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></label>
          </div><label>Reason<input required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
            <button className="primary" disabled={a.busy}>Send request</button></form>
          <Msg m={a.m} />
        </Card>
      </>}
      {mgr || user.role === 'admin' ? <Card title={user.role === 'admin' ? 'HR staff leave requests' : 'Leave inbox'}><Msg m={!canApply ? a.m : null} />
        <Load s={list} empty="No leave requests.">
          <Table cols={[{ h: 'Employee', k: 'employee' }, { h: 'Type', k: 'type' }, { h: 'From', k: 'start' }, { h: 'To', k: 'end' }, { h: 'Days', k: 'days' }, { h: 'Reason', f: (l) => <span className="wrap">{l.reason}</span> }, { h: 'Status', f: (l) => <Badge v={l.status} /> },
            { h: '', f: (l) => l.status === 'pending' && !l.own && (user.role === 'hr' || l.isHr) && <div className="row"><button className="primary sm" onClick={() => decide(l._id, true)}>Approve</button><button className="danger sm" onClick={() => decide(l._id, false)}>Reject</button></div> },
            { h: '', f: (l) => l.own && ['pending', 'approved'].includes(l.status) && <button className="sm" onClick={() => cancel(l._id)}>Cancel</button> }]} rows={list.data} />
        </Load></Card>
        : <Card title="My leave history"><Load s={list} empty="No leave requests yet."><Table cols={[{ h: 'Type', k: 'type' }, { h: 'From', k: 'start' }, { h: 'To', k: 'end' }, { h: 'Days', k: 'days' }, { h: 'Status', f: (l) => <Badge v={l.status} /> }, { h: 'HR comment', k: 'comment' }, { h: '', f: (l) => ['pending', 'approved'].includes(l.status) && <button className="sm" onClick={() => cancel(l._id)}>Cancel</button> }]} rows={list.data} /></Load></Card>}
    </>
  );
}

/* ============ Payroll & payslips ============ */
async function pdf(s) {
  const { jsPDF } = await import('jspdf'); const d = new jsPDF(); let y = 20;
  d.setFontSize(16); d.text(`${s.company || 'Company'} - Payslip ${s.month}`, 14, y); d.setFontSize(11);
  [['Employee', `${s.name} (${s.code})`], ['Designation', s.designation], ['Department', s.department], ['Basic', money(s.basic)], ['HRA (40%)', money(s.hra)], ['Medical (10%)', money(s.medical)], ['Gross (monthly)', money(s.gross)], ['Working days', s.workingDays], ['Days employed', s.employedDays], ['Absent days', s.absent], ['Unpaid leave days', s.unpaid], ['Half days', s.half], ['Deductions', money(s.deduction)], ['Tax', money(s.tax)], ['NET PAY', money(s.net)]]
    .forEach(([k, v]) => { y += 9; d.text(String(k), 14, y); d.text(String(v ?? ''), 110, y); });
  d.save(`payslip-${s.code}-${s.month}.pdf`);
}
export function PayrollView({ user }) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const runs = useLoad(() => api('/payroll')); const run = useLoad(() => api('/payroll/' + month).catch(() => null), [month]); const a = useAct();
  const draft = () => a.run(async () => { await api(`/payroll/${month}/draft`, { method: 'POST' }); run.reload(); runs.reload(); }, 'Draft created from attendance and leave records');
  const fin = () => confirm(`Finalize ${month}? This locks the month.`) && a.run(async () => { await api(`/payroll/${month}/finalize`, { method: 'POST' }); run.reload(); runs.reload(); }, 'Payroll finalized and locked');
  const r = run.data;
  return (
    <>
      <Card title="Monthly payroll" right={<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }} />}>
        <div className="row">
          {user.role === 'hr' && <button className="primary" disabled={a.busy || r?.status === 'finalized'} onClick={draft}>{r ? 'Recalculate draft' : 'Create draft'}</button>}
          {user.role === 'admin' && <button className="primary" disabled={a.busy || !r || r.status === 'finalized'} onClick={fin}>Finalize payroll</button>}
          {r && <Badge v={r.status} />}
        </div>
        <Msg m={a.m} />
        {r ? <>
          <div className="grid g3" style={{ margin: '.8rem 0' }}><Kpi label="Gross earned" value={money(r.totals.gross)} /><Kpi label="Deductions" value={money(r.totals.deduction)} tone="amber" /><Kpi label="Tax" value={money(r.totals.tax)} tone="red" /><Kpi label="Net pay" value={money(r.totals.net)} tone="violet" /></div>
          <Table cols={[{ h: 'Code', k: 'code' }, { h: 'Name', k: 'name' }, { h: 'Dept', k: 'department' }, { h: 'Gross', f: (i) => money(i.gross) }, { h: 'Absent', k: 'absent' }, { h: 'Unpaid', k: 'unpaid' }, { h: 'Half', k: 'half' }, { h: 'Deduction', f: (i) => money(i.deduction) }, { h: 'Tax', f: (i) => money(i.tax) }, { h: 'Net', f: (i) => <b>{money(i.net)}</b> }]} rows={r.items} empty="No employees with a salary in this month." />
        </> : <p className="muted" style={{ marginTop: '.8rem' }}>No run for {month} yet.{user.role === 'hr' ? ' Create the draft to calculate it.' : ' HR prepares the draft; you finalize it.'}</p>}
      </Card>
      <Card title="All runs"><Load s={runs} empty="No payroll runs yet."><Table cols={[{ h: 'Month', k: 'month' }, { h: 'Status', f: (x) => <Badge v={x.status} /> }, { h: 'Net total', f: (x) => money(x.totals.net) }, { h: 'Employees', f: (x) => x.totals.employees }]} rows={runs.data} /></Load></Card>
    </>
  );
}
export function SlipsView() {
  const s = useLoad(() => api('/payslips'));
  return <Card title="My payslips"><Load s={s} empty="No payslips yet. They appear after Admin finalizes a month."><Table cols={[{ h: 'Month', k: 'month' }, { h: 'Gross', f: (p) => money(p.gross) }, { h: 'Deductions', f: (p) => money(p.deduction) }, { h: 'Tax', f: (p) => money(p.tax) }, { h: 'Net', f: (p) => <b>{money(p.net)}</b> }, { h: '', f: (p) => <button className="sm" onClick={() => pdf(p)}>Download PDF</button> }]} rows={s.data} /></Load></Card>;
}

/* ============ Announcements, audit, profile ============ */
export function AnnView({ user }) {
  const s = useLoad(() => api('/announcements')); const a = useAct();
  const post = (e) => { const b = form(e), t = e.target; a.run(async () => { await api('/announcements', { method: 'POST', body: b }); t.reset(); s.reload(); }, 'Announcement posted'); };
  return (
    <>
      {user.role !== 'employee' && <Card title="Post announcement"><form onSubmit={post}><label>Title<input name="title" required /></label><label>Message<textarea name="body" rows={3} required /></label><button className="primary" disabled={a.busy}>Post</button></form><Msg m={a.m} /></Card>}
      <Card title="Announcements"><Load s={s} empty="No announcements yet.">{(s.data || []).map((x) => <div className="ann" key={x._id}><b>{x.title}</b><div>{x.body}</div><span className="muted small">{x.by} · {new Date(x.at).toLocaleString()}</span></div>)}</Load></Card>
    </>
  );
}
export function AuditView() {
  const s = useLoad(() => api('/audit?limit=150')); const [open, setOpen] = useState(null);
  return <Card title="Audit log (read-only)"><Load s={s} empty="No activity recorded yet."><Table cols={[{ h: 'When', f: (r) => new Date(r.at).toLocaleString() }, { h: 'Actor', f: (r) => `${r.actor} (${r.role})` }, { h: 'Action', k: 'action' }, { h: 'Entity', k: 'entity' }, { h: 'Before / after', f: (r) => <button className="sm" onClick={() => setOpen(open === r._id ? null : r._id)}>{open === r._id ? 'Hide' : 'Show'}</button> }]} rows={s.data} />
    {open && (() => { const r = s.data.find((x) => x._id === open); return <pre className="card" style={{ overflow: 'auto', fontSize: '.8rem' }}>{JSON.stringify({ before: r.before, after: r.after }, null, 2)}</pre>; })()}
  </Load></Card>;
}
export function ProfileView({ user, onPassword }) {
  const s = useLoad(() => api('/employees/' + user.employeeId).catch(() => null)); const a = useAct(); const p = useAct();
  const save = (e) => { const b = form(e); a.run(() => api('/me/profile', { method: 'PUT', body: b }), 'Profile updated'); };
  const pw = (e) => { const b = form(e), t = e.target; p.run(async () => { await api('/auth/change-password', { method: 'POST', body: b }); t.reset(); }, 'Password changed'); };
  const e = s.data?.employee;
  return (
    <>
      {user.employeeId && <Card title="My profile"><Load s={s}>{e && <form onSubmit={save}>
        <p className="muted">{e.name} · {e.code} · {e.designation} · {e.department} · joined {e.joinDate}</p>
        <div className="grid g2"><label>Phone<input name="phone" defaultValue={e.phone} /></label><label>Address<input name="address" defaultValue={e.address} /></label></div>
        <button className="primary" disabled={a.busy}>Save</button><Msg m={a.m} /></form>}</Load></Card>}
      <Card title="Change password"><form onSubmit={pw}><div className="grid g2"><label>Current password<input name="oldPassword" type="password" required /></label><label>New password (8+ characters)<input name="newPassword" type="password" minLength={8} required /></label></div><button className="primary" disabled={p.busy}>Change password</button></form><Msg m={p.m} /></Card>
    </>
  );
}

/* ============ AI assistant ============ */
export function AssistantView({ user }) {
  const [msgs, setMsgs] = useState([]); const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs]);
  const send = async (t) => {
    t = (t ?? text).trim(); if (!t || busy) return; setText(''); setBusy(true);
    const next = [...msgs, { role: 'user', content: t }]; setMsgs(next);
    try { const r = await api('/ai/chat', { method: 'POST', body: { message: t, history: msgs } }); setMsgs([...next, { role: 'assistant', content: r.answer, ai: true }]); }
    catch (e) { setMsgs([...next, { role: 'assistant', content: e.message }]); } finally { setBusy(false); }
  };
  const ideas = user.role === 'employee' ? ['How many sick leaves do I have left this year?', 'What is the late rule?', 'How is tax calculated?'] : ['Who is on leave today?', 'Who came late most often this month?', 'What is this month’s attendance rate?', 'How many active employees do we have?'];
  return (
    <Card title="AI assistant">
      <p className="muted small">Answers come from your real data and only what your role may see. It never changes anything.</p>
      <div className="row" style={{ marginBottom: '.6rem' }}>{ideas.map((i) => <button key={i} className="sm" onClick={() => send(i)}>{i}</button>)}</div>
      <div className="chat">{msgs.map((m, i) => <div key={i} className={'msg ' + (m.role === 'user' ? 'u' : 'a')}>{m.content}{m.ai && <span className="tag">AI-generated</span>}</div>)}{busy && <div className="msg a">Thinking…</div>}<div ref={end} /></div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); send(); }}><input style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask in English or Roman Urdu" /><button className="ai" disabled={busy || !text.trim()}>Send</button></form>
    </Card>
  );
}
