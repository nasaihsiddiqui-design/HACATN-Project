import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../lib/rules.mjs';

const s = { officeStart: '09:00', graceMin: 15, halfDayHours: 5 };

test('late only after 09:15', () => {
  assert.equal(R.checkInStatus(9 * 60 + 15, s), 'present');
  assert.equal(R.checkInStatus(9 * 60 + 16, s), 'late');
});
test('half day under 5 hours', () => {
  assert.equal(R.afterCheckOut('present', 4.9, s), 'half_day');
  assert.equal(R.afterCheckOut('late', 8, s), 'late');
});
test('working days skip weekend and holidays', () => {
  assert.equal(R.workingDays('2026-10-19', '2026-10-25', [0, 6], new Set()).length, 5);
  assert.equal(R.workingDays('2026-10-19', '2026-10-25', [0, 6], new Set(['2026-10-20'])).length, 4);
});
test('tax slab', () => {
  assert.equal(R.annualTax(600000), 0);
  assert.equal(R.annualTax(1200000), 30000);
  assert.equal(R.annualTax(2400000), 210000);
  assert.equal(R.annualTax(3600000), 510000);
});
test('payroll line', () => {
  const l = R.payrollLine({ basic: 100000, month: '2026-10', joinDate: '2026-01-01', weekend: [0, 6], holidays: new Set(), absent: 1 });
  assert.equal(l.gross, 150000);
  assert.equal(l.workingDays, 22);
  assert.equal(l.deduction, Math.round(150000 / 22));
  assert.equal(l.tax, 10000);
});
test('payroll prorates joiners', () => {
  const l = R.payrollLine({ basic: 100000, month: '2026-10', joinDate: '2026-10-19', weekend: [0, 6], holidays: new Set() });
  assert.equal(l.employedDays, 10);
});
test('haversine ~111km per degree', () => {
  assert.ok(Math.abs(R.haversine(0, 0, 1, 0) - 111195) < 500);
});
