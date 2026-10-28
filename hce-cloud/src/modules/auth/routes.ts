// By Kompilador
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { one, withTenant } from '../../db.js';
import { audit, auth, parse, type AuthInfo, type Rol } from '../../http.js';
import {
  DUMMY_PASSWORD_HASH,
  decryptWithMasterKey,
  encryptWithMasterKey,
  verifyPassword,
} from '../../lib/crypto.js';
import { HttpError, conflict, forbidden, unauthorized } from '../../lib/errors.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../../lib/totp.js';

const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 15;
const ISSUER = 'hce-cloud';
const AUDIENCE = 'hce-api';

const loginSchema = z.object({
  tenant: z.string().min(3).max(40),
  email: z.string().email().transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(256),
  totp: z.string().regex(/^[0-9]{6}$/).optional(),
});

function secretKey(app: FastifyInstance): Uint8Array {
  return new TextEncoder().encode(app.ctx.config.JWT_SECRET);
}

export async function issueToken(app: FastifyInstance, a: AuthInfo): Promise<string> {
  return new SignJWT({ tid: a.tenantId, mfa: a.mfa })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(a.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(app.ctx.config.ACCESS_TOKEN_TTL)
    .sign(secretKey(app));
}

export async function authenticate(req: FastifyRequest): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return;
  const app = req.server;
  let payload;
  try {
    ({ payload } = await jwtVerify(header.slice(7), secretKey(app), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    }));
  } catch {
    throw unauthorized('Token inválido o vencido');
  }
  const tenantId = String(payload.tid ?? '');
  const userId = String(payload.sub ?? '');
  const user = await withTenant(app.ctx.pool, tenantId, (db) =>
    one<{ roles: Rol[]; activo: boolean }>(db, 'select roles, activo from users where id = $1', [userId]),
  );
  if (!user?.activo) throw unauthorized('Usuario inactivo');
  req.auth = { userId, tenantId, roles: user.roles, mfa: payload.mfa === true };
}

type LoginUser = {
  id: string;
  password_hash: string;
  roles: Rol[];
  activo: boolean;
  totp_secret: string | null;
  totp_enabled: boolean;
  intentos_fallidos: number;
  bloqueado_hasta: Date | null;
};

