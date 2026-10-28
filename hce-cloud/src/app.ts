// By Kompilador
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppContext } from './http.js';
import { HttpError } from './lib/errors.js';
import { registerAdmissionRoutes } from './modules/admissions/routes.js';
import { registerAgendaRoutes } from './modules/agenda/routes.js';
import { registerAuditRoutes } from './modules/audit/routes.js';
import { authenticate, registerAuthRoutes } from './modules/auth/routes.js';
import { registerBillingRoutes } from './modules/billing/routes.js';
import { registerClinicalRoutes } from './modules/clinical/routes.js';
import { registerFhirRoutes } from './modules/fhir/routes.js';
import { registerOrderRoutes } from './modules/orders/routes.js';
import { registerPatientRoutes } from './modules/patients/routes.js';
import { registerUserRoutes } from './modules/users/routes.js';

const PUBLICAS = new Set(['/health', '/auth/login', '/fhir/metadata']);

const PG_ERRORES: Record<string, [number, string]> = {
  '23505': [409, 'Registro duplicado'],
  '23P01': [409, 'El horario se cruza con otra cita del profesional'],
  '23503': [400, 'Referencia inexistente'],
  '23514': [400, 'Datos fuera de las reglas de negocio'],
  '22P02': [400, 'Formato de dato inválido'],
  P0001: [409, 'Operación no permitida'],
};

export async function buildApp(ctx: AppContext, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger
      ? { redact: ['req.headers.authorization', 'req.body.password', 'req.body.pin', 'req.body.totp'] }
      : false,
    trustProxy: (_addr: string, hop: number) => hop < ctx.config.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
  });
  app.decorate('ctx', ctx);

  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } });
  await app.register(cors, {
    origin: ctx.config.CORS_ORIGINS ? ctx.config.CORS_ORIGINS.split(',').map((o) => o.trim()) : false,
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  app.addHook('onRequest', async (req) => {
    await authenticate(req);
    const path = req.routeOptions.url ?? req.url;
    if (!req.auth && !PUBLICAS.has(path)) throw new HttpError(401, 'No autenticado');
  });

  app.addHook('onSend', async (_req, reply) => {
    if (!reply.getHeader('cache-control')) reply.header('cache-control', 'no-store');
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.message, ...(err.detalle !== undefined ? { detalle: err.detalle } : {}) });
    }
    const pg = typeof err.code === 'string' ? PG_ERRORES[err.code] : undefined;
    if (pg) {
      const mensaje = err.code === 'P0001' ? err.message : pg[1];
      return reply.code(pg[0]).send({ error: mensaje, ...(err.constraint ? { detalle: err.constraint } : {}) });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: err.message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'Error interno' });
  });

  app.get('/health', async () => {
    await ctx.pool.query('select 1');
    return { ok: true };
  });

  registerAuthRoutes(app);
  registerUserRoutes(app);
  registerPatientRoutes(app);
  registerAgendaRoutes(app);
  registerAdmissionRoutes(app);
  registerClinicalRoutes(app);
  registerOrderRoutes(app);
  registerBillingRoutes(app);
  registerAuditRoutes(app);
  registerFhirRoutes(app);

  return app;
}
