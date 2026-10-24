import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID as uid, randomBytes } from 'crypto';
import { db } from './db.js';
import * as R from './rules.mjs';

export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export const err = (s, m, d) => new HttpError(s, m, d);
const nowISO = () => new Date().toISOString();
const newTemp = () => 'Tmp@' + randomBytes(4).toString('hex');
const pub = (u) => ({ id: u._id, name: u.name, email: u.email, role: u.role, employeeId: u.employeeId || null, mustChange: !!u.mustChange });
const secret = () => { if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set'); return process.env.JWT_SECRET; };
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);

/* ---------------- auth ---------------- */
export async function authUser(req) {
  const t = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!t) throw err(401, 'Please sign in');
  let p; try { p = jwt.verify(t, secret()); } catch { throw err(401, 'Session expired, sign in again'); }
  const d = await db();
  const u = await d.collection('users').findOne({ _id: p.sub });
  if (!u || !u.active) throw err(401, 'This account is disabled');
  return pub(u); // role always comes from the database, not the token
}
export async function login({ email, password }) {
  const d = await db();
  const u = await d.collection('users').findOne({ email: String(email || '').toLowerCase().trim() });
  if (!u || !u.active || !(await bcrypt.compare(String(password || ''), u.passwordHash))) throw err(401, 'Wrong email or password');
  return { token: jwt.sign({ sub: u._id }, secret(), { expiresIn: '12h' }), user: pub(u) };
}
export async function changePassword(user, { oldPassword, newPassword }) {
  const d = await db();
  const u = await d.collection('users').findOne({ _id: user.id });
  if (!(await bcrypt.compare(String(oldPassword || ''), u.passwordHash))) throw err(422, 'Current password is wrong');
  if (!newPassword || newPassword.length < 8) throw err(422, 'New password needs at least 8 characters');
  if (newPassword === oldPassword) throw err(422, 'Choose a different password');
  await d.collection('users').updateOne({ _id: u._id }, { $set: { passwordHash: await bcrypt.hash(newPassword, 10), mustChange: false } });
  await audit(user, 'change_password', 'user', u._id);
  return { ok: true };
}

/* ---------------- audit & notifications ---------------- */
export async function audit(user, action, entity, entityId, before = null, after = null) {
  const d = await db();
  await d.collection('audit').insertOne({ _id: uid(), at: nowISO(), actorId: user.id, actor: user.name, role: user.role, action, entity, entityId, before, after });
}
async function notifyEmployee(employeeId, title, body) {
  const d = await db();
  const e = await d.collection('employees').findOne({ _id: employeeId });
  if (e?.userId) await d.collection('notifications').insertOne({ _id: uid(), userId: e.userId, title, body, read: false, at: nowISO() });
}
export async function listNotifications(user) {
  const d = await db();
  const items = await d.collection('notifications').find({ userId: user.id }).sort({ at: -1 }).limit(30).toArray();
  return { items, unread: items.filter((n) => !n.read).length };
}
export async function readNotifications(user) {
  const d = await db();
  await d.collection('notifications').updateMany({ userId: user.id, read: false }, { $set: { read: true } });
  return { ok: true };
}
export async function listAnnouncements() {
  const d = await db();
  return d.collection('announcements').find().sort({ at: -1 }).limit(20).toArray();
}
export async function postAnnouncement(user, { title, body }) {
  if (!title?.trim() || !body?.trim()) throw err(422, 'Title and message are required');
  const d = await db();
  const a = { _id: uid(), title: title.trim(), body: body.trim(), by: user.name, at: nowISO() };
  await d.collection('announcements').insertOne(a);
  await audit(user, 'create', 'announcement', a._id, null, a);
  return a;
}
export async function listAudit(q) {
  const d = await db();
  const f = q.entity ? { entity: q.entity } : {};
  return d.collection('audit').find(f).sort({ at: -1 }).limit(Math.min(+q.limit || 100, 300)).toArray();
}

/* ---------------- setup & settings ---------------- */
export async function getSettings() {
  const d = await db();
  const s = await d.collection('settings').findOne({ _id: 'main' });
  if (!s) throw err(409, 'Setup not completed');
  return s;
}
export async function setupStatus() {
  const d = await db();
  const s = await d.collection('settings').findOne({ _id: 'main' });
  return { done: !!s, company: s?.companyName || null, envAdmin: !!(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) };
}
async function ensureIndexes(d) {
  await d.collection('attendance').createIndex({ employeeId: 1, date: 1 }, { unique: true });
  await d.collection('users').createIndex({ email: 1 }, { unique: true });
  await d.collection('employees').createIndex({ code: 1 }, { unique: true });
  await d.collection('employees').createIndex({ email: 1 }, { unique: true });
}
export async function runSetup(b) {
  const d = await db();
  if (await d.collection('settings').findOne({ _id: 'main' })) throw err(409, 'Setup already completed');
  const email = String(b.email || process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const password = b.password || process.env.ADMIN_PASSWORD || '';
  if (!b.companyName?.trim()) throw err(422, 'Company name is required');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw err(422, 'Enter a valid admin email');
  if (password.length < 8) throw err(422, 'Admin password needs at least 8 characters');
  await ensureIndexes(d);
  await d.collection('users').insertOne({ _id: uid(), email, name: b.name?.trim() || 'Admin', role: 'admin', passwordHash: await bcrypt.hash(password, 10), active: true, mustChange: false, createdAt: nowISO() });
  await d.collection('leavetypes').insertMany([
    { _id: uid(), key: 'annual', name: 'Annual', quota: 14 },
    { _id: uid(), key: 'sick', name: 'Sick', quota: 8 },
    { _id: uid(), key: 'casual', name: 'Casual', quota: 10 },
    { _id: uid(), key: 'unpaid', name: 'Unpaid', quota: null },
  ]);
  await d.collection('settings').insertOne({ _id: 'main', companyName: b.companyName.trim(), officeStart: '09:00', graceMin: 15, halfDayHours: 5, weekend: [0, 6], lat: null, lng: null, radius: 150 });
  return { ok: true };
}
export async function updateSettings(user, b) {
  const d = await db();
  const before = await getSettings();
  const o = {}, e = [];
  if (b.companyName !== undefined) { if (!String(b.companyName).trim()) e.push({ field: 'companyName', reason: 'required' }); else o.companyName = String(b.companyName).trim(); }
  if (b.officeStart !== undefined) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.officeStart)) e.push({ field: 'officeStart', reason: 'use HH:MM' }); else o.officeStart = b.officeStart; }
  for (const k of ['graceMin', 'halfDayHours', 'radius']) if (b[k] !== undefined && b[k] !== '') { const n = Number(b[k]); if (!(n >= 0)) e.push({ field: k, reason: 'must be a number >= 0' }); else o[k] = n; }
  if (b.weekend !== undefined) { const w = [].concat(b.weekend).map(Number); if (w.some((x) => !(x >= 0 && x <= 6))) e.push({ field: 'weekend', reason: 'invalid' }); else o.weekend = w; }
  for (const k of ['lat', 'lng']) if (b[k] !== undefined) { if (b[k] === '' || b[k] === null) o[k] = null; else { const n = Number(b[k]); if (isNaN(n)) e.push({ field: k, reason: 'must be a number' }); else o[k] = n; } }
  if (e.length) throw err(422, 'Validation failed', e);
  await d.collection('settings').updateOne({ _id: 'main' }, { $set: o });
  const after = await getSettings();
  await audit(user, 'update', 'settings', 'main', before, after);
  return after;
}

