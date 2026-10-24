import { randomUUID as uid } from 'crypto';
import { db } from './db.js';
import * as R from './rules.mjs';
import * as S from './services.js';

const LABEL = 'AI-generated';

async function llm(messages, { tools, json } = {}) {
  if (!process.env.AI_API_KEY) throw new Error('AI_API_KEY is not set');
  const base = process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1';
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.AI_API_KEY },
      body: JSON.stringify({ model: process.env.AI_MODEL || 'llama-3.3-70b-versatile', messages, temperature: 0.2, ...(tools?.length ? { tools, tool_choice: 'auto' } : {}), ...(json ? { response_format: { type: 'json_object' } } : {}) }),
    });
    if (!res.ok) throw new Error('AI provider returned ' + res.status);
    return (await res.json()).choices[0].message;
  } finally { clearTimeout(timer); }
}

async function guard(user, kind) {
  const d = await db();
  const used = await d.collection('ai_logs').countDocuments({ userId: user.id, at: { $gte: new Date(Date.now() - 3600000).toISOString() } });
  if (used >= 20) throw S.err(429, 'AI limit reached (20 requests per hour). Please try again later.');
}
async function log(user, kind, input, output, ok, ms) {
  const d = await db();
  await d.collection('ai_logs').insertOne({ _id: uid(), userId: user.id, role: user.role, kind, input, output, ok, ms, at: new Date().toISOString() });
}
const fallback = (extra = {}) => ({ answer: 'The AI assistant is unavailable right now. You can still use the dashboards and forms normally.', label: LABEL, ok: false, ...extra });

/* -------- tools: same services + same permission scope as the REST API -------- */
const period = { from: { type: 'string', description: 'YYYY-MM-DD, default start of this month' }, to: { type: 'string', description: 'YYYY-MM-DD, default today' }, department: { type: 'string', description: 'department name, optional' } };
const def = (name, description, properties = {}) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties } } });
function toolDefs(user) {
  const mgr = user.role !== 'employee';
  const all = [
    mgr && def('get_headcount', 'Current headcount (active + probation), optionally for one department', { department: period.department }),
    def('get_attendance_summary', mgr ? 'Company attendance rate, late %, absenteeism and day counts' : 'Your own attendance summary', period),
    mgr && def('get_late_comers', 'Top 5 employees by number of late days in a period', period),
    def('get_leave_summary', mgr ? 'Approved leave days by type, and who is on leave today' : 'Your own leave requests', period),
    def('get_my_leave_balance', 'Your own leave balance per leave type for this year'),
    mgr && def('get_payroll_summary', 'Totals of a payroll run (gross, deductions, tax, net)', { month: { type: 'string', description: 'YYYY-MM, default latest' } }),
    mgr && def('search_employees', 'Find employees by name, code or email', { query: { type: 'string' }, department: period.department }),
  ];
  return all.filter(Boolean);
}
async function runTool(name, a, user) {
  const mgr = user.role !== 'employee';
  const d = await db();
  let deptId;
  if (a.department) { const dep = await d.collection('departments').findOne({ name: new RegExp('^' + String(a.department).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }); if (!dep) return { error: 'Unknown department: ' + a.department }; deptId = dep._id; }
  const f = { from: a.from, to: a.to, deptId };
  const need = () => { if (!mgr) throw new Error('Not allowed for your role'); };
  switch (name) {
    case 'get_headcount': { need(); const k = await S.companyKpis(f); return { asOf: k.range.to, headcount: k.headcount, byDepartment: deptId ? undefined : k.byDept.map((x) => ({ dept: x.dept, headcount: x.headcount })) }; }
    case 'get_attendance_summary': { if (!mgr) return S.myTally(user, f); const k = await S.companyKpis(f); return { range: k.range, attendanceRate: k.attendanceRate, latePct: k.latePct, absenteeism: k.absenteeism, dayCounts: k.tally, today: k.today }; }
    case 'get_late_comers': { need(); const k = await S.companyKpis(f); return { range: k.range, topLate: k.topLate }; }
    case 'get_leave_summary': {
      if (!mgr) return (await S.listLeaves(user)).map((l) => ({ type: l.type, start: l.start, end: l.end, days: l.days, status: l.status }));
      const k = await S.companyKpis(f); return { range: k.range, leaveByType: k.leaveByType, onLeaveToday: await S.onLeaveToday() };
    }
    case 'get_my_leave_balance': return S.leaveBalance(user.employeeId);
    case 'get_payroll_summary': need(); return S.payrollSummary(a.month);
    case 'search_employees': { need(); const r = await S.employeeList(user, { q: a.query, deptId, limit: 10 }); return r.items.map((e) => ({ name: e.name, code: e.code, department: e.department, designation: e.designation, status: e.status, basicSalary: e.basic })); }
    default: return { error: 'Unknown tool' };
  }
}

async function systemPrompt(user) {
  const s = await S.getSettings(); const today = R.localNow().date;
  const wd = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(today + 'T00:00:00Z').getUTCDay()];
  return `You are the HCM Lite assistant for ${s.companyName}. Today is ${wd} ${today}. The user is ${user.name} (role: ${user.role}).
RULES YOU MAY QUOTE (answer policy questions ONLY from these; otherwise say you do not know):
- Office starts ${s.officeStart}, grace ${s.graceMin} min, so check-in after the grace time is late. Half day when worked hours are under ${s.halfDayHours}. Weekend days (0=Sun): ${s.weekend.join(',')}.
- One attendance record per employee per day. Absent = no record and no approved leave. missing_checkout = no check-out.
- Leave counts working days only (weekends and holidays skipped). Yearly quotas: annual 14, sick 8, casual 10, unpaid unlimited. Overlapping or over-balance requests are rejected.
- Payroll: gross = 1.5 x basic (HRA 40%, medical 10%). Per day = gross / working days; deduct absent days + unpaid leave + 0.5 x half days. Joiners/leavers are prorated. Tax is on gross x 12 with slabs (0 to 600k: 0; 5% to 1.2M; 30k+15% to 2.4M; 210k+25% to 3.6M; 510k+35% above). Only Admin can finalize payroll.
BEHAVIOUR:
- For any question about numbers or people, call a tool. Never invent data. Use only tool results.
- You only have the access of this user. If an Employee asks about another person's data or salary, refuse politely.
- You never change data. Understand English and Roman Urdu; reply in the language the user used. Keep answers short.`;
}

