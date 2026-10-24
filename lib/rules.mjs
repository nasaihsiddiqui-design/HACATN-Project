// Pure business rules (no DB). Unit-tested in tests/.
export const TZ_OFFSET_MIN = Number(process.env.TZ_OFFSET_MIN ?? 300);
export const round = (n) => Math.round(n);
export const localNow = (d = new Date()) => {
  const l = new Date(d.getTime() + TZ_OFFSET_MIN * 60000);
  return { date: l.toISOString().slice(0, 10), minutes: l.getUTCHours() * 60 + l.getUTCMinutes() };
};
export const toMin = (h) => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
export const localToISO = (date, hhmm) => new Date(Date.parse(`${date}T${hhmm}:00Z`) - TZ_OFFSET_MIN * 60000).toISOString();
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
export const addDays = (date, n) => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const eachDay = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
export const lastDay = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
export const isWorkingDay = (date, weekend = [0, 6], holidays = new Set()) =>
  !weekend.includes(new Date(date + 'T00:00:00Z').getUTCDay()) && !holidays.has(date);
export const workingDays = (from, to, weekend, holidays) => eachDay(from, to).filter((d) => isWorkingDay(d, weekend, holidays));

// Late after start + grace (09:15). half_day when worked hours < halfDayHours.
export const checkInStatus = (minutes, s) => (minutes > toMin(s.officeStart) + s.graceMin ? 'late' : 'present');
export const afterCheckOut = (status, hours, s) => (hours < s.halfDayHours ? 'half_day' : status);

// Illustrative annual tax slab on gross x 12
export function annualTax(a) {
  if (a <= 600000) return 0;
  if (a <= 1200000) return (a - 600000) * 0.05;
  if (a <= 2400000) return 30000 + (a - 1200000) * 0.15;
  if (a <= 3600000) return 210000 + (a - 2400000) * 0.25;
  return 510000 + (a - 3600000) * 0.35;
}

export function haversine(lat1, lng1, lat2, lng2) {
  const t = (x) => (x * Math.PI) / 180, R = 6371000;
  const a = Math.sin(t(lat2 - lat1) / 2) ** 2 + Math.cos(t(lat1)) * Math.cos(t(lat2)) * Math.sin(t(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Gross = 1.5 x basic. Per day = gross / working days. Deduct absent + unpaid + 0.5 x half. Prorate joiners/leavers.
export function payrollLine({ basic, month, joinDate, exitDate, weekend, holidays, absent = 0, unpaid = 0, half = 0 }) {
  const start = `${month}-01`, end = lastDay(month);
  const all = workingDays(start, end, weekend, holidays).length;
  const from = joinDate && joinDate > start ? joinDate : start;
  const to = exitDate && exitDate < end ? exitDate : end;
  const employedDays = from <= to ? workingDays(from, to, weekend, holidays).length : 0;
  const gross = round(basic * 1.5);
  const perDay = all ? gross / all : 0;
  const earned = round(perDay * employedDays);
  const deduction = round(perDay * (absent + unpaid + 0.5 * half));
  const tax = round(((annualTax(gross * 12) / 12) * (all ? employedDays / all : 0)));
  const net = Math.max(0, earned - deduction - tax);
  return { gross, hra: round(basic * 0.4), medical: round(basic * 0.1), workingDays: all, employedDays, absent, unpaid, half, perDay: round(perDay), earned, deduction, tax, net };
}
