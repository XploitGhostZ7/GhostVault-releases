// By Kompilador
import { NextResponse, type NextRequest } from 'next/server';
import { API_URL, CSRF_HEADER, SESSION_COOKIE, cookieOptions } from '@/lib/session';

function forwardedFor(req: NextRequest): string {
  return req.headers.get('x-forwarded-for') ?? '';
}

export async function POST(req: NextRequest) {
  if (req.headers.get(CSRF_HEADER) !== '1') return NextResponse.json({ error: 'Solicitud no permitida' }, { status: 403 });
  const r = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor(req) },
    body: await req.text(),
    cache: 'no-store',
  });
  const data = await r.json().catch(() => ({ error: 'Servicio no disponible' }));
  if (!r.ok) return NextResponse.json(data, { status: r.status });
  const res = NextResponse.json({ mfaPendiente: data.mfaPendiente });
  res.cookies.set(SESSION_COOKIE, data.token, cookieOptions());
  return res;
}

export async function DELETE(req: NextRequest) {
  if (req.headers.get(CSRF_HEADER) !== '1') return NextResponse.json({ error: 'Solicitud no permitida' }, { status: 403 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { ...cookieOptions(), maxAge: 0 });
  return res;
}
