// By Kompilador
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, requireRoles, tx } from '../http.js';
import { orNotFound } from '../lib/errors.js';
import { buscarCatalogo, estadoCatalogos, obtenerCodigo } from './service.js';

const tipo = z.enum(['cie10', 'cups', 'cum']);

export function registerCatalogRoutes(app: FastifyInstance) {
  const autenticado = { preHandler: requireRoles() };

  app.get('/catalogos/estado', autenticado, async (req) => tx(req, (db) => estadoCatalogos(db)));

  app.get('/catalogos/:tipo', autenticado, async (req) => {
    const { tipo: t } = parse(z.object({ tipo }), req.params);
    const q = parse(
      z.object({
        q: z.string().trim().min(1).max(100),
        limit: z.coerce.number().int().min(1).max(50).default(20),
        inactivos: z.enum(['true', 'false']).default('false'),
      }),
      req.query,
    );
    return tx(req, (db) => buscarCatalogo(db, t, q.q, q.limit, q.inactivos === 'true'));
  });

  app.get('/catalogos/:tipo/:codigo', autenticado, async (req) => {
    const p = parse(z.object({ tipo, codigo: z.string().max(20) }), req.params);
    return tx(req, async (db) => orNotFound(await obtenerCodigo(db, p.tipo, p.codigo), 'Código no encontrado'));
  });
}
