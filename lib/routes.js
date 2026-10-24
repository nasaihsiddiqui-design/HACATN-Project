import * as S from './services.js';
import * as AI from './ai.js';

const A = 'admin', H = 'hr', E = 'employee', ALL = [A, H, E], AH = [A, H], HE = [H, E];
export const routes = [];
const r = (method, path, roles, fn, opts = {}) => routes.push({ method, path, roles, fn, ...opts });

// public
r('GET', '/setup/status', null, () => S.setupStatus());
r('POST', '/setup', null, ({ body }) => S.runSetup(body));
r('POST', '/auth/login', null, ({ body }) => S.login(body));
// auth
r('GET', '/auth/me', ALL, ({ user }) => ({ user }), { allowMustChange: true });
r('POST', '/auth/change-password', ALL, ({ user, body }) => S.changePassword(user, body), { allowMustChange: true });
// company setup
r('GET', '/settings', ALL, () => S.getSettings());
r('PUT', '/settings', [A], ({ user, body }) => S.updateSettings(user, body));
r('GET', '/lookup/:kind', ALL, ({ params }) => S.lookupList(params.kind));
r('POST', '/lookup/:kind', [A], ({ user, params, body }) => S.lookupSave(user, params.kind, null, body));
r('PUT', '/lookup/:kind/:id', [A], ({ user, params, body }) => S.lookupSave(user, params.kind, params.id, body));
r('DELETE', '/lookup/:kind/:id', [A], ({ user, params }) => S.lookupDelete(user, params.kind, params.id));
// logins
r('GET', '/users', [A], () => S.listUsers());
r('POST', '/users/hr', [A], ({ user, body }) => S.createHr(user, body));
r('POST', '/users/:id/active', [A], ({ user, params, body }) => S.setActive(user, params.id, body.active));
r('POST', '/users/:id/reset', [A], ({ user, params }) => S.resetPassword(user, params.id));
// employees
r('GET', '/employees', ALL, ({ user, query }) => S.employeeList(user, query));
r('GET', '/employees/export', [H], () => S.exportCsv());
r('POST', '/employees/import', [H], ({ user, body }) => S.importCsv(user, body));
r('POST', '/employees', [H], ({ user, body }) => S.createEmployee(user, body));
r('GET', '/employees/:id', ALL, ({ user, params }) => S.employee360(user, params.id));
r('PUT', '/employees/:id', [H], ({ user, params, body }) => S.updateEmployee(user, params.id, body));
r('PUT', '/me/profile', ALL, ({ user, body }) => S.updateProfile(user, body));
// attendance
r('GET', '/attendance/today', HE, ({ user }) => S.todayRecord(user));
r('POST', '/attendance/checkin', HE, ({ user, body }) => S.checkIn(user, body));
r('POST', '/attendance/checkout', HE, ({ user }) => S.checkOut(user));
r('GET', '/attendance/me', HE, ({ user, query }) => S.myCalendar(user, query.month));
r('GET', '/attendance/board', AH, ({ query }) => S.board(query));
r('GET', '/corrections', ALL, ({ user }) => S.listCorrections(user));
r('POST', '/corrections', HE, ({ user, body }) => S.requestCorrection(user, body));
r('POST', '/corrections/:id/decision', [H], ({ user, params, body }) => S.decideCorrection(user, params.id, body));
// leave
r('GET', '/leave/balance', HE, ({ user }) => S.leaveBalance(user.employeeId));
r('GET', '/leave', ALL, ({ user, query }) => S.listLeaves(user, query));
r('POST', '/leave', HE, ({ user, body }) => S.applyLeave(user, body));
r('POST', '/leave/:id/cancel', HE, ({ user, params }) => S.cancelLeave(user, params.id));
r('POST', '/leave/:id/decision', AH, ({ user, params, body }) => S.decideLeave(user, params.id, body));
// payroll
r('GET', '/payroll', AH, () => S.payrollRuns());
r('GET', '/payroll/:month', AH, ({ params }) => S.payrollRun(params.month));
r('POST', '/payroll/:month/draft', [H], ({ user, params }) => S.buildPayroll(user, params.month));
r('POST', '/payroll/:month/finalize', [A], ({ user, params }) => S.finalizePayroll(user, params.month));
r('GET', '/payslips', ALL, ({ user, query }) => S.payslips(user, query));
// dashboards, comms, audit
r('GET', '/dashboard', ALL, ({ user, query }) => S.dashboard(user, query));
r('GET', '/announcements', ALL, () => S.listAnnouncements());
r('POST', '/announcements', AH, ({ user, body }) => S.postAnnouncement(user, body));
r('GET', '/notifications', ALL, ({ user }) => S.listNotifications(user));
r('POST', '/notifications/read', ALL, ({ user }) => S.readNotifications(user));
r('GET', '/audit', [A], ({ query }) => S.listAudit(query));
// AI
r('POST', '/ai/chat', ALL, ({ user, body }) => AI.chat(user, body));
r('POST', '/ai/summary', AH, ({ user, body }) => AI.summary(user, body));
r('POST', '/ai/leave', HE, ({ user, body }) => AI.smartLeave(user, body));
