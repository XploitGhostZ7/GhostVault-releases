// By Kompilador
// Exportación HL7 FHIR R4. Los sistemas de identificadores locales están centralizados en SYS
// para alinearlos con la guía de implementación IHCE de MinSalud sin tocar el mapeo.
import { createHash } from 'node:crypto';
import { getTemplate } from '../clinical/templates.js';

const BASE = 'https://hce.kompilador.co/fhir';

export const SYS = {
  nit: `${BASE}/NamingSystem/nit`,
  reps: `${BASE}/NamingSystem/codigo-prestador-reps`,
  documento: `${BASE}/NamingSystem/documento-identidad`,
  tipoDocumento: `${BASE}/CodeSystem/tipo-documento`,
  rethus: `${BASE}/NamingSystem/registro-profesional`,
  cups: `${BASE}/CodeSystem/cups`,
  cum: `${BASE}/CodeSystem/cum`,
  divipola: `${BASE}/CodeSystem/divipola`,
  contentHash: `${BASE}/StructureDefinition/content-hash-sha256`,
  icd10: 'http://hl7.org/fhir/sid/icd-10',
  loinc: 'http://loinc.org',
  ucum: 'http://unitsofmeasure.org',
  actCode: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
  obsCategory: 'http://terminology.hl7.org/CodeSystem/observation-category',
  condCategory: 'http://terminology.hl7.org/CodeSystem/condition-category',
  condClinical: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
  condVerification: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
  signatureType: 'urn:iso-astm:E1762-95:2013',
};

type Resource = Record<string, unknown> & { resourceType: string; id: string };

const NAMESPACE = Buffer.from('6f1c2a9e4b7d4e0a9c3f8b1d2e5a7c90', 'hex');

export function derivedId(...parts: string[]): string {
  const h = createHash('sha1').update(NAMESPACE).update(parts.join('|')).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const ref = (r: Resource) => ({ reference: `urn:uuid:${r.id}` });
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : undefined);
const docId = (tipo: string, numero: string) => ({
  type: { coding: [{ system: SYS.tipoDocumento, code: tipo }] },
  system: SYS.documento,
  value: `${tipo}-${numero}`,
});

export function organization(t: any): Resource {
  return {
    resourceType: 'Organization',
    id: t.id,
    identifier: [
      { system: SYS.nit, value: t.dv ? `${t.nit}-${t.dv}` : t.nit },
      { system: SYS.reps, value: t.codigo_prestador },
    ],
    active: true,
    name: t.razon_social,
    ...(t.telefono ? { telecom: [{ system: 'phone', value: t.telefono }] } : {}),
  };
}

export function practitioner(u: any): Resource {
  return {
    resourceType: 'Practitioner',
    id: u.id,
    identifier: [
      docId(u.tipo_documento, u.numero_documento),
      ...(u.registro_profesional ? [{ system: SYS.rethus, value: u.registro_profesional }] : []),
    ],
    active: u.activo,
    name: [{ text: u.nombre }],
    ...(u.especialidad ? { qualification: [{ code: { text: u.especialidad } }] } : {}),
  };
}

const GENERO: Record<string, string> = { H: 'male', M: 'female', I: 'other' };

export function patient(p: any, org: Resource): Resource {
  return {
    resourceType: 'Patient',
    id: p.id,
    identifier: [docId(p.tipo_documento, p.numero_documento)],
    active: true,
    name: [
      {
        use: 'official',
        family: [p.primer_apellido, p.segundo_apellido].filter(Boolean).join(' '),
        given: [p.primer_nombre, p.segundo_nombre].filter(Boolean),
      },
    ],
    gender: GENERO[p.sexo] ?? 'unknown',
    birthDate: p.fecha_nacimiento,
    ...(p.telefono || p.email
      ? {
          telecom: [
            ...(p.telefono ? [{ system: 'phone', value: p.telefono }] : []),
            ...(p.email ? [{ system: 'email', value: p.email }] : []),
          ],
        }
      : {}),
    address: [
      {
        ...(p.direccion ? { line: [p.direccion] } : {}),
        ...(p.municipio_residencia
          ? {
              city: p.municipio_residencia,
              extension: [
                { url: `${BASE}/StructureDefinition/municipio-divipola`, valueCoding: { system: SYS.divipola, code: p.municipio_residencia } },
              ],
            }
          : {}),
        country: p.pais_residencia === '170' ? 'CO' : p.pais_residencia,
      },
    ],
    managingOrganization: ref(org),
  };
}

