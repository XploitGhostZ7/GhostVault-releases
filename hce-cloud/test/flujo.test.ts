// By Kompilador
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fechaHoraColombia } from '../src/modules/billing/rips.js';
import { APP_URL, SUPER_TEST_URL } from './env.js';
import { PASSWORD, client, login, nuevoTenant, ok, type Api } from './helpers.js';

const PIN = '482915';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const contenidoCompleto = {
  motivo: { motivo_consulta: 'Dolor de garganta', enfermedad_actual: 'Cuadro de 3 días de odinofagia y fiebre' },
  antecedentes: { alergias: 'Niega', personales: 'HTA en manejo' },
  signos_vitales: { ta_sistolica: 128, ta_diastolica: 82, fc: 88, fr: 18, temperatura: 38.2, spo2: 97, peso: 72.5, talla: 170 },
  examen_fisico: { estado_general: 'Alerta, hidratado', hallazgos: 'Faringe eritematosa con exudado' },
  analisis_plan: { analisis: 'Faringoamigdalitis aguda', plan: 'Manejo antibiótico y control en 72 horas' },
};

describe('flujo completo de la atención', () => {
  let app: FastifyInstance;
  let t: Awaited<ReturnType<typeof nuevoTenant>>;
  let admin: Api, medico: Api, recepcion: Api, facturacion: Api, auditor: Api;
  let medicoId: string, pacienteId: string, citaId: string, admisionId: string, historiaId: string;
  let formulaId: string, labId: string;

  beforeAll(async () => {
    const { makeApp } = await import('./helpers.js');
    app = await makeApp();
    t = await nuevoTenant();
    admin = await login(app, t.slug, t.email);
    const crear = async (email: string, roles: string[], extra: Record<string, unknown> = {}) =>
      ok(
        await admin.post('/users', {
          email,
          nombre: `Usuario ${roles.join(' ')}`,
          tipo_documento: 'CC',
          numero_documento: String(Math.floor(Math.random() * 1e9)),
          roles,
          password: PASSWORD,
          ...extra,
        }),
        201,
      );
    medicoId = (await crear('medico@ips.co', ['medico'], { registro_profesional: 'RM-12345', especialidad: 'Medicina general' })).id;
    await crear('recepcion@ips.co', ['recepcion']);
    await crear('factura@ips.co', ['facturacion']);
    await crear('auditor@ips.co', ['auditor']);
    medico = await login(app, t.slug, 'medico@ips.co');
    recepcion = await login(app, t.slug, 'recepcion@ips.co');
    facturacion = await login(app, t.slug, 'factura@ips.co');
    auditor = await login(app, t.slug, 'auditor@ips.co');
  });

  afterAll(async () => {
    await app.close();
  });

  it('rechaza contraseñas débiles y exige autenticación', async () => {
    const r = await admin.post('/users', {
      email: 'x@ips.co', nombre: 'Débil', tipo_documento: 'CC', numero_documento: '123', roles: ['recepcion'], password: 'corta',
    });
    expect(r.status).toBe(400);
    expect((await client(app).get('/patients?q=ab')).status).toBe(401);
  });

  it('registra la llave de firma del médico', async () => {
    expect((await medico.post('/users/me/signing-key', { password: 'mala', pin: PIN })).status).toBe(401);
    const k = ok(await medico.post('/users/me/signing-key', { password: PASSWORD, pin: PIN }), 201);
    expect(k.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect((await recepcion.post('/users/me/signing-key', { password: PASSWORD, pin: PIN })).status).toBe(403);
  });

  it('agenda una cita en un cupo disponible y bloquea cruces', async () => {
    const manana = fechaHoraColombia(new Date(Date.now() + 86_400_000)).slice(0, 10);
    const dow = new Date(`${manana}T12:00:00Z`).getUTCDay() || 7;
    ok(await admin.post('/schedules', { professional_id: medicoId, dia_semana: dow, hora_inicio: '08:00', hora_fin: '12:00', duracion_min: 20 }), 201);

    const sinConsentimiento = ok(
      await recepcion.post('/patients', {
        tipo_documento: 'CC', numero_documento: '99887766', primer_nombre: 'Sin', primer_apellido: 'Consentimiento',
        fecha_nacimiento: '1980-01-01', sexo: 'H',
      }),
      201,
    );
    const p = ok(
      await recepcion.post('/patients', {
        tipo_documento: 'CC', numero_documento: '52123456', primer_nombre: 'Ana', segundo_nombre: 'María',
        primer_apellido: 'Gómez', segundo_apellido: 'Rojas', fecha_nacimiento: '1990-05-14', sexo: 'M',
        municipio_residencia: '11001', zona_residencia: '01', tipo_usuario: '01', eps_codigo: 'EPS037', eps_nombre: 'EPS Prueba',
        consentimiento_datos: true,
      }),
      201,
    );
    pacienteId = p.id;
    expect(p.consentimiento_datos_at).toBeTruthy();
    expect((await recepcion.post('/patients', { tipo_documento: 'CC', numero_documento: '52123456', primer_nombre: 'Otra', primer_apellido: 'Persona', fecha_nacimiento: '1990-01-01', sexo: 'M' })).status).toBe(409);

    const slots = ok<any[]>(await recepcion.get(`/agenda/slots?professional_id=${medicoId}&fecha=${manana}`));
    expect(slots).toHaveLength(12);
    const cita = ok(await recepcion.post('/appointments', { patient_id: pacienteId, professional_id: medicoId, inicio: slots[0].inicio, duracion_min: 20 }), 201);
    citaId = cita.id;

    const cruce = await recepcion.post('/appointments', {
      patient_id: sinConsentimiento.id, professional_id: medicoId, inicio: new Date(new Date(slots[0].inicio).getTime() + 10 * 60_000).toISOString(),
    });
    expect(cruce.status).toBe(409);
    expect(ok<any[]>(await recepcion.get(`/agenda/slots?professional_id=${medicoId}&fecha=${manana}`))).toHaveLength(11);
    expect(ok<any[]>(await recepcion.get(`/appointments?fecha=${manana}`))).toHaveLength(1);

    const sinAut = await recepcion.post('/admissions', {
      patient_id: sinConsentimiento.id, professional_id: medicoId, cod_servicio: '328', cod_consulta: '890201', valor_servicio: 50000,
    });
    expect(sinAut.status).toBe(409);
  });

  it('admite al paciente con datos RIPS', async () => {
    const a = ok(
      await recepcion.post('/admissions', {
        appointment_id: citaId, cod_servicio: '328', cod_consulta: '890201', num_autorizacion: 'AUT-001',
        valor_servicio: 60000, concepto_recaudo: '02', valor_pago_moderador: 4500,
      }),
      201,
    );
    admisionId = a.id;
    expect(a.tipo_usuario).toBe('01');
    expect((await recepcion.post(`/appointments/${citaId}/cancel`, { motivo: 'x' })).status).toBe(409);
  });

  it('diligencia, valida y firma la historia clínica', async () => {
    const e = ok(await medico.post('/encounters', { admission_id: admisionId, plantilla: 'medicina_general' }), 201);
    historiaId = e.id;
    expect((await medico.post('/encounters', { admission_id: admisionId, plantilla: 'medicina_general' })).status).toBe(409);

    ok(await medico.patch(`/encounters/${historiaId}`, { contenido: { motivo: { motivo_consulta: 'Dolor de garganta' } } }));
    expect((await medico.patch(`/encounters/${historiaId}`, { contenido: { signos_vitales: { fc: 900 } } })).status).toBe(400);
    expect((await medico.patch(`/encounters/${historiaId}`, { contenido: { inventado: {} } })).status).toBe(400);

    const incompleta = await medico.post(`/encounters/${historiaId}/sign`, { pin: PIN });
    expect(incompleta.status).toBe(400);

    ok(
      await medico.patch(`/encounters/${historiaId}`, {
        contenido: contenidoCompleto,
        diagnostico_principal: 'J03.9',
        diagnosticos_relacionados: ['I10'],
        tipo_diagnostico_principal: '01',
        finalidad: '15',
        causa_externa: '38',
      }),
    );
    expect((await medico.post(`/encounters/${historiaId}/sign`, { pin: '000000' })).status).toBe(401);
    const firmada = ok(await medico.post(`/encounters/${historiaId}/sign`, { pin: PIN }));
    expect(firmada.estado).toBe('firmado');
    expect(firmada.diagnostico_principal).toBe('J039');
    expect(firmada.content_hash).toMatch(/^[0-9a-f]{64}$/);

    expect((await medico.patch(`/encounters/${historiaId}`, { contenido: contenidoCompleto })).status).toBe(409);
    const adm = ok(await recepcion.get(`/admissions/${admisionId}`));
    expect(adm.estado).toBe('cerrada');
  });

  it('impide modificar la historia firmada incluso desde la base de datos', async () => {
    const c = new pg.Client({ connectionString: APP_URL });
    await c.connect();
    await c.query('begin');
    await c.query("select set_config('app.tenant_id', $1, true)", [t.tenantId]);
    await expect(c.query("update encounters set contenido = '{}' where id = $1", [historiaId])).rejects.toThrow(/inmutable|firmada/i);
    await c.query('rollback');
    await c.query('begin');
    await c.query("select set_config('app.tenant_id', $1, true)", [t.tenantId]);
    await expect(c.query('delete from audit_log')).rejects.toThrow();
    await c.query('rollback');
    await c.end();
  });

  it('agrega una nota aclaratoria firmada y verifica las firmas', async () => {
    const n = ok(
      await medico.post(`/encounters/${historiaId}/addenda`, {
        pin: PIN, motivo: 'Corrección de dato', texto: 'Se aclara que la temperatura fue tomada en axila.',
      }),
      201,
    );
    expect(n.content_hash).toMatch(/^[0-9a-f]{64}$/);
    const v = ok(await auditor.get(`/encounters/${historiaId}/verify`));
    expect(v.valido).toBe(true);
    expect(v.notas).toHaveLength(1);

    const detalle = ok(await auditor.get(`/encounters/${historiaId}`));
    expect(detalle.addenda).toHaveLength(1);
    expect((await recepcion.get(`/encounters/${historiaId}`)).status).toBe(403);
  });

  it('emite fórmula médica y orden de laboratorio firmadas', async () => {
    const f = ok(
      await medico.post(`/encounters/${historiaId}/orders`, {
        tipo: 'formula',
        items: [
          { cum: '19943231-1', nombre: 'Amoxicilina', concentracion: '500 mg', forma_farmaceutica: 'Cápsula', via: 'Oral', dosis: '1 cápsula', frecuencia: '8 horas', duracion_dias: 7, cantidad: 21, unidad: 'cápsulas' },
          { nombre: 'Acetaminofén', concentracion: '500 mg', forma_farmaceutica: 'Tableta', via: 'Oral', dosis: '1 tableta', frecuencia: '6 horas', duracion_dias: 3, cantidad: 12 },
        ],
      }),
      201,
    );
    formulaId = f.id;
    expect(
      (await medico.post(`/encounters/${historiaId}/orders`, { tipo: 'formula', items: [{ nombre: 'X' }] })).status,
    ).toBe(400);
    const l = ok(
      await medico.post(`/encounters/${historiaId}/orders`, {
        tipo: 'laboratorio', items: [{ cups: '902210', descripcion: 'Hemograma IV', justificacion: 'Cuadro febril' }],
      }),
      201,
    );
    labId = l.id;
    ok(await medico.post(`/orders/${formulaId}/sign`, { pin: PIN }));
    ok(await medico.post(`/orders/${labId}/sign`, { pin: PIN }));
    expect((await medico.patch(`/orders/${formulaId}`, { observaciones: 'x' })).status).toBe(409);
    const leida = ok(await auditor.get(`/orders/${formulaId}`));
    expect(leida.verificacion.valido).toBe(true);
  });

  it('genera los PDF de historia clínica y fórmula', async () => {
    for (const url of [`/encounters/${historiaId}/pdf`, `/orders/${formulaId}/pdf`, `/orders/${labId}/pdf`]) {
      const r = await medico.get(url);
      expect(r.status).toBe(200);
      expect(r.raw.headers['content-type']).toBe('application/pdf');
      expect(r.raw.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
      expect(r.raw.rawPayload.length).toBeGreaterThan(1500);
    }
  });

  it('factura con FEV y genera RIPS validados', async () => {
    const pre = ok(await facturacion.post('/billing/rips/preview', { admission_ids: [admisionId] }));
    expect(pre.hallazgos).toEqual([]);

    const inv = ok(
      await facturacion.post('/billing/invoices', {
        admission_ids: [admisionId],
        pagador: { tipo: 'eps', tipo_documento: 'NI', numero_documento: '800123456', nombre: 'EPS Prueba' },
        modalidad_pago: '04',
        numero_contrato: 'CT-2026-01',
      }),
      201,
    );
    expect(inv.total).toBe(55500);
    expect(
      (await facturacion.post('/billing/invoices', {
        admission_ids: [admisionId],
        pagador: { tipo: 'eps', tipo_documento: 'NI', numero_documento: '800123456', nombre: 'EPS Prueba' },
      })).status,
    ).toBe(409);

    const emitida = ok(await facturacion.post(`/billing/invoices/${inv.id}/emitir`));
    expect(emitida.estado).toBe('validada');
    expect(emitida.cufe).toMatch(/^[0-9a-f]{96}$/);
    expect(emitida.cuv).toMatch(/^[0-9a-f]{96}$/);

    const rips = ok(await facturacion.get(`/billing/invoices/${inv.id}/rips`));
    expect(rips.numDocumentoIdObligado).toBe('900123456');
    expect(rips.numFactura).toBe(`${emitida.prefijo}${emitida.numero}`);
    const u = rips.usuarios[0];
    expect(u).toMatchObject({ tipoDocumentoIdentificacion: 'CC', numDocumentoIdentificacion: '52123456', codSexo: 'M', codMunicipioResidencia: '11001', consecutivo: 1 });
    expect(u.servicios.consultas[0]).toMatchObject({
      codPrestador: '110010000001', codConsulta: '890201', codServicio: 328, codDiagnosticoPrincipal: 'J039',
      codDiagnosticoRelacionado1: 'I10', tipoDiagnosticoPrincipal: '01', finalidadTecnologiaSalud: '15',
      causaMotivoAtencion: '38', vrServicio: 60000, valorPagoModerador: 4500, conceptoRecaudo: '02', numAutorizacion: 'AUT-001',
    });
    expect(u.servicios.consultas[0].fechaInicioAtencion).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect((await facturacion.post(`/billing/invoices/${inv.id}/emitir`)).status).toBe(409);
    expect((await medico.get(`/billing/invoices/${inv.id}`)).status).toBe(403);
  });

  it('exporta la historia en FHIR R4', async () => {
    const r = await medico.get(`/fhir/Patient/${pacienteId}/$everything`);
    expect(r.status).toBe(200);
    expect(r.raw.headers['content-type']).toContain('application/fhir+json');
    const b = r.body;
    expect(b.resourceType).toBe('Bundle');
    const tipos = b.entry.map((e: any) => e.resource.resourceType);
    for (const tipo of ['Organization', 'Patient', 'Practitioner', 'Encounter', 'Condition', 'Observation', 'MedicationRequest', 'ServiceRequest', 'Provenance', 'DocumentReference']) {
      expect(tipos).toContain(tipo);
    }
    const ids = new Set<string>();
    for (const e of b.entry) {
      expect(e.resource.id).toMatch(UUID_RE);
      expect(e.fullUrl).toBe(`urn:uuid:${e.resource.id}`);
      ids.add(e.fullUrl);
    }
    expect(ids.size).toBe(b.entry.length);
    const refs = JSON.stringify(b).match(/"reference":"urn:uuid:[^"]+"/g) ?? [];
    for (const ref of refs) expect(ids.has(ref.slice(13, -1))).toBe(true);

    const bp = b.entry.map((e: any) => e.resource).find((x: any) => x.code?.coding?.[0]?.code === '85354-9');
    expect(bp.component).toHaveLength(2);
    const cond = b.entry.map((e: any) => e.resource).filter((x: any) => x.resourceType === 'Condition');
    expect(cond.map((c: any) => c.code.coding[0].code).sort()).toEqual(['I10', 'J039']);
  });

  it('mantiene la cadena de auditoría y detecta manipulaciones', async () => {
    const accesos = ok<any[]>(await auditor.get(`/audit?paciente_id=${pacienteId}`));
    const acciones = new Set(accesos.map((a) => a.accion));
    for (const a of ['crear', 'admitir', 'firmar', 'nota_aclaratoria', 'imprimir', 'exportar_fhir', 'consultar']) expect(acciones).toContain(a);

    const v = ok(await auditor.get('/audit/verify'));
    expect(v.valido).toBe(true);
    expect(v.registros).toBeGreaterThan(20);

    const su = new pg.Client({ connectionString: SUPER_TEST_URL });
    await su.connect();
    await su.query('begin');
    await su.query('set local session_replication_role = replica');
    await su.query(
      "update audit_log set detalle = '{\"manipulado\":true}' where tenant_id = $1 and seq = 3",
      [t.tenantId],
    );
    await su.query(
      "update encounters set contenido = jsonb_set(contenido, '{analisis_plan,plan}', '\"alterado\"') where id = $1",
      [historiaId],
    );
    await su.query('commit');
    await su.end();

    const v2 = ok(await auditor.get('/audit/verify'));
    expect(v2.valido).toBe(false);
    expect(v2.primer_error).toBe(3);
    const firma = ok(await auditor.get(`/encounters/${historiaId}/verify`));
    expect(firma.valido).toBe(false);
    expect(firma.historia.hash_coincide).toBe(false);
  });
});