/* ---------------- lookups: departments, designations, leave types, holidays ---------------- */
const KINDS = { departments: 'departments', designations: 'designations', leavetypes: 'leavetypes', holidays: 'holidays' };
export async function lookupList(kind) {
  if (!KINDS[kind]) throw err(404, 'Unknown list');
  const d = await db();
  const sort = kind === 'holidays' ? { date: 1 } : { name: 1 };
  return d.collection(kind).find().sort(sort).toArray();
}
function cleanLookup(kind, b) {
  const o = {}, e = [];
  if (kind === 'holidays') { if (!R.isDate(b.date)) e.push({ field: 'date', reason: 'use YYYY-MM-DD' }); else o.date = b.date; }
  if (!String(b.name || '').trim()) e.push({ field: 'name', reason: 'required' }); else o.name = String(b.name).trim();
  if (kind === 'leavetypes') {
    const key = String(b.key || '').trim().toLowerCase();
    if (!/^[a-z0-9_]+$/.test(key)) e.push({ field: 'key', reason: 'letters, numbers, underscore only' }); else o.key = key;
    if (b.quota === '' || b.quota === null || b.quota === undefined) o.quota = null;
    else { const n = Number(b.quota); if (!(n >= 0)) e.push({ field: 'quota', reason: 'must be >= 0 (empty = unlimited)' }); else o.quota = n; }
  }
  if (e.length) throw err(422, 'Validation failed', e);
  return o;
}
export async function lookupSave(user, kind, id, b) {
  if (!KINDS[kind]) throw err(404, 'Unknown list');
  const d = await db(); const c = d.collection(kind); const o = cleanLookup(kind, b);
  try {
    if (id) {
      const before = await c.findOne({ _id: id }); if (!before) throw err(404, 'Not found');
      await c.updateOne({ _id: id }, { $set: o });
      await audit(user, 'update', kind, id, before, { ...before, ...o });
      return { ...before, ...o };
    }
    const doc = { _id: uid(), ...o };
    await c.insertOne(doc);
    await audit(user, 'create', kind, doc._id, null, doc);
    return doc;
  } catch (e) { if (e.code === 11000) throw err(409, 'Already exists'); throw e; }
}
export async function lookupDelete(user, kind, id) {
  if (!KINDS[kind]) throw err(404, 'Unknown list');
  const d = await db(); const before = await d.collection(kind).findOne({ _id: id });
  if (!before) throw err(404, 'Not found');
  if (kind === 'departments' && (await d.collection('employees').findOne({ deptId: id }))) throw err(409, 'Department has employees; move them first');
  if (kind === 'leavetypes' && (await d.collection('leaves').findOne({ type: before.key }))) throw err(409, 'Leave type is already used');
  await d.collection(kind).deleteOne({ _id: id });
  await audit(user, 'delete', kind, id, before, null);
  return { ok: true };
}

/* ---------------- users ---------------- */
export async function listUsers() {
  const d = await db();
  return (await d.collection('users').find().sort({ createdAt: -1 }).toArray()).map((u) => ({ ...pub(u), active: u.active }));
}
export async function createHr(user, b) {
  const d = await db();
  const email = String(b.email || '').toLowerCase().trim();
  if (!b.name?.trim()) throw err(422, 'Name is required');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw err(422, 'Enter a valid email');
  if (await d.collection('users').findOne({ email })) throw err(409, 'Email already in use');
  const temp = newTemp(), eid = uid(), uidv = uid(), today = R.localNow().date;
  await d.collection('employees').insertOne({ _id: eid, code: 'HR-' + randomBytes(2).toString('hex').toUpperCase(), name: b.name.trim(), email, deptId: b.deptId || null, designation: b.designation?.trim() || 'HR', joinDate: today, exitDate: null, status: 'active', basic: Number(b.basic) || 0, gender: b.gender || '', phone: '', address: '', isHr: true, userId: uidv });
  await d.collection('users').insertOne({ _id: uidv, email, name: b.name.trim(), role: 'hr', employeeId: eid, passwordHash: await bcrypt.hash(temp, 10), active: true, mustChange: true, createdAt: nowISO() });
  await audit(user, 'create', 'user', uidv, null, { email, role: 'hr' });
  return { tempPassword: temp, email };
}
export async function setActive(user, id, active) {
  const d = await db(); const u = await d.collection('users').findOne({ _id: id });
  if (!u) throw err(404, 'User not found');
  if (u._id === user.id) throw err(422, 'You cannot deactivate yourself');
  await d.collection('users').updateOne({ _id: id }, { $set: { active: !!active } });
  await audit(user, active ? 'activate' : 'deactivate', 'user', id, { active: u.active }, { active: !!active });
  return { ok: true };
}
export async function resetPassword(user, id) {
  const d = await db(); const u = await d.collection('users').findOne({ _id: id });
  if (!u) throw err(404, 'User not found');
  const temp = newTemp();
  await d.collection('users').updateOne({ _id: id }, { $set: { passwordHash: await bcrypt.hash(temp, 10), mustChange: true } });
  await audit(user, 'reset_password', 'user', id);
  return { tempPassword: temp, email: u.email };
}