const VERIFICACION: Record<string, string> = { '01': 'provisional', '02': 'confirmed', '03': 'confirmed' };

function provenance(targets: Resource[], firmadoAt: unknown, who: Resource, firma: string, hash: string): Resource {
  return {
    resourceType: 'Provenance',
    id: derivedId('provenance', hash),
    target: targets.map(ref),
    recorded: iso(firmadoAt),
    agent: [{ who: ref(who) }],
    signature: [
      {
        type: [{ system: SYS.signatureType, code: '1.2.840.10065.1.12.1.1', display: "Author's Signature" }],
        when: iso(firmadoAt),
        who: ref(who),
        sigFormat: 'application/octet-stream',
        data: firma,
      },
    ],
    extension: [{ url: SYS.contentHash, valueString: hash }],
  };
}

export function encounterResources(e: any, pat: Resource, prac: Resource, org: Resource, addenda: any[]): Resource[] {
  const encounter: Resource = {
    resourceType: 'Encounter',
    id: e.id,
    status: e.estado === 'firmado' ? 'finished' : 'in-progress',
    class: { system: SYS.actCode, code: 'AMB', display: 'ambulatory' },
    type: [{ text: getTemplate(e.plantilla, e.plantilla_version)?.nombre ?? e.plantilla }],
    subject: ref(pat),
    participant: [{ individual: ref(prac) }],
    period: { start: iso(e.iniciado_at), ...(e.firmado_at ? { end: iso(e.firmado_at) } : {}) },
    serviceProvider: ref(org),
  };

  const out: Resource[] = [encounter];
  const codigos: Array<[string, boolean]> = [
    ...(e.diagnostico_principal ? [[e.diagnostico_principal, true] as [string, boolean]] : []),
    ...(e.diagnosticos_relacionados as string[]).map((c) => [c, false] as [string, boolean]),
  ];
  const diagnosis = codigos.map(([codigo, principal], i) => {
    const cond: Resource = {
      resourceType: 'Condition',
      id: derivedId('condition', e.id, String(i)),
      clinicalStatus: { coding: [{ system: SYS.condClinical, code: 'active' }] },
      verificationStatus: {
        coding: [{ system: SYS.condVerification, code: principal ? (VERIFICACION[e.tipo_diagnostico_principal] ?? 'provisional') : 'provisional' }],
      },
      category: [{ coding: [{ system: SYS.condCategory, code: 'encounter-diagnosis' }] }],
      code: { coding: [{ system: SYS.icd10, code: codigo }] },
      subject: ref(pat),
      encounter: ref(encounter),
      recordedDate: iso(e.firmado_at ?? e.iniciado_at),
      recorder: ref(prac),
    };
    out.push(cond);
    return { condition: ref(cond), rank: i + 1 };
  });
  if (diagnosis.length) encounter.diagnosis = diagnosis;

  out.push(...vitalSigns(e, pat, encounter, prac));

  if (e.estado === 'firmado') out.push(provenance([encounter], e.firmado_at, prac, e.firma, e.content_hash));

  for (const a of addenda) {
    const doc: Resource = {
      resourceType: 'DocumentReference',
      id: a.id,
      status: 'current',
      type: { text: 'Nota aclaratoria' },
      subject: ref(pat),
      date: iso(a.created_at),
      author: [{ reference: `urn:uuid:${a.autor_id}` }],
      description: a.motivo,
      content: [{ attachment: { contentType: 'text/plain; charset=utf-8', data: Buffer.from(a.texto).toString('base64') } }],
      context: { encounter: [ref(encounter)] },
      extension: [{ url: SYS.contentHash, valueString: a.content_hash }],
    };
    out.push(doc);
  }
  return out;
}

