// By Kompilador
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { createTenant } from '../scripts/create-tenant.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { SandboxFEV, SandboxValidadorRips } from '../src/modules/billing/providers.js';
import { APP_URL, OWNER_URL } from './env.js';

export const PASSWORD = 'Clave-Segura-2026';

export async function makeApp(overrides: Record<string, string> = {}): Promise<FastifyInstance> {
  const config = loadConfig({
    DATABASE_URL: APP_URL,
    JWT_SECRET: randomBytes(48).toString('base64'),
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    MFA_REQUIRED: 'false',
    ...overrides,
  });
  const pool = createPool(APP_URL);
  const app = await buildApp({ config, pool, fev: new SandboxFEV(), ripsValidator: new SandboxValidadorRips() });
  app.addHook('onClose', async () => pool.end());
  return app;
}

let n = 0;
export async function nuevoTenant(prefijo = 'ips') {
  const slug = `${prefijo}-${Date.now().toString(36)}-${n++}`;
  const email = `admin@${slug}.co`;
  const r = await createTenant(OWNER_URL, {
    slug,
    razonSocial: `IPS ${slug} S.A.S.`,
    nit: '900123456',
    dv: '7',
    codigoPrestador: '110010000001',
    municipio: '11001',
    admin: { email, nombre: 'Admin Prueba', tipoDocumento: 'CC', numeroDocumento: '1010101010', password: PASSWORD },
  });
  return { ...r, slug, email };
}

export type Api = ReturnType<typeof client>;

export function client(app: FastifyInstance, token?: string) {
  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
    const res = await app.inject({
      method,
      url,
      payload: payload as any,
      remoteAddress: `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    const isJson = (res.headers['content-type'] ?? '').toString().includes('json');
    return { status: res.statusCode, body: isJson && res.body ? res.json() : res.body, raw: res };
  };
  return {
    get: (u: string) => call('GET', u),
    post: (u: string, p?: unknown) => call('POST', u, p ?? {}),
    patch: (u: string, p: unknown) => call('PATCH', u, p),
    del: (u: string) => call('DELETE', u),
  };
}

export async function login(app: FastifyInstance, tenant: string, email: string, password = PASSWORD, totp?: string) {
  const r = await client(app).post('/auth/login', { tenant, email, password, ...(totp ? { totp } : {}) });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return client(app, r.body.token);
}

export function ok<T = any>(r: { status: number; body: any }, status = 200): T {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body as T;
}