export function registerAuthRoutes(app: FastifyInstance) {
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const body = parse(loginSchema, req.body);
      const t = await app.ctx.pool.query<{ id: string | null }>('select tenant_lookup($1) as id', [body.tenant]);
      const tenantId = t.rows[0]?.id;
      if (!tenantId) {
        await verifyPassword(body.password, DUMMY_PASSWORD_HASH);
        throw unauthorized('Credenciales inválidas');
      }

      const outcome = await withTenant(app.ctx.pool, tenantId, async (db) => {
        const u = await one<LoginUser>(
          db,
          `select id, password_hash, roles, activo, totp_secret, totp_enabled, intentos_fallidos, bloqueado_hasta
             from users where email = $1 for update`,
          [body.email],
        );
        const fail = async (motivo: string) => {
          await audit(db, req, 'login_fallido', 'usuario', u?.id ?? null, null, { email: body.email, motivo });
          if (u) {
            const intentos = u.intentos_fallidos + 1;
            const bloquear = intentos >= MAX_INTENTOS;
            await db.query(
              `update users set intentos_fallidos = $2,
                 bloqueado_hasta = case when $3 then now() + make_interval(mins => $4) else bloqueado_hasta end
               where id = $1`,
              [u.id, bloquear ? 0 : intentos, bloquear, BLOQUEO_MIN],
            );
          }
          return { error: new HttpError(401, 'Credenciales inválidas') };
        };

        if (!u) {
          await verifyPassword(body.password, DUMMY_PASSWORD_HASH);
          return fail('usuario_inexistente');
        }
        if (u.bloqueado_hasta && u.bloqueado_hasta > new Date()) {
          await audit(db, req, 'login_bloqueado', 'usuario', u.id);
          return { error: new HttpError(429, 'Cuenta bloqueada temporalmente por intentos fallidos') };
        }
        if (!(await verifyPassword(body.password, u.password_hash))) return fail('password');
        if (!u.activo) return fail('inactivo');
        if (u.totp_enabled) {
          if (!body.totp) return { error: new HttpError(401, 'Se requiere código MFA', { mfaRequerido: true }) };
          const secret = decryptWithMasterKey(app.ctx.config.APP_ENCRYPTION_KEY, u.totp_secret!, `totp:${u.id}`);
          if (!verifyTotp(secret, body.totp)) return fail('totp');
        }
        await db.query('update users set intentos_fallidos = 0, bloqueado_hasta = null where id = $1', [u.id]);
        await audit(db, req, 'login', 'usuario', u.id);
        return { auth: { userId: u.id, tenantId, roles: u.roles, mfa: u.totp_enabled } satisfies AuthInfo };
      });

      if ('error' in outcome) throw outcome.error;
      return {
        token: await issueToken(app, outcome.auth),
        mfaPendiente: !outcome.auth.mfa,
      };
    },
  );

  app.post('/auth/refresh', async (req) => {
    return { token: await issueToken(app, auth(req)) };
  });

  app.get('/auth/me', async (req) => {
    const a = auth(req);
    return withTenant(app.ctx.pool, a.tenantId, async (db) => {
      const u = await one(
        db,
        `select u.id, u.email, u.nombre, u.roles, u.especialidad, u.registro_profesional, u.totp_enabled,
                t.slug as tenant, t.razon_social as prestador,
                exists (select 1 from signing_keys k where k.user_id = u.id and k.revoked_at is null) as tiene_firma
           from users u join tenants t on t.id = u.tenant_id where u.id = $1`,
        [a.userId],
      );
      return { ...u, mfaSesion: a.mfa, mfaRequerido: app.ctx.config.MFA_REQUIRED };
    });
  });

  app.post('/auth/mfa/enroll', async (req) => {
    const a = auth(req);
    return withTenant(app.ctx.pool, a.tenantId, async (db) => {
      const u = await one<{ email: string; totp_enabled: boolean; slug: string }>(
        db,
        'select u.email, u.totp_enabled, t.slug from users u join tenants t on t.id = u.tenant_id where u.id = $1',
        [a.userId],
      );
      if (u?.totp_enabled) throw conflict('MFA ya está activo; solicite al administrador un reinicio');
      const secret = generateTotpSecret();
      await db.query('update users set totp_secret = $2 where id = $1', [
        a.userId,
        encryptWithMasterKey(app.ctx.config.APP_ENCRYPTION_KEY, secret, `totp:${a.userId}`),
      ]);
      await audit(db, req, 'mfa_enrolamiento', 'usuario', a.userId);
      return { secret, otpauth: otpauthUri(secret, `${u!.email}@${u!.slug}`, 'HCE Kompilador') };
    });
  });

  app.post('/auth/mfa/confirm', async (req) => {
    const a = auth(req);
    const { code } = parse(z.object({ code: z.string().regex(/^[0-9]{6}$/) }), req.body);
    await withTenant(app.ctx.pool, a.tenantId, async (db) => {
      const u = await one<{ totp_secret: string | null; totp_enabled: boolean }>(
        db,
        'select totp_secret, totp_enabled from users where id = $1 for update',
        [a.userId],
      );
      if (!u?.totp_secret || u.totp_enabled) throw conflict('No hay enrolamiento MFA pendiente');
      const secret = decryptWithMasterKey(app.ctx.config.APP_ENCRYPTION_KEY, u.totp_secret, `totp:${a.userId}`);
      if (!verifyTotp(secret, code)) throw forbidden('Código MFA inválido');
      await db.query('update users set totp_enabled = true where id = $1', [a.userId]);
      await audit(db, req, 'mfa_activado', 'usuario', a.userId);
    });
    return { token: await issueToken(app, { ...a, mfa: true }) };
  });
}