export async function chat(user, { message, history = [] }) {
  if (!message?.trim()) throw S.err(422, 'Type a question first');
  await guard(user);
  const t0 = Date.now();
  try {
    const msgs = [{ role: 'system', content: await systemPrompt(user) },
      ...history.slice(-6).map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: String(h.content).slice(0, 1000) })),
      { role: 'user', content: message.slice(0, 1000) }];
    const tools = toolDefs(user);
    for (let i = 0; i < 4; i++) {
      const m = await llm(msgs, { tools });
      if (!m.tool_calls?.length) { await log(user, 'chat', message, m.content, true, Date.now() - t0); return { answer: m.content, label: LABEL, ok: true }; }
      msgs.push(m);
      for (const c of m.tool_calls) {
        let out; try { out = await runTool(c.function.name, JSON.parse(c.function.arguments || '{}'), user); } catch (e) { out = { error: e.message }; }
        msgs.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(out).slice(0, 6000) });
      }
    }
    throw new Error('Too many tool rounds');
  } catch (e) { await log(user, 'chat', message, String(e.message), false, Date.now() - t0); return fallback(); }
}

export async function summary(user, q) {
  await guard(user);
  const k = await S.companyKpis(q), t0 = Date.now();
  try {
    const m = await llm([
      { role: 'system', content: 'You write HR dashboard insights. Reply with 3 to 5 short bullet points starting with "- ". Use ONLY numbers present in the JSON. Do not invent anything.' },
      { role: 'user', content: JSON.stringify({ ...k, trend: undefined }) },
    ]);
    await log(user, 'summary', JSON.stringify(q), m.content, true, Date.now() - t0);
    return { bullets: m.content.split('\n').map((l) => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean).slice(0, 5), label: LABEL, ok: true };
  } catch (e) { await log(user, 'summary', JSON.stringify(q), String(e.message), false, Date.now() - t0); return { bullets: [], ...fallback() }; }
}

export async function smartLeave(user, { text }) {
  if (!text?.trim()) throw S.err(422, 'Describe your leave first');
  await guard(user);
  const types = await (await db()).collection('leavetypes').find().toArray(), keys = types.map((t) => t.key);
  const today = R.localNow().date, wd = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(today + 'T00:00:00Z').getUTCDay()];
  const sys = `Convert the user's leave request into JSON only: {"type":one of ${JSON.stringify(keys)},"start":"YYYY-MM-DD","end":"YYYY-MM-DD","reason":"short text"}. Today is ${wd} ${today}. "next Monday" means the first Monday after today. Weddings, family events and personal errands are "casual"; illness is "sick"; vacations are "annual". Output JSON only, no extra words.`;
  const t0 = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const m = await llm([{ role: 'system', content: sys }, { role: 'user', content: text.slice(0, 500) }], { json: true });
      const j = JSON.parse(m.content.replace(/```json|```/g, '').trim());
      if (keys.includes(j.type) && R.isDate(j.start) && R.isDate(j.end) && j.start <= j.end) {
        await log(user, 'smart_leave', text, JSON.stringify(j), true, Date.now() - t0);
        return { form: { type: j.type, start: j.start, end: j.end, reason: String(j.reason || text).slice(0, 200) }, label: LABEL, ok: true };
      }
    } catch (e) { /* retry once */ }
  }
  await log(user, 'smart_leave', text, 'invalid output', false, Date.now() - t0);
  return { form: null, label: LABEL, ok: false, answer: 'Could not read that request. Please fill in the form manually.' };
}
