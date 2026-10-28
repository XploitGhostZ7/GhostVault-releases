// By Kompilador
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, type Db } from '../../db.js';
import { audit, auth, idParams, parse, requireRoles, tx, uuid } from '../../http.js';
import { hashCanonical } from '../../lib/canonical.js';
import { badRequest, conflict, forbidden, notFound, orNotFound } from '../../lib/errors.js';
import { renderHistoriaPdf } from '../../pdf/render.js';
import { validarCie10 } from '../../catalogs/service.js';
import { addendumPayload, encounterPayload, signHash, verifyStored } from './signing.js';
import { TEMPLATES, contentSchema, getTemplate } from './templates.js';

const cie10 = z
  .string()
  .transform((v) => v.toUpperCase().replace('.', ''))
  .pipe(z.string().regex(/^[A-Z][0-9]{2}[0-9X]?$/, 'Código CIE-10 inválido'));

const draftSchema = z.object({
  contenido: z.record(z.unknown()).optional(),
  diagnostico_principal: cie10.nullable().optional(),
  diagnosticos_relacionados: z.array(cie10).max(3).optional(),
  tipo_diagnostico_principal: z.enum(['01', '02', '03']).nullable().optional(),
  finalidad: z.string().regex(/^\d{2}$/).nullable().optional(),
  causa_externa: z.string().regex(/^\d{2}$/).nullable().optional(),
});

const pinSchema = z.object({ pin: z.string().regex(/^[0-9]{6,12}$/) });

const lecturaClinica = requireRoles('medico', 'auditor');

export async function loadEncounter(db: Db, id: string) {
  return orNotFound(await one(db, 'select * from encounters where id = $1', [id]), 'Historia clínica no encontrada');
}

export async function tenantInfo(db: Db) {
  return one(db, 'select * from tenants where id = app_tenant()');
}

