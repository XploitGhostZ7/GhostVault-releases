// By Kompilador
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, type Db } from '../../db.js';
import { audit, auth, idParams, parse, requireRoles, tx } from '../../http.js';
import { hashCanonical } from '../../lib/canonical.js';
import { conflict, forbidden, orNotFound } from '../../lib/errors.js';
import { renderOrdenPdf } from '../../pdf/render.js';
import { loadEncounter, tenantInfo } from '../clinical/routes.js';
import { orderPayload, signHash, verifyStored } from '../clinical/signing.js';

const medicamento = z
  .object({
    cum: z.string().regex(/^[0-9]{1,12}(-[0-9]{1,3})?$/).optional(),
    nombre: z.string().trim().min(2).max(200),
    concentracion: z.string().trim().min(1).max(60),
    forma_farmaceutica: z.string().trim().min(2).max(60),
    via: z.string().trim().min(2).max(40),
    dosis: z.string().trim().min(1).max(60),
    frecuencia: z.string().trim().min(1).max(60),
    duracion_dias: z.number().int().min(1).max(365),
    cantidad: z.number().int().min(1).max(9999),
    unidad: z.string().max(30).optional(),
    indicaciones: z.string().max(500).optional(),
  })
  .strict();

const servicio = z
  .object({
    cups: z.string().regex(/^[0-9A-Z]{6}$/, 'Código CUPS de 6 caracteres'),
    descripcion: z.string().trim().min(3).max(250),
    cantidad: z.number().int().min(1).max(99).default(1),
    prioridad: z.enum(['rutinaria', 'urgente']).default('rutinaria'),
    justificacion: z.string().max(1000).optional(),
  })
  .strict();

const tipo = z.enum(['formula', 'procedimiento', 'laboratorio', 'imagen', 'interconsulta']);

function itemsSchema(t: z.infer<typeof tipo>) {
  return z.array(t === 'formula' ? medicamento : servicio).min(1).max(30);
}

async function loadOrder(db: Db, id: string) {
  return orNotFound(await one(db, 'select * from clinical_orders where id = $1', [id]), 'Orden no encontrada');
}

export function registerOrderRoutes(app: FastifyInstance) {
  app.post('/encounters/:id/orders', { preHandler: requireRoles('medico') }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const b = parse(
      z.object({ tipo, items: z.array(z.unknown()), observaciones: z.string().max(1000).optional() }),
      req.body,
    );
    const items = parse(itemsSchema(b.tipo), b.items);
    const a = auth(req);
    const orden = await tx(req, async (db) => {
      const e = await loadEncounter(db, id);
      if (e.professional_id !== a.userId) throw forbidden('Solo el profesional tratante emite órdenes de esta atención');
      const row = await one(
        db,
        `insert into clinical_orders (id, encounter_id, patient_id, professional_id, tipo, items, observaciones)
         values ($1,$2,$3,$4,$5,$6,$7) returning *`,
        [randomUUID(), id, e.patient_id, a.userId, b.tipo, JSON.stringify(items), b.observaciones ?? null],
      );
      await audit(db, req, 'crear', 'orden', row.id, e.patient_id, { tipo: b.tipo });
      return row;
    });
    return reply.code(201).send(orden);
  });

  app.get('/encounters/:id/orders', { preHandler: requireRoles('medico', 'auditor') }, async (req) => {
    const { id } = parse(idParams, req.params);
    return tx(req, async (db) => {
      const e = await loadEncounter(db, id);
      const rows = await many(db, 'select * from clinical_orders where encounter_id = $1 order by consecutivo', [id]);
      await audit(db, req, 'consultar', 'orden', null, e.patient_id, { encounter_id: id });
      return rows;
    });
  });

  app.patch('/orders/:id', { preHandler: requireRoles('medico') }, async (req) => {
    const { id } = parse(idParams, req.params);
    const b = parse(z.object({ items: z.array(z.unknown()).optional(), observaciones: z.string().max(1000).nullable().optional() }), req.body);
    return tx(req, async (db) => {
      const o = await loadOrder(db, id);
      if (o.professional_id !== auth(req).userId) throw forbidden();
      if (o.estado !== 'borrador') throw conflict('La orden ya fue firmada');
      const items = b.items === undefined ? null : JSON.stringify(parse(itemsSchema(o.tipo), b.items));
      const row = await one(
        db,
        `update clinical_orders set items = coalesce($2, items),
           observaciones = case when $3 then $4 else observaciones end
         where id = $1 returning *`,
        [id, items, b.observaciones !== undefined, b.observaciones ?? null],
      );
      await audit(db, req, 'editar_borrador', 'orden', id, o.patient_id);
      return row;
    });
  });

  app.post(
    '/orders/:id/sign',
    { preHandler: requireRoles('medico'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { id } = parse(idParams, req.params);
      const { pin } = parse(z.object({ pin: z.string().regex(/^[0-9]{6,12}$/) }), req.body);
      const a = auth(req);
      return tx(req, async (db) => {
        const o = orNotFound(await one(db, 'select * from clinical_orders where id = $1 for update', [id]));
        if (o.professional_id !== a.userId) throw forbidden('Solo el profesional que emite la orden puede firmarla');
        if (o.estado !== 'borrador') throw conflict('La orden ya está firmada');
        const firmadoAt = new Date();
        const hash = hashCanonical(orderPayload({ ...o, firmado_at: firmadoAt }));
        const { firma, signing_key_id } = await signHash(app, db, a.userId, pin, hash);
        const row = await one(
          db,
          `update clinical_orders set estado = 'firmado', firmado_at = $2, content_hash = $3, firma = $4, signing_key_id = $5
           where id = $1 returning *`,
          [id, firmadoAt.toISOString(), hash, firma, signing_key_id],
        );
        await audit(db, req, 'firmar', 'orden', id, o.patient_id, { hash });
        return row;
      });
    },
  );

  app.get('/orders/:id', { preHandler: requireRoles('medico', 'auditor') }, async (req) => {
    const { id } = parse(idParams, req.params);
    return tx(req, async (db) => {
      const o = await loadOrder(db, id);
      const verificacion = o.estado === 'firmado' ? await verifyStored(db, orderPayload(o), o) : null;
      await audit(db, req, 'consultar', 'orden', id, o.patient_id);
      return { ...o, verificacion };
    });
  });

  app.get('/orders/:id/pdf', { preHandler: requireRoles('medico', 'auditor') }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const data = await tx(req, async (db) => {
      const order = await loadOrder(db, id);
      const [tenant, patient, professional, encounter, key] = await Promise.all([
        tenantInfo(db),
        one(db, 'select * from patients where id = $1', [order.patient_id]),
        one(db, 'select * from users where id = $1', [order.professional_id]),
        one(db, 'select diagnostico_principal from encounters where id = $1', [order.encounter_id]),
        order.signing_key_id
          ? one(db, 'select fingerprint from signing_keys where id = $1', [order.signing_key_id])
          : Promise.resolve(undefined),
      ]);
      await audit(db, req, 'imprimir', 'orden', id, order.patient_id);
      return {
        tenant,
        patient,
        order,
        professional,
        diagnostico: encounter?.diagnostico_principal ?? null,
        fingerprint: key?.fingerprint ?? null,
      };
    });
    const pdf = await renderOrdenPdf(data);
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="orden-${data.order.consecutivo}.pdf"`)
      .header('cache-control', 'no-store')
      .send(pdf);
  });
}
