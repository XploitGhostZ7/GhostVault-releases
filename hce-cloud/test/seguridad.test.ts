// By Kompilador
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totpAt } from '../src/lib/totp.js';
import { APP_URL } from './env.js';
import { PASSWORD, client, login, makeApp, nuevoTenant, ok } from './helpers.js';

const paciente = (doc: string) => ({
  tipo_documento: 'CC', numero_documento: doc, primer_nombre: 'Luis', primer_apellido: 'Pérez',
  fecha_nacimiento: '1975-03-02', sexo: 'H', consentimiento_datos: true,
});

describe('aislamiento entre prestadores', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await makeApp();
  });
  afterAll(async () => app.close());

  it('un tenant no ve ni modifica datos de otro', async () => {
    const a = await nuevoTenant('iso-a');
    const b = await nuevoTenant('iso-b');
    const adminA = await login(app, a.slug, a.email);
    const adminB = await login(app, b.slug, b.email);

    const p = ok(await adminA.post('/patients', paciente('11223344')), 201);
    expect((await adminB.get(`/patients/${p.id}`)).status).toBe(404);
    expect(ok<any[]>(await adminB.get('/patients?q=11223344'))).toHaveLength(0);
    expect((await adminB.patch(`/patients/${p.id}`, { telefono: '3000000000' })).status).toBe(404);
    ok(await adminB.post('/patients', paciente('11223344')), 201);

    const usersB = ok<any[]>(await adminB.get('/users'));
    expect(usersB.every((u) => u.email.endsWith(`${b.slug}.co`))).toBe(true);
  });

  it('sin tenant establecido la base no devuelve filas', async () => {
    const c = new pg.Client({ connectionString: APP_URL });
    await c.connect();
    const r = await c.query('select count(*)::int as n from patients');
    expect(r.rows[0].n).toBe(0);
    await expect(c.query("insert into patients (tipo_documento, numero_documento, primer_nombre, primer_apellido, fecha_nacimiento, sexo) values ('CC','5555','A','B','2000-01-01','H')")).rejects.toThrow();
    await c.end();
  });
});

describe('autenticación', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await makeApp({ MFA_REQUIRED: 'true' });
  });
  afterAll(async () => app.close());

  it('exige MFA antes de operar y lo valida en el login', async () => {
    const t = await nuevoTenant('mfa');
    const r = ok(await client(app).post('/auth/login', { tenant: t.slug, email: t.email, password: PASSWORD }));
    expect(r.mfaPendiente).toBe(true);
    const sinMfa = client(app, r.token);
    expect((await sinMfa.get('/users')).status).toBe(403);

    const { secret, otpauth } = ok(await sinMfa.post('/auth/mfa/enroll'));
    expect(otpauth).toContain('otpauth://totp/');
    expect((await sinMfa.post('/auth/mfa/confirm', { code: '000000' })).status).toBe(403);
    const { token } = ok(await sinMfa.post('/auth/mfa/confirm', { code: totpAt(secret, Date.now()) }));
    ok(await client(app, token).get('/users'));

    const sinCodigo = await client(app).post('/auth/login', { tenant: t.slug, email: t.email, password: PASSWORD });
    expect(sinCodigo.status).toBe(401);
    expect(sinCodigo.body.detalle).toEqual({ mfaRequerido: true });
    const conCodigo = await login(app, t.slug, t.email, PASSWORD, totpAt(secret, Date.now()));
    ok(await conCodigo.get('/auth/me'));
  });

  it('bloquea la cuenta tras intentos fallidos y responde igual a usuarios inexistentes', async () => {
    const t = await nuevoTenant('lock');
    const anon = client(app);
    const inexistente = await anon.post('/auth/login', { tenant: t.slug, email: 'nadie@x.co', password: 'x' });
    const tenantFalso = await anon.post('/auth/login', { tenant: 'no-existe', email: t.email, password: 'x' });
    expect(inexistente.status).toBe(401);
    expect(tenantFalso.body).toEqual(inexistente.body);

    for (let i = 0; i < 5; i++) {
      expect((await anon.post('/auth/login', { tenant: t.slug, email: t.email, password: 'incorrecta' })).status).toBe(401);
    }
    expect((await anon.post('/auth/login', { tenant: t.slug, email: t.email, password: PASSWORD })).status).toBe(429);
  });

  it('rechaza tokens manipulados', async () => {
    const t = await nuevoTenant('jwt');
    const r = ok(await client(app).post('/auth/login', { tenant: t.slug, email: t.email, password: PASSWORD }));
    const [h, p, s] = r.token.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    const falso = `${h}.${Buffer.from(JSON.stringify({ ...payload, mfa: true })).toString('base64url')}.${s}`;
    expect((await client(app, falso).get('/users')).status).toBe(401);
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${p}.`;
    expect((await client(app, none).get('/users')).status).toBe(401);
  });
});
