// By Kompilador
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, type Db } from '../../db.js';
import { audit, auth, idParams, parse, requireRoles, tx, uuid } from '../../http.js';
import { badRequest, conflict, orNotFound } from '../../lib/errors.js';
import { tenantInfo } from '../clinical/routes.js';
import type { FacturaSalud } from './providers.js';
import { buildRips, prevalidarRips, type AtencionFacturable } from './rips.js';

const pagadorSchema = z.object({
  tipo: z.enum(['eps', 'particular', 'otro']),
  tipo_documento: z.string().min(2).max(3),
  numero_documento: z.string().regex(/^[0-9A-Za-z-]{3,20}$/),
  nombre: z.string().min(2).max(200),
});

const facturacion = { preHandler: requireRoles('admin', 'facturacion') };

async function cargarAtenciones(db: Db, admissionIds: string[]): Promise<AtencionFacturable[]> {
  const rows = await many(
    db,
    `select to_jsonb(p) as patient, to_jsonb(a) as admission, to_jsonb(e) as encounter,
            jsonb_build_object('tipo_documento', u.tipo_documento, 'numero_documento', u.numero_documento) as professional
       from admissions a
       join patients p on p.id = a.patient_id
       join users u on u.id = a.professional_id
       left join encounters e on e.admission_id = a.id
      where a.id = any($1::uuid[])`,
    [admissionIds],
  );
  const encontrados = new Set(rows.map((r) => r.admission.id));
  const faltan = admissionIds.filter((id) => !encontrados.has(id));
  if (faltan.length) throw badRequest('Admisiones no encontradas', faltan);
  const noListas = rows.filter((r) => r.admission.estado !== 'cerrada' || r.encounter?.estado !== 'firmado');
  if (noListas.length) {
    throw conflict(
      'Solo se facturan atenciones con historia clínica firmada',
      noListas.map((r) => r.admission.id),
    );
  }
  return rows;
}

async function invoiceAtenciones(db: Db, invoiceId: string) {
  const ids = await many<{ admission_id: string }>(db, 'select admission_id from invoice_items where invoice_id = $1', [invoiceId]);
  return cargarAtenciones(
    db,
    ids.map((r) => r.admission_id),
  );
}