/* ---------------- employees ---------------- */
async function cleanEmp(b, d, id = null, partial = false) {
  const e = [], o = {};
  const has = (k) => b[k] !== undefined && b[k] !== null && b[k] !== '';
  const need = (k) => { if (!partial && !has(k)) e.push({ field: k, reason: 'required' }); return has(k); };
  if (need('code')) { o.code = String(b.code).trim(); if (await d.collection('employees').findOne({ code: o.code, _id: { $ne: id } })) e.push({ field: 'code', reason: 'already exists' }); }
  if (need('name')) o.name = String(b.name).trim();
  if (!id && need('email')) {
    o.email = String(b.email).trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(o.email)) e.push({ field: 'email', reason: 'invalid email' });
    else if ((await d.collection('employees').findOne({ email: o.email })) || (await d.collection('users').findOne({ email: o.email }))) e.push({ field: 'email', reason: 'already exists' });
  }
  if (need('deptId')) { o.deptId = b.deptId; if (!(await d.collection('departments').findOne({ _id: o.deptId }))) e.push({ field: 'deptId', reason: 'unknown department' }); }
  if (need('designation')) o.designation = String(b.designation).trim();
  if (need('joinDate')) { o.joinDate = b.joinDate; if (!R.isDate(o.joinDate)) e.push({ field: 'joinDate', reason: 'use YYYY-MM-DD' }); }
  if (need('basic')) { o.basic = Number(b.basic); if (!(o.basic > 0)) e.push({ field: 'basic', reason: 'must be > 0' }); }
  for (const k of ['phone', 'address', 'gender']) if (b[k] !== undefined) o[k] = String(b[k]).trim();
  if (has('status')) { if (!['probation', 'active', 'exited'].includes(b.status)) e.push({ field: 'status', reason: 'invalid' }); else o.status = b.status; }
  if (has('exitDate')) { if (!R.isDate(b.exitDate)) e.push({ field: 'exitDate', reason: 'use YYYY-MM-DD' }); else o.exitDate = b.exitDate; }
  if (e.length) throw err(422, 'Validation failed', e);
  return o;
}
export async function createEmployee(actor, b) {
  const d = await db(); const o = await cleanEmp(b, d);
  const id = uid(), userId = uid(), temp = newTemp();
  const emp = { _id: id, exitDate: null, status: 'active', phone: '', address: '', gender: '', ...o, userId };
  try {
    await d.collection('employees').insertOne(emp);
    await d.collection('users').insertOne({ _id: userId, email: o.email, name: o.name, role: 'employee', employeeId: id, passwordHash: await bcrypt.hash(temp, 10), active: true, mustChange: true, createdAt: nowISO() });
  } catch (e) { if (e.code === 11000) throw err(409, 'Code or email already exists'); throw e; }
  await audit(actor, 'create', 'employee', id, null, emp);
  return { employee: emp, tempPassword: temp };
}
export async function updateEmployee(actor, id, b) {
  const d = await db(); const before = await d.collection('employees').findOne({ _id: id });
  if (!before) throw err(404, 'Employee not found');
  const o = await cleanEmp(b, d, id, true); delete o.email;
  if (o.status === 'exited' && !o.exitDate && !before.exitDate) o.exitDate = R.localNow().date;
  if (o.status && o.status !== 'exited') o.exitDate = null;
  await d.collection('employees').updateOne({ _id: id }, { $set: o });
  if (o.name) await d.collection('users').updateOne({ _id: before.userId }, { $set: { name: o.name } });
  if (o.status === 'exited') await d.collection('users').updateOne({ _id: before.userId }, { $set: { active: false } });
  const after = { ...before, ...o };
  await audit(actor, 'update', 'employee', id, before, after);
  return after;
}
export async function updateProfile(user, b) {
  if (!user.employeeId) throw err(403, 'No employee profile');
  const d = await db(); const o = {};
  for (const k of ['phone', 'address']) if (b[k] !== undefined) o[k] = String(b[k]).trim().slice(0, 200);
  const before = await d.collection('employees').findOne({ _id: user.employeeId });
  await d.collection('employees').updateOne({ _id: user.employeeId }, { $set: o });
  await audit(user, 'update', 'employee', user.employeeId, { phone: before.phone, address: before.address }, o);
  return { ...before, ...o };
}
export async function employeeList(user, q) {
  const d = await db(); const f = {};
  if (user.role === 'employee') f._id = user.employeeId;
  else {
    if (q.deptId) f.deptId = q.deptId;
    if (q.status) f.status = q.status;
    if (q.q) { const re = new RegExp(esc(q.q), 'i'); f.$or = [{ name: re }, { code: re }, { email: re }]; }
  }
  const limit = Math.min(+q.limit || 20, 50), page = Math.max(+q.page || 1, 1);
  const total = await d.collection('employees').countDocuments(f);
  const items = await d.collection('employees').find(f).sort({ name: 1 }).skip((page - 1) * limit).limit(limit).toArray();
  const dn = await deptNames(d);
  return { total, page, limit, items: items.map((e) => ({ ...e, department: dn[e.deptId] || 'Unassigned' })) };
}
async function deptNames(d) {
  const x = Object.fromEntries((await d.collection('departments').find().toArray()).map((z) => [z._id, z.name]));
  return x;
}
function ownOrMgr(user, id) { if (user.role === 'employee' && user.employeeId !== id) throw err(403, 'You can only open your own data'); }
export async function employee360(user, id) {
  ownOrMgr(user, id);
  const d = await db(); const e = await d.collection('employees').findOne({ _id: id });
  if (!e) throw err(404, 'Employee not found');
  const today = R.localNow().date, from = R.addDays(today, -29);
  const x = await loadCtx(from, today);
  const { t } = tally([e], R.workingDays(from, today, x.s.weekend, x.hol), x);
  const dn = await deptNames(d);
  const leaves = await d.collection('leaves').find({ employeeId: id }).sort({ createdAt: -1 }).limit(10).toArray();
  return { employee: { ...e, department: dn[e.deptId] || 'Unassigned' }, last30: { ...t, ...rates(t) }, balance: await leaveBalance(id), leaves };
}
function parseCSV(t) {
  const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; r.push(f); f = ''; rows.push(r); r = []; }
    else f += c;
  }
  if (f || r.length) { r.push(f); rows.push(r); }
  return rows.filter((x) => x.some((v) => v.trim()));
}
export async function exportCsv() {
  const d = await db(); const dn = await deptNames(d);
  const emps = await d.collection('employees').find().sort({ code: 1 }).toArray();
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['code', 'name', 'email', 'department', 'designation', 'joinDate', 'basic', 'gender', 'phone', 'status'];
  const lines = emps.map((e) => [e.code, e.name, e.email, dn[e.deptId] || '', e.designation, e.joinDate, e.basic, e.gender, e.phone, e.status].map(q).join(','));
  return { csv: [head.join(','), ...lines].join('\n') };
}
export async function importCsv(actor, { csv, dryRun }) {
  const rows = parseCSV(String(csv || ''));
  if (rows.length < 2) throw err(422, 'CSV needs a header row and at least one data row');
  const head = rows[0].map((h) => h.trim());
  const miss = ['code', 'name', 'email', 'department', 'designation', 'joinDate', 'basic'].filter((h) => !head.includes(h));
  if (miss.length) throw err(422, 'Missing columns: ' + miss.join(', '));
  const d = await db(); const depts = await d.collection('departments').find().toArray();
  const byName = Object.fromEntries(depts.map((x) => [x.name.toLowerCase(), x._id]));
  const errors = [], good = [], seenC = new Set(), seenE = new Set();
  for (let i = 1; i < rows.length; i++) {
    const rec = Object.fromEntries(head.map((h, j) => [h, (rows[i][j] || '').trim()]));
    rec.deptId = byName[rec.department.toLowerCase()];
    if (rec.department && !rec.deptId) { errors.push({ row: i + 1, field: 'department', reason: 'unknown department' }); }
    if (seenC.has(rec.code)) errors.push({ row: i + 1, field: 'code', reason: 'duplicate inside file' });
    if (seenE.has(rec.email.toLowerCase())) errors.push({ row: i + 1, field: 'email', reason: 'duplicate inside file' });
    seenC.add(rec.code); seenE.add(rec.email.toLowerCase());
    try { await cleanEmp(rec, d); good.push(rec); }
    catch (e) { if (e.details) e.details.forEach((x) => { if (!(x.field === 'deptId' && rec.department && !rec.deptId)) errors.push({ row: i + 1, ...x }); }); else throw e; }
  }
  if (dryRun || errors.length) {
    if (!dryRun) throw err(422, 'Fix the errors and try again', errors);
    return { ok: errors.length === 0, rows: rows.length - 1, errors };
  }
  const credentials = [];
  for (const rec of good) { const r = await createEmployee(actor, rec); credentials.push({ email: rec.email, tempPassword: r.tempPassword }); }
  return { ok: true, created: credentials.length, credentials };
}

