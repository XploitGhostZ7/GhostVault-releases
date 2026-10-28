// By Kompilador
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one } from '../../db.js';
import { audit, parse, requireRoles, tx, uuid } from '../../http.js';

export function registerAuditRoutes(app: FastifyInstance) {
  const auditores = { preHandler: requireRoles('auditor', 'admin') };

  app.get('/audit', auditores, async (req) => {
    const q = parse(
      z.object({
        paciente_id: uuid.optional(),
        actor_id: uuid.optional(),
        entidad: z.string().max(40).optional(),
        desde: z.string().datetime({ offset: true }).optional(),
        hasta: z.string().datetime({ offset: true }).optional(),
        antes_de: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
      req.query,
    );
    return tx(req, async (db) => {
      const rows = await many(
        db,
        `select l.seq, l.at, l.actor_id, u.nombre as actor, l.actor_ip, l.accion, l.entidad, l.entidad_id,
                l.paciente_id, l.detalle, l.hash
           from audit_log l left join users u on u.id = l.actor_id
          where ($1::uuid is null or l.paciente_id = $1)
            and ($2::uuid is null or l.actor_id = $2)
            and ($3::text is null or l.entidad = $3)
            and ($4::timestamptz is null or l.at >= $4)
            and ($5::timestamptz is null or l.at < $5)
            and ($6::bigint is null or l.seq < $6)
          order by l.seq desc limit $7`,
        [q.paciente_id ?? null, q.actor_id ?? null, q.entidad ?? null, q.desde ?? null, q.hasta ?? null, q.antes_de ?? null, q.limit],
      );
      await audit(db, req, 'consultar', 'auditoria', null, q.paciente_id ?? null, { filtros: q });
      return rows;
    });
  });

  app.get('/audit/verify', auditores, async (req) => {
    return tx(req, async (db) => {
      const r = await one(db, 'select * from audit_verify()');
      await audit(db, req, 'verificar', 'auditoria', null, null, { valido: r.valido, registros: Number(r.registros) });
      return {
        valido: r.valido,
        registros: Number(r.registros),
        primer_error: r.primer_error === null ? null : Number(r.primer_error),
        hash_cabeza: r.hash_cabeza,
      };
    });
  });
}