export function registerBillingRoutes(app: FastifyInstance) {
  app.post('/billing/rips/preview', facturacion, async (req) => {
    const { admission_ids } = parse(z.object({ admission_ids: z.array(uuid).min(1).max(500) }), req.body);
    return tx(req, async (db) => {
      const tenant = await tenantInfo(db);
      const rips = buildRips({
        nitObligado: tenant.nit,
        codPrestador: tenant.codigo_prestador,
        numFactura: 'PREVIEW',
        atenciones: await cargarAtenciones(db, admission_ids),
      });
      return { rips, hallazgos: prevalidarRips(rips) };
    });
  });

  app.post('/billing/invoices', facturacion, async (req, reply) => {
    const b = parse(
      z.object({
        admission_ids: z.array(uuid).min(1).max(500),
        pagador: pagadorSchema,
        modalidad_pago: z.string().regex(/^\d{2}$/).optional(),
        numero_contrato: z.string().max(40).optional(),
      }),
      req.body,
    );
    const ids = [...new Set(b.admission_ids)];
    const inv = await tx(req, async (db) => {
      const atenciones = await cargarAtenciones(db, ids);
      const facturadas = await many(db, 'select admission_id from invoice_items where admission_id = any($1::uuid[])', [ids]);
      if (facturadas.length) throw conflict('Hay admisiones ya facturadas', facturadas.map((f) => f.admission_id));
      const total = atenciones.reduce((s, a) => s + Number(a.admission.valor_servicio) - Number(a.admission.valor_pago_moderador), 0);
      const row = await one(
        db,
        `insert into invoices (pagador, modalidad_pago, numero_contrato, total, created_by)
         values ($1,$2,$3,$4,$5) returning *`,
        [JSON.stringify(b.pagador), b.modalidad_pago ?? null, b.numero_contrato ?? null, total, auth(req).userId],
      );
      for (const a of atenciones) {
        await db.query('insert into invoice_items (invoice_id, admission_id, valor) values ($1,$2,$3)', [
          row.id,
          a.admission.id,
          a.admission.valor_servicio,
        ]);
      }
      await audit(db, req, 'crear', 'factura', row.id, null, { admisiones: ids.length, total });
      return row;
    });
    return reply.code(201).send(inv);
  });

  app.get('/billing/invoices', facturacion, async (req) => {
    const { estado } = parse(z.object({ estado: z.enum(['borrador', 'emitida', 'validada', 'rechazada']).optional() }), req.query);
    return tx(req, (db) =>
      many(
        db,
        `select id, estado, pagador, total, prefijo, numero, cufe, cuv, fecha_emision, created_at
           from invoices where ($1::text is null or estado = $1) order by created_at desc limit 200`,
        [estado ?? null],
      ),
    );
  });

  app.get('/billing/invoices/:id', facturacion, async (req) => {
    const { id } = parse(idParams, req.params);
    return tx(req, async (db) => {
      const inv = orNotFound(await one(db, 'select * from invoices where id = $1', [id]), 'Factura no encontrada');
      const items = await many(db, 'select admission_id, valor from invoice_items where invoice_id = $1', [id]);
      return { ...inv, items };
    });
  });

  app.post('/billing/invoices/:id/emitir', facturacion, async (req) => {
    const { id } = parse(idParams, req.params);
    return tx(req, async (db) => {
      const inv = orNotFound(await one(db, 'select * from invoices where id = $1 for update', [id]), 'Factura no encontrada');
      if (inv.estado !== 'borrador') throw conflict(`La factura ya está ${inv.estado}`);
      const tenant = await tenantInfo(db);
      const atenciones = await invoiceAtenciones(db, id);

      const preliminar = buildRips({
        nitObligado: tenant.nit,
        codPrestador: tenant.codigo_prestador,
        numFactura: 'PRE',
        atenciones,
      });
      const hallazgos = prevalidarRips(preliminar).filter((h) => h.ruta !== 'numFactura');
      if (hallazgos.length) throw badRequest('Los RIPS no superan la prevalidación; corrija antes de emitir', hallazgos);

      const siguiente = await one<{ n: number }>(
        db,
        "select coalesce(max(numero::bigint), 0)::int + 1 as n from invoices where numero ~ '^[0-9]+$'",
      );
      const factura: FacturaSalud = {
        emisor: { nit: tenant.nit, dv: tenant.dv, razonSocial: tenant.razon_social, codigoPrestador: tenant.codigo_prestador },
        adquirente: {
          tipo: inv.pagador.tipo,
          tipoDocumento: inv.pagador.tipo_documento,
          numeroDocumento: inv.pagador.numero_documento,
          nombre: inv.pagador.nombre,
        },
        items: atenciones.map((a) => ({
          codigo: a.admission.cod_consulta,
          descripcion: `Consulta ${a.encounter.plantilla.replace('_', ' ')}`,
          cantidad: 1,
          valorUnitario: Number(a.admission.valor_servicio),
          valorPagoModerador: Number(a.admission.valor_pago_moderador),
        })),
        sectorSalud: {
          modalidadPago: inv.modalidad_pago,
          numeroContrato: inv.numero_contrato,
          usuarios: atenciones.map((a) => ({
            tipoDocumento: a.patient.tipo_documento,
            numeroDocumento: a.patient.numero_documento,
            tipoUsuario: a.admission.tipo_usuario,
            numAutorizacion: a.admission.num_autorizacion,
          })),
        },
        totalServicios: atenciones.reduce((s, a) => s + Number(a.admission.valor_servicio), 0),
        totalPagoModerador: atenciones.reduce((s, a) => s + Number(a.admission.valor_pago_moderador), 0),
        totalAPagar: Number(inv.total),
        consecutivoSugerido: siguiente?.n ?? 1,
      };

      const emitida = await app.ctx.fev.emitir(factura);
      const rips = buildRips({
        nitObligado: tenant.nit,
        codPrestador: tenant.codigo_prestador,
        numFactura: `${emitida.prefijo}${emitida.numero}`,
        atenciones,
      });
      const validacion = await app.ctx.ripsValidator.validar({ xmlFevBase64: emitida.xmlBase64, rips });

      const row = await one(
        db,
        `update invoices set estado = $2, prefijo = $3, numero = $4, cufe = $5, fecha_emision = $6, proveedor = $7,
           proveedor_ref = $8, rips = $9, cuv = $10, respuesta_validacion = $11
         where id = $1 returning *`,
        [
          id,
          validacion.aprobado ? 'validada' : 'rechazada',
          emitida.prefijo,
          emitida.numero,
          emitida.cufe,
          emitida.fechaEmision.toISOString(),
          app.ctx.fev.nombre,
          emitida.referencia,
          JSON.stringify(rips),
          validacion.cuv,
          JSON.stringify({ validador: app.ctx.ripsValidator.nombre, ...validacion }),
        ],
      );
      await audit(db, req, 'emitir', 'factura', id, null, {
        numero: `${emitida.prefijo}${emitida.numero}`,
        cufe: emitida.cufe,
        cuv: validacion.cuv,
      });
      return row;
    });
  });

  app.get('/billing/invoices/:id/rips', facturacion, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const inv = await tx(req, async (db) => {
      const r = orNotFound(await one(db, 'select prefijo, numero, rips from invoices where id = $1', [id]));
      if (!r.rips) throw conflict('La factura aún no tiene RIPS generados');
      await audit(db, req, 'descargar_rips', 'factura', id);
      return r;
    });
    return reply
      .header('content-disposition', `attachment; filename="RIPS-${inv.prefijo}${inv.numero}.json"`)
      .send(inv.rips);
  });
}