/* ---------------- attendance engine ---------------- */
export async function loadCtx(from, to) {
  const d = await db();
  const s = await d.collection('settings').findOne({ _id: 'main' });
  if (!s) throw err(409, 'Setup not completed');
  const hol = new Set((await d.collection('holidays').find().toArray()).map((h) => h.date));
  const att = new Map((await d.collection('attendance').find({ date: { $gte: from, $lte: to } }).toArray()).map((a) => [a.employeeId + '|' + a.date, a]));
  const leaves = await d.collection('leaves').find({ status: 'approved', start: { $lte: to }, end: { $gte: from } }).toArray();
  const byEmp = {}; leaves.forEach((l) => (byEmp[l.employeeId] ??= []).push(l));
  return { s, hol, att, leaves, byEmp, today: R.localNow().date };
}
export function statusOf(e, date, x) {
  if (!R.isWorkingDay(date, x.s.weekend, x.hol)) return null;
  if (date < e.joinDate || (e.exitDate && date > e.exitDate) || date > x.today) return null;
  const a = x.att.get(e._id + '|' + date);
  if (a) return !a.checkOut && date < x.today ? 'missing_checkout' : a.status;
  if ((x.byEmp[e._id] || []).some((l) => l.start <= date && l.end >= date)) return 'on_leave';
  return date === x.today ? null : 'absent';
}
export function tally(emps, dates, x) {
  const t = { present: 0, late: 0, half_day: 0, missing_checkout: 0, absent: 0, on_leave: 0 }, perEmp = {};
  for (const e of emps) {
    const p = (perEmp[e._id] = { late: 0, absent: 0, half: 0 });
    for (const dt of dates) { const s = statusOf(e, dt, x); if (!s) continue; t[s]++; if (s === 'late') p.late++; if (s === 'absent') p.absent++; if (s === 'half_day') p.half++; }
  }
  return { t, perEmp };
}
export function rates(t) {
  const total = sum(Object.values(t), (v) => v), exp = total - t.on_leave;
  const f = (n) => +n.toFixed(1);
  return {
    attendanceRate: exp ? f(((t.present + t.late + t.missing_checkout + 0.5 * t.half_day) / exp) * 100) : 0,
    latePct: t.present + t.late ? f((t.late / (t.present + t.late)) * 100) : 0,
    absenteeism: exp ? f((t.absent / exp) * 100) : 0,
  };
}
export async function todayRecord(user) {
  if (!user.employeeId) throw err(403, 'No employee profile');
  const d = await db();
  return { record: await d.collection('attendance').findOne({ employeeId: user.employeeId, date: R.localNow().date }), serverTime: nowISO() };
}
export async function checkIn(user, b = {}) {
  if (!user.employeeId) throw err(403, 'No employee profile');
  const d = await db(); const s = await getSettings(); const n = R.localNow();
  const hol = new Set((await d.collection('holidays').find().toArray()).map((h) => h.date));
  if (!R.isWorkingDay(n.date, s.weekend, hol)) throw err(422, 'Today is not a working day');
  if (await d.collection('attendance').findOne({ employeeId: user.employeeId, date: n.date })) throw err(409, 'You already checked in today');
  let source = 'web', dist = null;
  if (b.lat != null && b.lng != null && s.lat != null && s.lng != null) {
    if (Number(b.accuracy) > 100) throw err(422, 'GPS accuracy is worse than 100 m, move to an open area');
    dist = R.haversine(Number(b.lat), Number(b.lng), s.lat, s.lng);
    if (dist > s.radius) throw err(422, `You are ${Math.round(dist)} m from the office (limit ${s.radius} m)`);
    source = 'location';
  }
  const rec = { _id: uid(), employeeId: user.employeeId, date: n.date, checkIn: nowISO(), checkOut: null, hours: 0, status: R.checkInStatus(n.minutes, s), source, distance: dist == null ? null : Math.round(dist) };
  try { await d.collection('attendance').insertOne(rec); } catch (e) { if (e.code === 11000) throw err(409, 'You already checked in today'); throw e; }
  return { record: rec };
}
export async function checkOut(user) {
  if (!user.employeeId) throw err(403, 'No employee profile');
  const d = await db(); const s = await getSettings(); const date = R.localNow().date;
  const a = await d.collection('attendance').findOne({ employeeId: user.employeeId, date });
  if (!a) throw err(422, 'Check in first');
  if (a.checkOut) throw err(409, 'You already checked out today');
  const hours = +((Date.now() - Date.parse(a.checkIn)) / 3600000).toFixed(2);
  const set = { checkOut: nowISO(), hours, status: R.afterCheckOut(a.status, hours, s) };
  await d.collection('attendance').updateOne({ _id: a._id }, { $set: set });
  return { record: { ...a, ...set } };
}
export async function myCalendar(user, month) {
  if (!user.employeeId) throw err(403, 'No employee profile');
  const today = R.localNow().date; month = /^\d{4}-\d{2}$/.test(month || '') ? month : today.slice(0, 7);
  const from = month + '-01', to = R.lastDay(month);
  const d = await db(); const e = await d.collection('employees').findOne({ _id: user.employeeId });
  const x = await loadCtx(from, to);
  return R.eachDay(from, to).map((date) => {
    const a = x.att.get(e._id + '|' + date);
    const off = !R.isWorkingDay(date, x.s.weekend, x.hol);
    return { date, status: off ? 'off' : statusOf(e, date, x) || (date > today ? 'upcoming' : 'pending'), checkIn: a?.checkIn || null, checkOut: a?.checkOut || null, hours: a?.hours || 0 };
  });
}
export async function board(q) {
  const d = await db(); const date = R.isDate(q.date) ? q.date : R.localNow().date;
  const f = { joinDate: { $lte: date } }; if (q.deptId) f.deptId = q.deptId;
  const emps = (await d.collection('employees').find(f).sort({ name: 1 }).toArray()).filter((e) => !e.exitDate || e.exitDate >= date);
  const x = await loadCtx(date, date); const dn = await deptNames(d);
  const off = !R.isWorkingDay(date, x.s.weekend, x.hol);
  return emps.map((e) => {
    const a = x.att.get(e._id + '|' + date);
    return { _id: e._id, code: e.code, name: e.name, department: dn[e.deptId] || 'Unassigned', status: off ? 'off' : statusOf(e, date, x) || 'not_checked_in', checkIn: a?.checkIn || null, checkOut: a?.checkOut || null, hours: a?.hours || 0, source: a?.source || '' };
  });
}
export async function listCorrections(user) {
  const d = await db(); const f = user.role === 'employee' ? { employeeId: user.employeeId } : {};
  const items = await d.collection('corrections').find(f).sort({ createdAt: -1 }).limit(100).toArray();
  const emps = Object.fromEntries((await d.collection('employees').find().toArray()).map((e) => [e._id, e.name]));
  return items.map((c) => ({ ...c, employee: emps[c.employeeId] }));
}
export async function requestCorrection(user, b) {
  if (!user.employeeId) throw err(403, 'No employee profile');
  const today = R.localNow().date, hm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!R.isDate(b.date) || b.date > today) throw err(422, 'Pick a past or current date');
  if (!b.checkIn && !b.checkOut) throw err(422, 'Enter a check-in or check-out time');
  if ((b.checkIn && !hm.test(b.checkIn)) || (b.checkOut && !hm.test(b.checkOut))) throw err(422, 'Times use HH:MM');
  if (!b.reason?.trim()) throw err(422, 'Reason is required');
  const d = await db();
  if (await d.collection('corrections').findOne({ employeeId: user.employeeId, date: b.date, status: 'pending' })) throw err(409, 'A pending request already exists for this date');
  const c = { _id: uid(), employeeId: user.employeeId, date: b.date, checkIn: b.checkIn || null, checkOut: b.checkOut || null, reason: b.reason.trim(), status: 'pending', createdAt: nowISO() };
  await d.collection('corrections').insertOne(c);
  await audit(user, 'create', 'correction', c._id, null, c);
  return c;
}
export async function decideCorrection(user, id, { approve, comment }) {
  const d = await db(); const c = await d.collection('corrections').findOne({ _id: id });
  if (!c) throw err(404, 'Request not found');
  if (c.status !== 'pending') throw err(409, 'Already decided');
  if (c.employeeId === user.employeeId) throw err(403, 'You cannot decide your own request');
  if (approve) {
    const s = await getSettings();
    const old = await d.collection('attendance').findOne({ employeeId: c.employeeId, date: c.date });
    const ci = c.checkIn ? R.localToISO(c.date, c.checkIn) : old?.checkIn;
    const co = c.checkOut ? R.localToISO(c.date, c.checkOut) : old?.checkOut || null;
    if (!ci) throw err(422, 'This correction needs a check-in time');
    const l = new Date(Date.parse(ci) + R.TZ_OFFSET_MIN * 60000);
    let status = R.checkInStatus(l.getUTCHours() * 60 + l.getUTCMinutes(), s), hours = 0;
    if (co) { hours = +((Date.parse(co) - Date.parse(ci)) / 3600000).toFixed(2); if (hours < 0) throw err(422, 'Check-out is before check-in'); status = R.afterCheckOut(status, hours, s); }
    await d.collection('attendance').updateOne({ employeeId: c.employeeId, date: c.date }, { $set: { checkIn: ci, checkOut: co, hours, status, source: 'correction' }, $setOnInsert: { _id: uid() } }, { upsert: true });
  }
  const set = { status: approve ? 'approved' : 'rejected', comment: comment || '', decidedBy: user.name, decidedAt: nowISO() };
  await d.collection('corrections').updateOne({ _id: id }, { $set: set });
  await audit(user, approve ? 'approve' : 'reject', 'correction', id, { status: 'pending' }, set);
  await notifyEmployee(c.employeeId, 'Attendance correction ' + set.status, `${c.date}: ${comment || 'no comment'}`);
  return { ok: true };
}

