// By Kompilador
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import type { Config } from './config.js';
import { withTenant, type Db } from './db.js';
import { badRequest, forbidden, unauthorized } from './lib/errors.js';
import type { ProveedorFEV, ValidadorRips } from './modules/billing/providers.js';

export type Rol = 'admin' | 'medico' | 'recepcion' | 'facturacion' | 'auditor';

export type AuthInfo = {
  userId: string;
  tenantId: string;
  roles: Rol[];
  mfa: boolean;
};

export type AppContext = {
  config: Config;
  pool: pg.Pool;
  fev: ProveedorFEV;
  ripsValidator: ValidadorRips;
};

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    auth?: AuthInfo;
  }
}

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest(
      'Datos inválidos',
      r.error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })),
    );
  }
  return r.data;
}

export function auth(req: FastifyRequest): AuthInfo {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export function tx<T>(req: FastifyRequest, fn: (db: Db) => Promise<T>): Promise<T> {
  return withTenant(req.server.ctx.pool, auth(req).tenantId, fn);
}

export function requireRoles(...roles: Rol[]) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const a = auth(req);
    if (req.server.ctx.config.MFA_REQUIRED && !a.mfa) {
      throw forbidden('Debe activar el segundo factor (MFA) antes de usar el sistema');
    }
    if (roles.length > 0 && !roles.some((r) => a.roles.includes(r))) throw forbidden();
  };
}

export async function audit(
  db: Db,
  req: FastifyRequest,
  accion: string,
  entidad: string,
  entidadId: string | null,
  pacienteId: string | null = null,
  detalle: Record<string, unknown> = {},
): Promise<void> {
  await db.query('select audit_append($1, $2, $3, $4, $5, $6, $7)', [
    req.auth?.userId ?? null,
    req.ip,
    accion,
    entidad,
    entidadId,
    pacienteId,
    JSON.stringify(detalle),
  ]);
}

export const uuid = z.string().uuid();
export const idParams = z.object({ id: uuid });
