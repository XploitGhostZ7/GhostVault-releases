// By Kompilador
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one } from '../../db.js';
import { audit, auth, idParams, parse, requireRoles, tx, uuid } from '../../http.js';
import { badRequest, conflict, orNotFound } from '../../lib/errors.js';
import { TZ, assertProfesional } from '../agenda/routes.js';

const codigo2 = z.string().regex(/^\d{2}$/);

const admissionSchema = z
  .object({
    appointment_id: uuid.optional(),
    patient_id: uuid.optional(),
    professional_id: uuid.optional(),
    tipo_usuario: codigo2.optional(),
    modalidad: codigo2.default('01'),
    grupo_servicios: codigo2.default('01'),
    cod_servicio: z.string().regex(/^\d{3,4}$/),
    cod_consulta: z.string().regex(/^[0-9A-Z]{6}$/, 'Código CUPS de 6 caracteres'),
    num_autorizacion: z.string().max(30).optional(),
    valor_servicio: z.number().min(0).max(1e10),
    concepto_recaudo: codigo2.default('05'),
    valor_pago_moderador: z.number().min(0).max(1e10).default(0),
  })
  .refine((b) => b.appointment_id || (b.patient_id && b.professional_id), {
    message: 'Indique appointment_id o patient_id y professional_id',
  });

export function registerAdmissionRoutes(app: FastifyInstance) {
  app.post('/admissions', { preHandler: requireRoles('admin', 'recepcion') }, async (req, reply) => {
    const b = parse(admissionSchema, req.body);
    const adm = await tx(req, async (db) => {
      let patientId = b.patient_id;
      let professionalId = b.professional_id;
      if (b.appointment_id) {
        const cita = orNotFound(
          await one(db, 'select * from appointments where id = $1 for update', [b.appointment_id]),
          'Cita no encontrada',
        );
        if (!['programada', 'confirmada'].includes(cita.estado)) {
          throw conflict(`La cita está ${cita.estado}`);
        }
        if ((patientId && patientId !== cita.patient_id) || (professionalId && professionalId !== cita.professional_id)) {
          throw badRequest('Paciente o profesional no coinciden con la cita');
        }
        patientId = cita.patient_id;
        professionalId = cita.professional_id;
        await db.query("update appointments set estado = 'admitida' where id = $1", [b.appointment_id]);
      }
      await assertProfesional(db, professionalId!);
      const pac = orNotFound(
        await one(db, 'select tipo_usuario, consentimiento_datos_at from patients where id = $1', [patientId]),
        'Paciente no encontrado',
      );
      if (!pac.consentimiento_datos_at) {
        throw conflict('El paciente no ha otorgado autorización de tratamiento de datos (Ley 1581 de 2012)');
      }
      const row = await one(
        db,
        `insert into admissions (patient_id, professional_id, appointment_id, tipo_usuario, modalidad, grupo_servicios,
            cod_servicio, cod_consulta, num_autorizacion, valor_servicio, concepto_recaudo, valor_pago_moderador, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
        [
          patientId,
          professionalId,
          b.appointment_id ?? null,
          b.tipo_usuario ?? pac.tipo_usuario,
          b.modalidad,
          b.grupo_servicios,
          b.cod_servicio,
          b.cod_consulta,
          b.num_autorizacion ?? null,
          b.valor_servicio,
          b.concepto_recaudo,
          b.valor_pago_moderador,
          auth(req).userId,
        ],
      );
      await audit(db, req, 'admitir', 'admision', row.id, patientId!);
      return row;
    });
    return reply.code(201).send(adm);
  });

  app.get('/admissions', { preHandler: requireRoles('admin', 'recepcion', 'medico', 'facturacion') }, async (req) => {
    const q = parse(
      z.object({
        fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        professional_id: uuid.optional(),
        estado: z.enum(['abierta', 'cerrada', 'anulada']).optional(),
      }),
      req.query,
    );
    return tx(req, (db) =>
      many(
        db,
        `select a.*, concat_ws(' ', p.primer_nombre, p.primer_apellido) as paciente,
                p.tipo_documento, p.numero_documento, u.nombre as profesional,
                e.id as encounter_id, e.estado as encounter_estado, e.plantilla,
                exists (select 1 from invoice_items ii where ii.admission_id = a.id) as facturada
           from admissions a
           join patients p on p.id = a.patient_id
           join users u on u.id = a.professional_id
           left join encounters e on e.admission_id = a.id
          where a.fecha_ingreso >= ($1::date)::timestamp at time zone '${TZ}'
            and a.fecha_ingreso < ($1::date + 1)::timestamp at time zone '${TZ}'
            and ($2::uuid is null or a.professional_id = $2)
            and ($3::text is null or a.estado = $3)
          order by a.fecha_ingreso`,
        [q.fecha, q.professional_id ?? null, q.estado ?? null],
      ),
    );
  });

  app.get('/admissions/:id', { preHandler: requireRoles('admin', 'recepcion', 'medico', 'facturacion') }, async (req) => {
    const { id } = parse(idParams, req.params);
    return tx(req, async (db) => orNotFound(await one(db, 'select * from admissions where id = $1', [id])));
  });

  app.post('/admissions/:id/anular', { preHandler: requireRoles('admin', 'recepcion') }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { motivo } = parse(z.object({ motivo: z.string().min(5).max(300) }), req.body);
    return tx(req, async (db) => {
      const a = orNotFound(await one(db, 'select * from admissions where id = $1 for update', [id]));
      const e = await one(db, 'select 1 from encounters where admission_id = $1', [id]);
      if (a.estado !== 'abierta' || e) throw conflict('Solo se anulan admisiones abiertas sin atención registrada');
      const row = await one(db, "update admissions set estado = 'anulada' where id = $1 returning *", [id]);
      if (a.appointment_id) {
        await db.query("update appointments set estado = 'cancelada', motivo_cancelacion = $2 where id = $1", [a.appointment_id, motivo]);
      }
      await audit(db, req, 'anular', 'admision', id, a.patient_id, { motivo });
      return row;
    });
  });
}