export function registerClinicalRoutes(app: FastifyInstance) {
  app.get('/templates', { preHandler: requireRoles() }, async () =>
    TEMPLATES.map(({ code, version, nombre, especialidad, codServicioSugerido, cupsSugerido }) => ({
      code,
      version,
      nombre,
      especialidad,
      codServicioSugerido,
      cupsSugerido,
    })),
  );

  app.get('/templates/:code', { preHandler: requireRoles() }, async (req) => {
    const { code } = parse(z.object({ code: z.string() }), req.params);
    return orNotFound(getTemplate(code), 'Plantilla no encontrada');
  });

  app.post('/encounters', { preHandler: requireRoles('medico') }, async (req, reply) => {
    const b = parse(z.object({ admission_id: uuid, plantilla: z.string() }), req.body);
    const t = getTemplate(b.plantilla);
    if (!t) throw badRequest('Plantilla no encontrada');
    const a = auth(req);
    const e = await tx(req, async (db) => {
      const adm = orNotFound(
        await one(db, 'select * from admissions where id = $1 for update', [b.admission_id]),
        'Admisión no encontrada',
      );
      if (adm.professional_id !== a.userId) throw forbidden('La admisión está asignada a otro profesional');
      if (adm.estado !== 'abierta') throw conflict(`La admisión está ${adm.estado}`);
      const row = await one(
        db,
        `insert into encounters (patient_id, admission_id, professional_id, plantilla, plantilla_version)
         values ($1,$2,$3,$4,$5) returning *`,
        [adm.patient_id, adm.id, a.userId, t.code, t.version],
      );
      await audit(db, req, 'crear', 'historia_clinica', row.id, adm.patient_id, { plantilla: t.code });
      return row;
    });
    return reply.code(201).send(e);
  });

  app.patch('/encounters/:id', { preHandler: requireRoles('medico') }, async (req) => {
    const { id } = parse(idParams, req.params);
    const b = parse(draftSchema, req.body);
    return tx(req, async (db) => {
      const e = await loadEncounter(db, id);
      if (e.professional_id !== auth(req).userId) throw forbidden('Solo el profesional tratante edita el borrador');
      if (e.estado !== 'borrador') throw conflict('La historia clínica ya fue firmada; use una nota aclaratoria');
      const t = getTemplate(e.plantilla, e.plantilla_version)!;
      const contenido = b.contenido === undefined ? undefined : parse(contentSchema(t, false), b.contenido);
      const errDx = await validarCie10(db, [b.diagnostico_principal ?? '', ...(b.diagnosticos_relacionados ?? [])]);
      if (errDx.length) throw badRequest('Diagnóstico no válido', errDx);
      const set = (v: unknown) => (v === undefined ? null : v);
      const row = await one(
        db,
        `update encounters set
           contenido = coalesce($2, contenido),
           diagnostico_principal = case when $3 then $4 else diagnostico_principal end,
           diagnosticos_relacionados = coalesce($5, diagnosticos_relacionados),
           tipo_diagnostico_principal = case when $6 then $7 else tipo_diagnostico_principal end,
           finalidad = case when $8 then $9 else finalidad end,
           causa_externa = case when $10 then $11 else causa_externa end
         where id = $1 returning *`,
        [
          id,
          contenido === undefined ? null : JSON.stringify(contenido),
          b.diagnostico_principal !== undefined,
          set(b.diagnostico_principal),
          set(b.diagnosticos_relacionados),
          b.tipo_diagnostico_principal !== undefined,
          set(b.tipo_diagnostico_principal),
          b.finalidad !== undefined,
          set(b.finalidad),
          b.causa_externa !== undefined,
          set(b.causa_externa),
        ],
      );
      await audit(db, req, 'editar_borrador', 'historia_clinica', id, e.patient_id);
      return row;
    });
  });

  app.post(
    '/encounters/:id/sign',
    { preHandler: requireRoles('medico'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { id } = parse(idParams, req.params);
      const { pin } = parse(pinSchema, req.body);
      const a = auth(req);
      return tx(req, async (db) => {
        const e = orNotFound(await one(db, 'select * from encounters where id = $1 for update', [id]));
        if (e.professional_id !== a.userId) throw forbidden('Solo el profesional tratante puede firmar');
        if (e.estado !== 'borrador') throw conflict('La historia clínica ya está firmada');
        const t = getTemplate(e.plantilla, e.plantilla_version)!;
        parse(contentSchema(t, true), e.contenido);
        const faltantes = ['diagnostico_principal', 'tipo_diagnostico_principal', 'finalidad', 'causa_externa'].filter(
          (k) => !e[k],
        );
        if (faltantes.length) throw badRequest('Faltan datos obligatorios para firmar', faltantes);
        const pac = await one(db, 'select sexo, fecha_nacimiento from patients where id = $1', [e.patient_id]);
        const errDx = await validarCie10(db, [e.diagnostico_principal, ...e.diagnosticos_relacionados], pac);
        if (errDx.length) throw badRequest('Diagnósticos incompatibles con el catálogo CIE-10', errDx);

        const firmadoAt = new Date();
        const hash = hashCanonical(encounterPayload({ ...e, firmado_at: firmadoAt }));
        const { firma, signing_key_id } = await signHash(app, db, a.userId, pin, hash);
        const row = await one(
          db,
          `update encounters set estado = 'firmado', firmado_at = $2, content_hash = $3, firma = $4, signing_key_id = $5
           where id = $1 returning *`,
          [id, firmadoAt.toISOString(), hash, firma, signing_key_id],
        );
        const adm = await one(db, "update admissions set estado = 'cerrada' where id = $1 returning appointment_id", [
          e.admission_id,
        ]);
        if (adm?.appointment_id) {
          await db.query("update appointments set estado = 'atendida' where id = $1", [adm.appointment_id]);
        }
        await audit(db, req, 'firmar', 'historia_clinica', id, e.patient_id, { hash });
        return row;
      });
    },
  );

  app.get('/encounters/:id', { preHandler: lecturaClinica }, async (req) => {
    const { id } = parse(idParams, req.params);
    return tx(req, async (db) => {
      const e = await loadEncounter(db, id);
      const addenda = await many(
        db,
        `select a.*, u.nombre as autor_nombre from encounter_addenda a join users u on u.id = a.autor_id
          where a.encounter_id = $1 order by a.created_at`,
        [id],
      );
      const orders = await many(
        db,
        'select id, consecutivo, tipo, estado, created_at, firmado_at from clinical_orders where encounter_id = $1 order by consecutivo',
        [id],
      );
      await audit(db, req, 'consultar', 'historia_clinica', id, e.patient_id);
      return { ...e, addenda, orders };
    });
  });

  app.get('/patients/:id/encounters', { preHandler: lecturaClinica }, async (req) => {
    const { id } = parse(idParams, req.params);
    return tx(req, async (db) => {
      const rows = await many(
        db,
        `select e.id, e.plantilla, e.estado, e.iniciado_at, e.firmado_at, e.diagnostico_principal,
                u.nombre as profesional, u.especialidad,
                (select count(*)::int from encounter_addenda a where a.encounter_id = e.id) as notas_aclaratorias
           from encounters e join users u on u.id = e.professional_id
          where e.patient_id = $1 order by e.iniciado_at desc`,
        [id],
      );
      await audit(db, req, 'consultar_historial', 'paciente', id, id, { registros: rows.length });
      return rows;
    });
  });

  app.post(
    '/encounters/:id/addenda',
    { preHandler: requireRoles('medico'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = parse(idParams, req.params);
      const b = parse(
        pinSchema.extend({ motivo: z.string().trim().min(5).max(300), texto: z.string().trim().min(5).max(20000) }),
        req.body,
      );
      const a = auth(req);
      const nota = await tx(req, async (db) => {
        const e = await loadEncounter(db, id);
        if (e.estado !== 'firmado') throw conflict('Solo se agregan notas aclaratorias a historias firmadas');
        const nueva = {
          id: randomUUID(),
          tenant_id: e.tenant_id,
          encounter_id: id,
          autor_id: a.userId,
          motivo: b.motivo,
          texto: b.texto,
          created_at: new Date(),
        };
        const hash = hashCanonical(addendumPayload(nueva, e.content_hash));
        const { firma, signing_key_id } = await signHash(app, db, a.userId, b.pin, hash);
        const row = await one(
          db,
          `insert into encounter_addenda (id, encounter_id, autor_id, motivo, texto, created_at, content_hash, firma, signing_key_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
          [nueva.id, id, a.userId, b.motivo, b.texto, nueva.created_at.toISOString(), hash, firma, signing_key_id],
        );
        await audit(db, req, 'nota_aclaratoria', 'historia_clinica', id, e.patient_id, { nota: nueva.id, hash });
        return row;
      });
      return reply.code(201).send(nota);
    },
  );

  app.get('/encounters/:id/verify', { preHandler: lecturaClinica }, async (req) => {
    const { id } = parse(idParams, req.params);
    return tx(req, async (db) => {
      const e = await loadEncounter(db, id);
      if (e.estado !== 'firmado') throw conflict('La historia clínica no está firmada');
      const historia = await verifyStored(db, encounterPayload(e), e);
      const addenda = await many(db, 'select * from encounter_addenda where encounter_id = $1 order by created_at', [id]);
      const notas = [];
      for (const n of addenda) notas.push({ id: n.id, ...(await verifyStored(db, addendumPayload(n, e.content_hash), n)) });
      await audit(db, req, 'verificar_firma', 'historia_clinica', id, e.patient_id);
      return { valido: historia.valido && notas.every((n) => n.valido), historia, notas };
    });
  });

  app.get('/encounters/:id/pdf', { preHandler: lecturaClinica }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const data = await tx(req, async (db) => {
      const encounter = await loadEncounter(db, id);
      const template = getTemplate(encounter.plantilla, encounter.plantilla_version);
      if (!template) throw notFound('Plantilla no encontrada');
      const tenant = await tenantInfo(db);
      const patient = await one(db, 'select * from patients where id = $1', [encounter.patient_id]);
      const professional = await one(db, 'select * from users where id = $1', [encounter.professional_id]);
      const key = encounter.signing_key_id
        ? await one(db, 'select fingerprint from signing_keys where id = $1', [encounter.signing_key_id])
        : undefined;
      const addenda = await many(
        db,
        `select a.*, u.nombre as autor_nombre, k.fingerprint from encounter_addenda a
           join users u on u.id = a.autor_id join signing_keys k on k.id = a.signing_key_id
          where a.encounter_id = $1 order by a.created_at`,
        [id],
      );
      await audit(db, req, 'imprimir', 'historia_clinica', id, encounter.patient_id);
      return { tenant, patient, encounter, professional, template, fingerprint: key?.fingerprint ?? null, addenda };
    });
    const pdf = await renderHistoriaPdf(data);
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="historia-${id}.pdf"`)
      .header('cache-control', 'no-store')
      .send(pdf);
  });
}
