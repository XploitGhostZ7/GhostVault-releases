// By Kompilador
import 'server-only';
import { cookies } from 'next/headers';
import type { Me } from './session-types';

export type { Me, Rol } from './session-types';

export const SESSION_COOKIE = 'hce_session';
export const CSRF_HEADER = 'x-hce-request';
export const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const MAX_AGE = 30 * 60;

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.SESSION_COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge: MAX_AGE,
  };
}

export async function getToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export function tokenExp(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export async function getMe(): Promise<Me | null> {
  const token = await getToken();
  if (!token) return null;
  const r = await fetch(`${API_URL}/auth/me`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!r.ok) return null;
  return (await r.json()) as Me;
}
