// By Kompilador
import type { FastifyInstance } from 'fastify';
import { many, one } from '../../db.js';
import { audit, idParams, parse, requireRoles, tx } from '../../http.js';
import { orNotFound } from '../../lib/errors.js';
import { tenantInfo } from '../clinical/routes.js';
import { bundle, encounterResources, orderResources, organization, patient, practitioner } from './mapper.js';

const FHIR_JSON = 'application/fhir+json; charset=utf-8';

export function registerFhirRoutes(app: FastifyInstance) {
  const acceso = { preHandler: requireRoles('medico', 'auditor') };

  app.get('/fhir/metadata', async (_req, reply) =>
    reply.header('content-type', FHIR_JSON).send({
      resourceType: 'CapabilityStatement',
      status: 'active',
      date: new Date().toISOString(),
      kind: 'instance',
      fhirVersion: '4.0.1',
      format: ['application/fhir+json'],
      rest: [
        {
          mode: 'server',
          security: { service: [{ text: 'Bearer JWT + MFA' }] },
          resource: [
            { type: 'Patient', interaction: [{ code: 'read' }], operation: [{ name: 'everything', definition: 'http://hl7.org/fhir/OperationDefinition/Patient-everything' }] },
          ],
        },
      ],
    }),
  );

  app.get('/fhir/Patient/:id', acceso, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const res = await tx(req, async (db) => {
      const p = orNotFound(await one(db, 'select * from patients where id = $1', [id]), 'Paciente no encontrado');
      const org = organization(await tenantInfo(db));
      await audit(db, req, 'exportar_fhir', 'paciente', id, id, { alcance: 'Patient' });
      return patient(p, org);
    });
    return reply.header('content-type', FHIR_JSON).send(res);
  });

  app.get('/fhir/Patient/:id/$everything', acceso, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const res = await tx(req, async (db) => {
      const p = orNotFound(await one(db, 'select * from patients where id = $1', [id]), 'Paciente no encontrado');
      const org = organization(await tenantInfo(db));
      const pat = patient(p, org);

      const encounters = await many(db, "select * from encounters where patient_id = $1 and estado = 'firmado' order by iniciado_at", [id]);
      const encIds = encounters.map((e) => e.id);
      const addenda = await many(db, 'select * from encounter_addenda where encounter_id = any($1::uuid[]) order by created_at', [encIds]);
      const orders = await many(
        db,
        "select * from clinical_orders where patient_id = $1 and estado = 'firmado' order by consecutivo",
        [id],
      );
      const userIds = [...new Set([...encounters.map((e) => e.professional_id), ...addenda.map((a) => a.autor_id), ...orders.map((o) => o.professional_id)])];
      const users = await many(db, 'select * from users where id = any($1::uuid[])', [userIds]);
      const pracs = new Map(users.map((u) => [u.id, practitioner(u)]));

      const resources = [org, pat, ...pracs.values()];
      for (const e of encounters) {
        resources.push(...encounterResources(e, pat, pracs.get(e.professional_id)!, org, addenda.filter((a) => a.encounter_id === e.id)));
      }
      for (const o of orders) resources.push(...orderResources(o, pat, pracs.get(o.professional_id)!, o.encounter_id));

      await audit(db, req, 'exportar_fhir', 'paciente', id, id, {
        alcance: '$everything',
        encuentros: encounters.length,
        ordenes: orders.length,
      });
      return bundle(resources);
    });
    return reply.header('content-type', FHIR_JSON).send(res);
  });
}