/* ---------------- leave ---------------- */
export async function leaveBalance(employeeId, year = R.localNow().date.slice(0, 4)) {
  if (!employeeId) throw err(403, 'No employee profile');
  const d = await db();
  const types = await d.collection('leavetypes').find().toArray();
  const ls = await d.collection('leaves').find({ employeeId, status: { $in: ['approved', 'pending'] }, start: { $gte: year + '-01-01', $lte: year + '-12-31' } }).toArray();
  return types.map((t) => {
    const used = sum(ls.filter((l) => l.type === t.key && l.status === 'approved'), (l) => l.days);
    const pending = sum(ls.filter((l) => l.type === t.key && l.status === 'pending'), (l) => l.days);
    return { key: t.key, name: t.name, quota: t.quota, used, pending, left: t.quota == null ? null : t.quota - used - pending };
  });
}
export async function applyLeave(user, b) {
  if (!user.employeeId) throw err(403, 'No employee profile');
  const d = await db(); const s = await getSettings();
  if (!R.isDate(b.start) || !R.isDate(b.end) || b.start > b.end) throw err(422, 'Check the start and end dates');
  const t = await d.collection('leavetypes').findOne({ key: b.type });
  if (!t) throw err(422, 'Unknown leave type');
  if (!b.reason?.trim()) throw err(422, 'Reason is required');
  const hol = new Set((await d.collection('holidays').find().toArray()).map((h) => h.date));
  const days = R.workingDays(b.start, b.end, s.weekend, hol).length;
  if (!days) throw err(422, 'No working days in this range (weekends and holidays are skipped)');
  if (await d.collection('leaves').findOne({ employeeId: user.employeeId, status: { $in: ['pending', 'approved'] }, start: { $lte: b.end }, end: { $gte: b.start } })) throw err(422, 'These dates overlap another leave request');
  if (t.quota != null) {
    const bal = (await leaveBalance(user.employeeId, b.start.slice(0, 4))).find((x) => x.key === t.key);
    if (days > bal.left) throw err(422, `Not enough ${t.name} leave: ${bal.left} day(s) left, ${days} requested`);
  }
  const l = { _id: uid(), employeeId: user.employeeId, type: t.key, start: b.start, end: b.end, days, reason: b.reason.trim(), status: 'pending', comment: '', createdAt: nowISO() };
  await d.collection('leaves').insertOne(l);
  await audit(user, 'create', 'leave', l._id, null, l);
  return l;
}
export async function listLeaves(user, q = {}) {
  const d = await db(); const f = user.role === 'employee' ? { employeeId: user.employeeId } : {};
  if (q.status) f.status = q.status;
  const items = await d.collection('leaves').find(f).sort({ createdAt: -1 }).limit(100).toArray();
  const emps = Object.fromEntries((await d.collection('employees').find().toArray()).map((e) => [e._id, e]));
  return items.map((l) => ({ ...l, employee: emps[l.employeeId]?.name, isHr: !!emps[l.employeeId]?.isHr, own: l.employeeId === user.employeeId }));
}
export async function cancelLeave(user, id) {
  const d = await db(); const l = await d.collection('leaves').findOne({ _id: id, employeeId: user.employeeId });
  if (!l) throw err(404, 'Leave request not found');
  if (!['pending', 'approved'].includes(l.status) || (l.status === 'approved' && l.start <= R.localNow().date)) throw err(409, 'This request can no longer be cancelled');
  await d.collection('leaves').updateOne({ _id: id }, { $set: { status: 'cancelled' } });
  await audit(user, 'cancel', 'leave', id, { status: l.status }, { status: 'cancelled' });
  return { ok: true };
}
export async function decideLeave(user, id, { approve, comment }) {
  const d = await db(); const l = await d.collection('leaves').findOne({ _id: id });
  if (!l) throw err(404, 'Leave request not found');
  if (l.status !== 'pending') throw err(409, 'Already decided');
  const e = await d.collection('employees').findOne({ _id: l.employeeId });
  if (l.employeeId === user.employeeId) throw err(403, 'You cannot decide your own request');
  if (user.role === 'admin' && !e.isHr) throw err(403, 'Admin only decides HR staff requests; HR handles employees');
  const set = { status: approve ? 'approved' : 'rejected', comment: comment || '', decidedBy: user.name, decidedAt: nowISO() };
  await d.collection('leaves').updateOne({ _id: id }, { $set: set });
  await audit(user, approve ? 'approve' : 'reject', 'leave', id, { status: 'pending' }, set);
  await notifyEmployee(l.employeeId, `Leave ${set.status}`, `${l.start} to ${l.end} (${l.days} day/s). ${comment || ''}`);
  return { ok: true };
}
export async function onLeaveToday() {
  const d = await db(); const today = R.localNow().date;
  const ls = await d.collection('leaves').find({ status: 'approved', start: { $lte: today }, end: { $gte: today } }).toArray();
  const emps = Object.fromEntries((await d.collection('employees').find().toArray()).map((e) => [e._id, e.name]));
  return ls.map((l) => ({ name: emps[l.employeeId], type: l.type, until: l.end }));
}

