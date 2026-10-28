// By Kompilador
import { NextResponse, type NextRequest } from 'next/server';
import { API_URL, CSRF_HEADER, SESSION_COOKIE, cookieOptions, tokenExp } from '@/lib/session';

const RENOVAR_ANTES_MS = 10 * 60_000;
const EMITEN_TOKEN = new Set(['auth/mfa/confirm', 'auth/refresh']);
const BLOQUEADAS = new Set(['auth/login']);
const PASAR_HEADERS = ['content-type', 'content-disposition', 'cache-control'];

type Ctx = { params: Promise<{ path: string[] }> };

async function renovar(token: string): Promise<string | null> {
  const r = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
    cache: 'no-store',
  });
  if (!r.ok) return null;
  return ((await r.json()) as { token: string }).token;
}

async function proxy(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  const ruta = path.map((s) => encodeURIComponent(s).replace(/^%24/, '$')).join('/');
  if (BLOQUEADAS.has(ruta)) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  if (req.method !== 'GET' && req.headers.get(CSRF_HEADER) !== '1') {
    return NextResponse.json({ error: 'Solicitud no permitida' }, { status: 403 });
  }

  let token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: 'Sesión expirada' }, { status: 401 });

  let tokenNuevo: string | null = null;
  if (tokenExp(token) - Date.now() < RENOVAR_ANTES_MS && !EMITEN_TOKEN.has(ruta)) {
    tokenNuevo = await renovar(token);
    if (tokenNuevo) token = tokenNuevo;
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '',
  };
  const ct = req.headers.get('content-type');
  if (ct) headers['content-type'] = ct;
  const conCuerpo = req.method !== 'GET' && req.method !== 'HEAD';
  const upstream = await fetch(`${API_URL}/${ruta}${req.nextUrl.search}`, {
    method: req.method,
    headers,
    body: conCuerpo ? await req.arrayBuffer() : undefined,
    cache: 'no-store',
  });

  let res: NextResponse;
  if (EMITEN_TOKEN.has(ruta) && upstream.ok) {
    const data = (await upstream.json()) as { token?: string };
    if (data.token) tokenNuevo = data.token;
    res = NextResponse.json({ ok: true });
  } else {
    const out = new Headers();
    for (const h of PASAR_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    const cuerpo = upstream.status === 204 ? null : await upstream.arrayBuffer();
    res = new NextResponse(cuerpo, { status: upstream.status, headers: out });
  }
  if (tokenNuevo) res.cookies.set(SESSION_COOKIE, tokenNuevo, cookieOptions());
  if (upstream.status === 401) res.cookies.set(SESSION_COOKIE, '', { ...cookieOptions(), maxAge: 0 });
  return res;
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
