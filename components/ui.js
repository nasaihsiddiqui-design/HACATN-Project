'use client';
import { useState, useEffect, useCallback } from 'react';

export async function api(path, { method = 'GET', body } = {}) {
  const t = typeof window !== 'undefined' ? localStorage.getItem('hcm_token') : null;
  const r = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Request failed'); e.status = r.status; e.details = j.details; throw e; }
  return j;
}

export function useLoad(fn, deps = []) {
  const [s, set] = useState({ data: null, loading: true, error: null });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(async () => {
    set((p) => ({ ...p, loading: true, error: null }));
    try { set({ data: await fn(), loading: false, error: null }); }
    catch (e) { set({ data: null, loading: false, error: e.message }); }
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...s, reload: run };
}

export function useAct() {
  const [m, setM] = useState(null); const [busy, setBusy] = useState(false);
  const run = async (fn, ok) => {
    setBusy(true); setM(null);
    try { const r = await fn(); if (ok) setM({ ok: typeof ok === 'function' ? ok(r) : ok }); return r; }
    catch (e) { setM({ err: e.message, details: e.details }); }
    finally { setBusy(false); }
  };
  return { m, busy, run, setM };
}

export const Msg = ({ m }) => !m ? null : m.err ? (
  <div className="err" role="alert">{m.err}{m.details && <ul>{m.details.map((d, i) => <li key={i}>{d.row ? `Row ${d.row}: ` : ''}{d.field} — {d.reason}</li>)}</ul>}</div>
) : <div className="ok" role="status">{m.ok}</div>;

export const Card = ({ title, right, children, className = '' }) => (
  <section className={'card ' + className}>
    {title && <div className="card-h"><h3>{title}</h3>{right}</div>}
    {children}
  </section>
);

export const Load = ({ s, empty, children }) => s.loading ? <p className="muted">Loading…</p>
  : s.error ? <p className="err">{s.error}</p>
  : empty && (!s.data || (Array.isArray(s.data) && !s.data.length)) ? <p className="muted">{empty}</p> : children;

export const Kpi = ({ label, value, sub, tone }) => (
  <div className={'kpi ' + (tone || '')}><div className="kv">{value}</div><div className="kl">{label}</div>{sub && <div className="ks">{sub}</div>}</div>
);

export function Table({ cols, rows, empty = 'Nothing here yet.' }) {
  if (!rows?.length) return <p className="muted">{empty}</p>;
  return (
    <div className="tw"><table>
      <thead><tr>{cols.map((c) => <th key={c.h}>{c.h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={r._id || r.id || i}>{cols.map((c) => <td key={c.h}>{c.f ? c.f(r) : r[c.k]}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

export const Badge = ({ v }) => <span className={'badge b-' + String(v).replace(/[^a-z_]/gi, '')}>{String(v).replace(/_/g, ' ')}</span>;

export function Bars({ data, label = 'label', value = 'value', suffix = '', empty = 'No data in this range.' }) {
  if (!data?.length) return <p className="muted">{empty}</p>;
  const max = Math.max(...data.map((d) => d[value]), 1);
  return <div className="bars">{data.map((d, i) => (
    <div className="bar" key={i}><span className="bl">{d[label]}</span><span className="bt"><i style={{ width: (d[value] / max) * 100 + '%' }} /></span><span className="bv">{d[value]}{suffix}</span></div>
  ))}</div>;
}

export function Line({ data }) {
  if (!data?.length) return <p className="muted">No working days in this range yet.</p>;
  const W = 320, H = 110, p = 8, n = data.length;
  const pts = data.map((d, i) => [p + (n === 1 ? 0 : (i / (n - 1)) * (W - 2 * p)), H - p - (d.rate / 100) * (H - 2 * p)]);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="line" role="img" aria-label="Attendance rate trend">
        <line x1={p} x2={W - p} y1={H - p} y2={H - p} className="axis" />
        <polyline points={pts.map((q) => q.join(',')).join(' ')} fill="none" className="path" />
        {pts.map((q, i) => <circle key={i} cx={q[0]} cy={q[1]} r="2.5" className="dot"><title>{data[i].date}: {data[i].rate}%</title></circle>)}
      </svg>
      <div className="muted small">{data[0].date} to {data[n - 1].date} · attendance rate per day</div>
    </div>
  );
}

export const money = (n) => 'Rs ' + Math.round(n || 0).toLocaleString('en-PK');
export const hm = (iso) => iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—';
export const today = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
export function download(name, text, type = 'text/csv') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
}
export const form = (e) => { e.preventDefault(); return Object.fromEntries(new FormData(e.target)); };