/* ---------------- payroll ---------------- */
export async function buildPayroll(user, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw err(400, 'Month must look like 2026-10');
  const d = await db();
  const ex = await d.collection('payroll').findOne({ _id: month });
  if (ex?.status === 'finalized') throw err(409, 'This month is finalized and locked');
  const start = month + '-01', end = R.lastDay(month), x = await loadCtx(start, end);
  const dn = await deptNames(d);
  const emps = (await d.collection('employees').find({ joinDate: { $lte: end }, basic: { $gt: 0 } }).toArray()).filter((e) => !e.exitDate || e.exitDate >= start);
  const upto = end < x.today ? end : x.today;
  const items = emps.map((e) => {
    const from = e.joinDate > start ? e.joinDate : start, to = e.exitDate && e.exitDate < upto ? e.exitDate : upto;
    const dates = from <= to ? R.workingDays(from, to, x.s.weekend, x.hol) : [];
    const { t } = tally([e], dates, x);
    const unpaid = dates.filter((dt) => statusOf(e, dt, x) === 'on_leave' && (x.byEmp[e._id] || []).some((l) => l.type === 'unpaid' && l.start <= dt && l.end >= dt)).length;
    const line = R.payrollLine({ basic: e.basic, month, joinDate: e.joinDate, exitDate: e.exitDate, weekend: x.s.weekend, holidays: x.hol, absent: t.absent, unpaid, half: t.half_day });
    return { employeeId: e._id, code: e.code, name: e.name, deptId: e.deptId, department: dn[e.deptId] || 'Unassigned', designation: e.designation, basic: e.basic, ...line };
  });
  const totals = { gross: sum(items, (i) => i.earned), deduction: sum(items, (i) => i.deduction), tax: sum(items, (i) => i.tax), net: sum(items, (i) => i.net), employees: items.length };
  const run = { _id: month, month, status: 'draft', items, totals, company: x.s.companyName, createdBy: user.name, createdAt: nowISO() };
  await d.collection('payroll').replaceOne({ _id: month }, run, { upsert: true });
  await audit(user, ex ? 'update' : 'create', 'payroll', month, ex ? { totals: ex.totals } : null, { totals });
  return run;
}
export async function payrollRuns() {
  const d = await db();
  return (await d.collection('payroll').find({}, { projection: { items: 0 } }).sort({ month: -1 }).toArray());
}
export async function payrollRun(month) {
  const d = await db(); const r = await d.collection('payroll').findOne({ _id: month });
  if (!r) throw err(404, 'No payroll run for this month yet');
  return r;
}
export async function finalizePayroll(user, month) {
  const d = await db(); const r = await d.collection('payroll').findOne({ _id: month });
  if (!r) throw err(404, 'Create the draft first');
  if (r.status === 'finalized') throw err(409, 'Already finalized');
  const set = { status: 'finalized', finalizedBy: user.name, finalizedAt: nowISO() };
  await d.collection('payroll').updateOne({ _id: month }, { $set: set });
  await audit(user, 'finalize', 'payroll', month, { status: 'draft' }, { ...set, totals: r.totals });
  for (const i of r.items) await notifyEmployee(i.employeeId, 'Payslip ready', `Your payslip for ${month} is available.`);
  return { ok: true };
}
export async function payslips(user, q) {
  const d = await db(); const runs = await d.collection('payroll').find({ status: 'finalized' }).sort({ month: -1 }).toArray();
  const eid = user.role === 'employee' ? user.employeeId : q.employeeId || user.employeeId || null;
  const out = [];
  for (const r of runs) for (const i of r.items) if (!eid || i.employeeId === eid) out.push({ ...i, month: r.month, company: r.company });
  return out.slice(0, 200);
}
export async function payrollSummary(month) {
  const d = await db();
  const r = month ? await d.collection('payroll').findOne({ _id: month }) : (await d.collection('payroll').find().sort({ month: -1 }).limit(1).toArray())[0];
  if (!r) return { message: 'No payroll run exists yet' };
  return { month: r.month, status: r.status, totals: r.totals };
}

