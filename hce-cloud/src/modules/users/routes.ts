// By Kompilador
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one } from '../../db.js';
import { audit, auth, idParams, parse, requireRoles, tx } from '../../http.js';
import { generateSigningKey, hashPassword, verifyPassword } from '../../lib/crypto.js';
import { forbidden, orNotFound, unauthorized } from '../../lib/errors.js';

const rol = z.enum(['admin', 'medico', 'recepcion', 'facturacion', 'auditor']);

export const passwordSchema = z
  .string()
  .min(12, 'Mínimo 12 caracteres')
  .max(128)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v), 'Debe combinar mayúsculas, minúsculas y números');

const createUser = z.object({
  email: z.string().email().transform((v) => v.toLowerCase()),
  nombre: z.string().min(3).max(120),
  tipo_documento: z.string().min(2).max(3),
  numero_documento: z.string().min(3).max(20),
  registro_profesional: z.string().max(40).optional(),
  especialidad: z.string().max(80).optional(),
  roles: z.array(rol).min(1),
  password: passwordSchema,
});

const updateUser = z.object({
  nombre: z.string().min(3).max(120).optional(),
  registro_profesional: z.string().max(40).nullable().optional(),
  especialidad: z.string().max(80).nullable().optional(),
  roles: z.array(rol).min(1).optional(),
  activo: z.boolean().optional(),
});

const USER_COLS = `id, email, nombre, tipo_documento, numero_documento, registro_profesional, especialidad,
  roles, activo, totp_enabled, created_at`;

export function registerUserRoutes(app: FastifyInstance) {
  const admin = { preHandler: requireRoles('admin') };

  app.get('/users', { preHandler: requireRoles() }, async (req) => {
    const { rol: filtro } = parse(z.object({ rol: rol.optional() }), req.query);
    return tx(req, (db) =>
      many(
        db,
        `select ${USER_COLS} from users where ($1::text is null or $1 = any(roles)) order by nombre`,
        [filtro ?? null],
      ),
    );
  });

  app.post('/users', admin, async (req, reply) => {
    const b = parse(createUser, req.body);
    const passwordHash = await hashPassword(b.password);
    const user = await tx(req, async (db) => {
      const u = await one(
        db,
        `insert into users (email, nombre, tipo_documento, numero_documento, registro_profesional, especialidad, roles, password_hash)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning ${USER_COLS}`,
        [b.email, b.nombre, b.tipo_documento, b.numero_documento, b.registro_profesional ?? null, b.especialidad ?? null, b.roles, passwordHash],
      );
      await audit(db, req, 'crear', 'usuario', u.id, null, { roles: b.roles });
      return u;
    });
    return reply.code(201).send(user);
  });

  app.patch('/users/:id', admin, async (req) => {
    const { id } = parse(idParams, req.params);
    const b = parse(updateUser, req.body);
    if (id === auth(req).userId && (b.activo === false || (b.roles && !b.roles.includes('admin')))) {
      throw forbidden('No puede desactivarse ni quitarse el rol de administrador a sí mismo');
    }
    return tx(req, async (db) => {
      const u = orNotFound(
        await one(
          db,
          `update users set
             nombre = coalesce($2, nombre),
             registro_profesional = case when $3 then $4 else registro_profesional end,
             especialidad = case when $5 then $6 else especialidad end,
             roles = coalesce($7, roles),
             activo = coalesce($8, activo)
           where id = $1 returning ${USER_COLS}`,
          [
            id,
            b.nombre ?? null,
            b.registro_profesional !== undefined,
            b.registro_profesional ?? null,
            b.especialidad !== undefined,
            b.especialidad ?? null,
            b.roles ?? null,
            b.activo ?? null,
          ],
        ),
      );
      await audit(db, req, 'actualizar', 'usuario', id, null, b);
      return u;
    });
  });

  app.post('/users/:id/reset-mfa', admin, async (req) => {
    const { id } = parse(idParams, req.params);
    return tx(req, async (db) => {
      orNotFound(
        await one(db, 'update users set totp_secret = null, totp_enabled = false where id = $1 returning id', [id]),
      );
      await audit(db, req, 'mfa_reinicio', 'usuario', id);
      return { ok: true };
    });
  });

  app.post('/users/me/signing-key', { preHandler: requireRoles('medico') }, async (req, reply) => {
    const a = auth(req);
    const b = parse(
      z.object({ password: z.string().min(1), pin: z.string().regex(/^[0-9]{6,12}$/, 'PIN de 6 a 12 dígitos') }),
      req.body,
    );
    const result = await tx(req, async (db) => {
      const u = await one<{ password_hash: string }>(db, 'select password_hash from users where id = $1', [a.userId]);
      if (!u || !(await verifyPassword(b.password, u.password_hash))) throw forbidden('Contraseña incorrecta');
      const key = await generateSigningKey(b.pin, app.ctx.config.APP_ENCRYPTION_KEY, a.userId);
      await db.query('update signing_keys set revoked_at = now() where user_id = $1 and revoked_at is null', [a.userId]);
      const k = await one(
        db,
        `insert into signing_keys (user_id, public_key, fingerprint, encrypted_private_key)
         values ($1,$2,$3,$4) returning id, fingerprint, created_at`,
        [a.userId, key.publicKeyPem, key.fingerprint, key.encryptedPrivateKey],
      );
      await audit(db, req, 'llave_firma_creada', 'usuario', a.userId, null, { fingerprint: key.fingerprint });
      return k;
    });
    return reply.code(201).send(result);
  });

  app.get('/users/:id/signing-keys', { preHandler: requireRoles() }, async (req) => {
    const { id } = parse(idParams, req.params);
    return tx(req, (db) =>
      many(
        db,
        'select id, public_key, fingerprint, created_at, revoked_at from signing_keys where user_id = $1 order by created_at desc',
        [id],
      ),
    );
  });
}