function vitalSigns(e: any, pat: Resource, enc: Resource, prac: Resource): Resource[] {
  if (e.estado !== 'firmado') return [];
  const t = getTemplate(e.plantilla, e.plantilla_version);
  if (!t) return [];
  const valores: Record<string, { value: number; unit: string; loinc: string; label: string }> = {};
  for (const sec of t.sections) {
    for (const f of sec.fields) {
      const v = e.contenido?.[sec.key]?.[f.key];
      if (f.loinc && typeof v === 'number') valores[f.key] = { value: v, unit: f.unit ?? '', loinc: f.loinc, label: f.label };
    }
  }
  const base = (id: string) => ({
    resourceType: 'Observation',
    id,
    status: 'final',
    category: [{ coding: [{ system: SYS.obsCategory, code: 'vital-signs' }] }],
    subject: ref(pat),
    encounter: ref(enc),
    effectiveDateTime: iso(e.iniciado_at),
    performer: [ref(prac)],
  });
  const qty = (v: { value: number; unit: string }) => ({ value: v.value, unit: v.unit, system: SYS.ucum, code: v.unit });
  const out: Resource[] = [];
  let n = 0;
  const nextId = () => derivedId('vital', e.id, String(n++));
  const { ta_sistolica: sis, ta_diastolica: dia, ...resto } = valores;
  if (sis && dia) {
    out.push({
      ...base(nextId()),
      code: { coding: [{ system: SYS.loinc, code: '85354-9', display: 'Blood pressure panel' }] },
      component: [
        { code: { coding: [{ system: SYS.loinc, code: sis.loinc }] }, valueQuantity: qty(sis) },
        { code: { coding: [{ system: SYS.loinc, code: dia.loinc }] }, valueQuantity: qty(dia) },
      ],
    });
  }
  for (const v of Object.values(resto)) {
    out.push({ ...base(nextId()), code: { coding: [{ system: SYS.loinc, code: v.loinc }], text: v.label }, valueQuantity: qty(v) });
  }
  return out;
}

export function orderResources(o: any, pat: Resource, prac: Resource, encounterId: string): Resource[] {
  const enc = { reference: `urn:uuid:${encounterId}` };
  const out: Resource[] = [];
  const requisition = { system: `${BASE}/NamingSystem/orden`, value: String(o.consecutivo) };
  (o.items as any[]).forEach((it, i) => {
    const id = derivedId('order-item', o.id, String(i));
    if (o.tipo === 'formula') {
      out.push({
        resourceType: 'MedicationRequest',
        id,
        groupIdentifier: requisition,
        status: 'active',
        intent: 'order',
        medicationCodeableConcept: {
          ...(it.cum ? { coding: [{ system: SYS.cum, code: it.cum }] } : {}),
          text: `${it.nombre} ${it.concentracion} ${it.forma_farmaceutica}`,
        },
        subject: ref(pat),
        encounter: enc,
        authoredOn: iso(o.firmado_at),
        requester: ref(prac),
        dosageInstruction: [
          { text: `${it.dosis} cada ${it.frecuencia} durante ${it.duracion_dias} días`, route: { text: it.via }, patientInstruction: it.indicaciones },
        ],
        dispenseRequest: {
          quantity: { value: it.cantidad, ...(it.unidad ? { unit: it.unidad } : {}) },
          expectedSupplyDuration: { value: it.duracion_dias, unit: 'd', system: SYS.ucum, code: 'd' },
        },
      });
    } else {
      out.push({
        resourceType: 'ServiceRequest',
        id,
        requisition,
        status: 'active',
        intent: 'order',
        category: [{ text: o.tipo }],
        priority: it.prioridad === 'urgente' ? 'urgent' : 'routine',
        code: { coding: [{ system: SYS.cups, code: it.cups }], text: it.descripcion },
        quantityQuantity: { value: it.cantidad },
        subject: ref(pat),
        encounter: enc,
        authoredOn: iso(o.firmado_at),
        requester: ref(prac),
        ...(it.justificacion ? { reasonCode: [{ text: it.justificacion }] } : {}),
      });
    }
  });
  if (o.estado === 'firmado') out.push(provenance([...out], o.firmado_at, prac, o.firma, o.content_hash));
  return out;
}

export function bundle(resources: Resource[]) {
  return {
    resourceType: 'Bundle',
    id: crypto.randomUUID(),
    meta: { lastUpdated: new Date().toISOString() },
    type: 'collection',
    timestamp: new Date().toISOString(),
    entry: resources.map((r) => ({ fullUrl: `urn:uuid:${r.id}`, resource: r })),
  };
}