/* ---------------- dashboards ---------------- */
export async function companyKpis({ from, to, deptId } = {}) {
  const d = await db(); const now = R.localNow().date;
  to = to || now; from = from || to.slice(0, 7) + '-01';
  if (!R.isDate(from) || !R.isDate(to) || from > to) throw err(422, 'Invalid date range');
  const dn = await deptNames(d); dn[''] = 'Unassigned';
  const emps = await d.collection('employees').find(deptId ? { deptId } : {}).toArray();
  const x = await loadCtx(from, to);
  const inRange = emps.filter((e) => e.joinDate <= to && (!e.exitDate || e.exitDate >= from));
  const hcAt = (day, list = emps) => list.filter((e) => e.joinDate <= day && (!e.exitDate || e.exitDate > day)).length;
  const headcount = hcAt(to), avg = (hcAt(from) + headcount) / 2;
  const exits = emps.filter((e) => e.exitDate && e.exitDate >= from && e.exitDate <= to).length;
  const end = to < now ? to : now, dates = R.workingDays(from, end, x.s.weekend, x.hol);
  const { t, perEmp } = tally(inRange, dates, x), rt = rates(t);
  const tx = await loadCtx(now, now), todayS = emps.map((e) => statusOf(e, now, tx));
  const today = { present: todayS.filter((s) => ['present', 'late', 'half_day'].includes(s)).length, late: todayS.filter((s) => s === 'late').length, onLeave: todayS.filter((s) => s === 'on_leave').length, notYet: todayS.filter((s) => s === null && emps.some(() => R.isWorkingDay(now, tx.s.weekend, tx.hol))).length };
  const trend = dates.slice(-31).map((dt) => {
    const c = { a: 0, exp: 0 };
    for (const e of inRange) { const s = statusOf(e, dt, x); if (!s || s === 'on_leave') continue; c.exp++; if (s !== 'absent') c.a += s === 'half_day' ? 0.5 : 1; }
    return { date: dt, rate: c.exp ? +((c.a / c.exp) * 100).toFixed(1) : 0 };
  });
  const groups = {}; inRange.forEach((e) => (groups[e.deptId || ''] ??= []).push(e));
  const byDept = Object.entries(groups).map(([k, list]) => { const r = tally(list, dates, x).t; return { dept: dn[k] || 'Unassigned', headcount: hcAt(to, list), ...rates(r) }; });
  const ids = new Set(inRange.map((e) => e._id)), types = await d.collection('leavetypes').find().toArray(), lt = {};
  for (const l of x.leaves) if (ids.has(l.employeeId)) lt[l.type] = (lt[l.type] || 0) + R.workingDays(l.start > from ? l.start : from, l.end < to ? l.end : to, x.s.weekend, x.hol).length;
  const leaveByType = types.map((y) => ({ type: y.name, days: lt[y.key] || 0, utilization: y.quota && headcount ? +(((lt[y.key] || 0) / (y.quota * headcount)) * 100).toFixed(1) : null }));
  const topLate = inRange.map((e) => ({ name: e.name, late: perEmp[e._id].late })).filter((z) => z.late > 0).sort((a, b) => b.late - a.late).slice(0, 5);
  const pendingApprovals = (await d.collection('leaves').countDocuments({ status: 'pending' })) + (await d.collection('corrections').countDocuments({ status: 'pending' }));
  return { range: { from, to, deptId: deptId || null }, headcount, exits, attritionPct: avg ? +((exits / avg) * 100).toFixed(1) : 0, today, ...rt, tally: t, trend, byDept, leaveByType, topLate, pendingApprovals };
}
async function adminExtras({ from, to, deptId }) {
  const d = await db(); const k = (await companyKpis({ from, to, deptId })).range, dn = await deptNames(d);
  const emps = (await d.collection('employees').find(deptId ? { deptId } : {}).toArray()).filter((e) => e.joinDate <= k.to && (!e.exitDate || e.exitDate > k.to));
  const runs = await d.collection('payroll').find({ month: { $gte: k.from.slice(0, 7), $lte: k.to.slice(0, 7) } }).toArray();
  const payByMonth = runs.map((r) => ({ month: r.month, status: r.status, gross: r.totals.gross, net: r.totals.net }));
  const pd = {}; runs.forEach((r) => r.items.filter((i) => !deptId || i.deptId === deptId).forEach((i) => { pd[i.department] = (pd[i.department] || 0) + i.net; }));
  const avgBy = {}; emps.forEach((e) => { const n = dn[e.deptId] || 'Unassigned'; (avgBy[n] ??= []).push(e.basic * 1.5); });
  const gender = {}; emps.forEach((e) => { const g = e.gender || 'unspecified'; gender[g] = (gender[g] || 0) + 1; });
  const tenure = { 'under 1 year': 0, '1 to 3 years': 0, 'over 3 years': 0 };
  emps.forEach((e) => { const y = (Date.parse(k.to) - Date.parse(e.joinDate)) / 31557600000; tenure[y < 1 ? 'under 1 year' : y < 3 ? '1 to 3 years' : 'over 3 years']++; });
  const audit5 = await d.collection('audit').find().sort({ at: -1 }).limit(8).toArray();
  return {
    payrollCost: sum(payByMonth, (p) => p.net), payByMonth,
    payByDept: Object.entries(pd).map(([dept, net]) => ({ dept, net })),
    avgSalary: emps.length ? Math.round(sum(emps, (e) => e.basic * 1.5) / emps.length) : 0,
    avgSalaryByDept: Object.entries(avgBy).map(([dept, a]) => ({ dept, avg: Math.round(sum(a, (z) => z) / a.length) })),
    gender: Object.entries(gender).map(([k2, v]) => ({ label: k2, value: v })), tenure: Object.entries(tenure).map(([k2, v]) => ({ label: k2, value: v })), audit: audit5,
  };
}
async function employeeDash(user) {
  if (!user.employeeId) throw err(403, 'No employee profile');
  const d = await db(); const today = R.localNow().date, ms = today.slice(0, 7) + '-01';
  const back = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7, ws = R.addDays(today, -back);
  const e = await d.collection('employees').findOne({ _id: user.employeeId });
  const week = await d.collection('attendance').find({ employeeId: e._id, date: { $gte: ws, $lte: today } }).toArray();
  const hoursWeek = +sum(week, (a) => (a.checkOut ? a.hours : (Date.now() - Date.parse(a.checkIn)) / 3600000)).toFixed(1);
  const x = await loadCtx(ms, today); const { t } = tally([e], R.workingDays(ms, today, x.s.weekend, x.hol), x);
  const slip = (await payslips(user, {}))[0] || null;
  return { mode: 'employee', hoursWeek, target: 40, lateCount: t.late, month: { ...t, ...rates(t) }, balance: await leaveBalance(e._id), lastPayslip: slip && { month: slip.month, net: slip.net } };
}
export async function dashboard(user, q) {
  const announcements = (await listAnnouncements()).slice(0, 3);
  if (user.role === 'employee') return { ...(await employeeDash(user)), announcements };
  const kpis = await companyKpis(q);
  return { mode: user.role, kpis, extras: user.role === 'admin' ? await adminExtras(q) : null, announcements };
}
export async function myTally(user, { from, to }) {
  if (!user.employeeId) throw err(403, 'No employee profile');
  const d = await db(); const today = R.localNow().date; to = to || today; from = from || to.slice(0, 7) + '-01';
  const e = await d.collection('employees').findOne({ _id: user.employeeId }); const x = await loadCtx(from, to);
  const { t } = tally([e], R.workingDays(from, to < today ? to : today, x.s.weekend, x.hol), x);
  return { range: { from, to }, counts: t, ...rates(t) };
}
