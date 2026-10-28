// By Kompilador
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one } from '../../db.js';
import { audit, idParams, parse, requireRoles, tx } from '../../http.js';
import { orNotFound } from '../../lib/errors.js';

const opt = (s: z.ZodString) => s.optional().nullable();

export const patientSchema = z.object({
  tipo_documento: z.enum(['CC', 'CE', 'CD', 'PA', 'SC', 'PE', 'RC', 'TI', 'CN', 'AS', 'MS', 'DE', 'PT', 'SI']),
  numero_documento: z.string().regex(/^[A-Za-z0-9]{3,20}$/),
  primer_nombre: z.string().min(1).max(60),
  segundo_nombre: opt(z.string().max(60)),
  primer_apellido: z.string().min(1).max(60),
  segundo_apellido: opt(z.string().max(60)),
  fecha_nacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sexo: z.enum(['H', 'M', 'I']),
  pais_residencia: z.string().regex(/^\d{3}$/).default('170'),
  municipio_residencia: opt(z.string().regex(/^\d{5}$/)),
  zona_residencia: z.enum(['01', '02']).optional().nullable(),
  pais_origen: z.string().regex(/^\d{3}$/).default('170'),
  direccion: opt(z.string().max(200)),
  telefono: opt(z.string().max(30)),
  email: opt(z.string().email()),
  tipo_usuario: z.string().regex(/^\d{2}$/).default('01'),
  eps_codigo: opt(z.string().max(10)),
  eps_nombre: opt(z.string().max(120)),
  consentimiento_datos: z.boolean().default(false),
});

const COLS = Object.keys(patientSchema.shape).filter((k) => k !== 'consentimiento_datos');

export function registerPatientRoutes(app: FastifyInstance) {
  const lectura = { preHandler: requireRoles('admin', 'medico', 'recepcion', 'facturacion', 'auditor') };
  const escritura = { preHandler: requireRoles('admin', 'medico', 'recepcion') };

  app.get('/patients', lectura, async (req) => {
    const { q, limit } = parse(
      z.object({ q: z.string().min(2).max(80), limit: z.coerce.number().int().min(1).max(50).default(20) }),
      req.query,
    );
    return tx(req, async (db) => {
      const rows = await many(
        db,
        `select id, tipo_documento, numero_documento, primer_nombre, segundo_nombre, primer_apellido,
                segundo_apellido, fecha_nacimiento, sexo, eps_nombre
           from patients
          where numero_documento = $1
             or concat_ws(' ', primer_nombre, segundo_nombre, primer_apellido, segundo_apellido) ilike '%' || $2 || '%'
          order by primer_apellido, primer_nombre limit $3`,
        [q, q.replace(/[%_\\]/g, '\\$&'), limit],
      );
      await audit(db, req, 'buscar', 'paciente', null, null, { q, resultados: rows.length });
      return rows;
    });
  });

  app.post('/patients', escritura, async (req, reply) => {
    const b = parse(patientSchema, req.body);
    const p = await tx(req, async (db) => {
      const values = COLS.map((c) => (b as Record<string, unknown>)[c] ?? null);
      const row = await one(
        db,
        `insert into patients (${COLS.join(', ')}, consentimiento_datos_at)
         values (${COLS.map((_, i) => `$${i + 1}`).join(', ')}, case when $${COLS.length + 1} then now() end)
         returning *`,
        [...values, b.consentimiento_datos],
      );
      await audit(db, req, 'crear', 'paciente', row.id, row.id);
      return row;
    });
    return reply.code(201).send(p);
  });

  app.get('/patients/:id', lectura, async (req) => {
    const { id } = parse(idParams, req.params);
    return tx(req, async (db) => {
      const p = orNotFound(await one(db, 'select * from patients where id = $1', [id]), 'Paciente no encontrado');
      await audit(db, req, 'consultar', 'paciente', id, id);
      return p;
    });
  });

  app.patch('/patients/:id', escritura, async (req) => {
    const { id } = parse(idParams, req.params);
    const b = parse(patientSchema.partial(), req.body);
    const sets = COLS.filter((c) => (b as Record<string, unknown>)[c] !== undefined);
    return tx(req, async (db) => {
      const params: unknown[] = [id, ...sets.map((c) => (b as Record<string, unknown>)[c])];
      const consent = b.consentimiento_datos === true ? ', consentimiento_datos_at = coalesce(consentimiento_datos_at, now())' : '';
      const p = orNotFound(
        await one(
          db,
          `update patients set updated_at = now()${sets.map((c, i) => `, ${c} = $${i + 2}`).join('')}${consent}
           where id = $1 returning *`,
          params,
        ),
        'Paciente no encontrado',
      );
      await audit(db, req, 'actualizar', 'paciente', id, id, { campos: sets });
      return p;
    });
  });
}
