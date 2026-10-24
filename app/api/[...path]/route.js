import { NextResponse } from 'next/server';
import { routes } from '@/lib/routes.js';
import { authUser, HttpError } from '@/lib/services.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function match(pattern, path) {
  const a = pattern.split('/'), b = path.split('/');
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

async function handle(req, { params }) {
  const path = '/' + (params.path || []).join('/');
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const p = match(r.path, path);
      if (!p) continue;
      let user = null;
      if (r.roles) {
        user = await authUser(req); // role + data scope are checked on the server for every request
        if (!r.roles.includes(user.role)) throw new HttpError(403, 'Your role cannot do this');
        if (user.mustChange && !r.allowMustChange) throw new HttpError(403, 'Change your temporary password first');
      }
      let body = {};
      if (req.method !== 'GET' && req.method !== 'DELETE') { try { body = await req.json(); } catch { body = {}; } }
      const query = Object.fromEntries(new URL(req.url).searchParams);
      const out = await r.fn({ user, body, query, params: p });
      return NextResponse.json(out ?? { ok: true });
    }
    throw new HttpError(404, 'Not found');
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: e.message?.includes('MONGODB_URI') || e.message?.includes('JWT_SECRET') ? e.message : 'Server error' }, { status: 500 });
  }
}
export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
