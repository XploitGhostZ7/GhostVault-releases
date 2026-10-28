// By Kompilador
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, type Db } from '../../db.js';
import { audit, auth, idParams, parse, requireRoles, tx, uuid } from '../../http.js';
import { badRequest, conflict, orNotFound } from '../../lib/errors.js';

export const TZ = 'America/Bogota';

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const scheduleSchema = z
  .object({
    professional_id: uuid,
    dia_semana: z.number().int().min(1).max(7),
    hora_inicio: hora,
    hora_fin: hora,
    duracion_min: z.number().int().min(5).max(240),
  })
  .refine((s) => s.hora_fin > s.hora_inicio, 'hora_fin debe ser posterior a hora_inicio');

const appointmentSchema = z.object({
  patient_id: uuid,
  professional_id: uuid,
  inicio: z.string().datetime({ offset: true }),
  duracion_min: z.number().int().min(5).max(240).default(20),
  motivo: z.string().max(300).optional(),
});

export async function assertProfesional(db: Db, id: string): Promise<void> {
  const p = await one(db, "select 1 from users where id = $1 and activo and 'medico' = any(roles)", [id]);
  if (!p) throw badRequest('El profesional no existe o no está activo');
}

export function registerAgendaRoutes(app: FastifyInstance) {
  const gestion = { preHandler: requireRoles('admin', 'recepcion') };
  const lectura = { preHandler: requireRoles('admin', 'recepcion', 'medico') };

  app.post('/schedules', { preHandler: requireRoles('admin') }, async (req, reply) => {
    const b = parse(scheduleSchema, req.body);
    const s = await tx(req, async (db) => {
      await assertProfesional(db, b.professional_id);
      const row = await one(
        db,
        `insert into schedules (professional_id, dia_semana, hora_inicio, hora_fin, duracion_min)
         values ($1,$2,$3,$4,$5) returning *`,
        [b.professional_id, b.dia_semana, b.hora_inicio, b.hora_fin, b.duracion_min],
      );
      await audit(db, req, 'crear', 'horario', row.id, null, b);
      return row;
    });
    return reply.code(201).send(s);
  });

  app.get('/schedules', lectura, async (req) => {
    const { professional_id } = parse(z.object({ professional_id: uuid.optional() }), req.query);
    return tx(req, (db) =>
      many(
        db,
        `select * from schedules where ($1::uuid is null or professional_id = $1)
         order by professional_id, dia_semana, hora_inicio`,
        [professional_id ?? null],
      ),
    );
  });

  app.delete('/schedules/:id', { preHandler: requireRoles('admin') }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    await tx(req, async (db) => {
      orNotFound(await one(db, 'delete from schedules where id = $1 returning id', [id]));
      await audit(db, req, 'eliminar', 'horario', id);
    });
    return reply.code(204).send();
  });

  app.get('/agenda/slots', lectura, async (req) => {
    const q = parse(z.object({ professional_id: uuid, fecha }), req.query);
    return tx(req, (db) =>
      many(
        db,
        `select s.inicio, s.inicio + make_interval(mins => sc.duracion_min) as fin
           from schedules sc
           cross join lateral generate_series(
             ($2::date + sc.hora_inicio) at time zone '${TZ}',
             ($2::date + sc.hora_fin - make_interval(mins => sc.duracion_min)) at time zone '${TZ}',
             make_interval(mins => sc.duracion_min)) as s(inicio)
          where sc.professional_id = $1
            and sc.dia_semana = extract(isodow from $2::date)
            and s.inicio > now()
            and not exists (
              select 1 from appointments a
               where a.professional_id = $1
                 and a.estado not in ('cancelada','inasistencia')
                 and a.periodo && tstzrange(s.inicio, s.inicio + make_interval(mins => sc.duracion_min)))
          order by s.inicio`,
        [q.professional_id, q.fecha],
      ),
    );
  });

  app.post('/appointments', gestion, async (req, reply) => {
    const b = parse(appointmentSchema, req.body);
    const inicio = new Date(b.inicio);
    if (inicio.getTime() < Date.now() - 5 * 60_000) throw badRequest('No se pueden agendar citas en el pasado');
    const cita = await tx(req, async (db) => {
      await assertProfesional(db, b.professional_id);
      const row = await one(
        db,
        `insert into appointments (patient_id, professional_id, periodo, motivo, created_by)
         values ($1, $2, tstzrange($3::timestamptz, $3::timestamptz + make_interval(mins => $4)), $5, $6)
         returning *`,
        [b.patient_id, b.professional_id, inicio.toISOString(), b.duracion_min, b.motivo ?? null, auth(req).userId],
      );
      await audit(db, req, 'crear', 'cita', row.id, b.patient_id, { inicio: b.inicio });
      return row;
    });
    return reply.code(201).send(cita);
  });

  app.get('/appointments', lectura, async (req) => {
    const q = parse(z.object({ fecha, professional_id: uuid.optional() }), req.query);
    return tx(req, (db) =>
      many(
        db,
        `select a.id, a.estado, a.motivo, lower(a.periodo) as inicio, upper(a.periodo) as fin,
                a.professional_id, u.nombre as profesional,
                a.patient_id, p.tipo_documento, p.numero_documento,
                concat_ws(' ', p.primer_nombre, p.primer_apellido) as paciente
           from appointments a
           join patients p on p.id = a.patient_id
           join users u on u.id = a.professional_id
          where a.periodo && tstzrange(($1::date)::timestamp at time zone '${TZ}', ($1::date + 1)::timestamp at time zone '${TZ}')
            and ($2::uuid is null or a.professional_id = $2)
          order by lower(a.periodo)`,
        [q.fecha, q.professional_id ?? null],
      ),
    );
  });

  const transicion = (accion: string, destino: string, origen: string[]) =>
    app.post(`/appointments/:id/${accion}`, gestion, async (req) => {
      const { id } = parse(idParams, req.params);
      const { motivo } = parse(z.object({ motivo: z.string().max(300).optional() }).default({}), req.body ?? {});
      return tx(req, async (db) => {
        const actual = orNotFound(
          await one(db, 'select estado, patient_id from appointments where id = $1 for update', [id]),
          'Cita no encontrada',
        );
        if (!origen.includes(actual.estado)) throw conflict(`No se puede pasar de ${actual.estado} a ${destino}`);
        const row = await one(
          db,
          `update appointments set estado = $2, motivo_cancelacion = coalesce($3, motivo_cancelacion)
           where id = $1 returning *`,
          [id, destino, motivo ?? null],
        );
        await audit(db, req, accion, 'cita', id, actual.patient_id, motivo ? { motivo } : {});
        return row;
      });
    });

  transicion('confirm', 'confirmada', ['programada']);
  transicion('cancel', 'cancelada', ['programada', 'confirmada']);
  transicion('no-show', 'inasistencia', ['programada', 'confirmada']);
}
