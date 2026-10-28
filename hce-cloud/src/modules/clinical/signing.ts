// By Kompilador
import type { FastifyInstance } from 'fastify';
import { one, type Db } from '../../db.js';
import { hashCanonical } from '../../lib/canonical.js';
import { InvalidPinError, signWithPin, verifySignature } from '../../lib/crypto.js';
import { HttpError, conflict } from '../../lib/errors.js';

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

export function encounterPayload(e: any) {
  return {
    tipo: 'historia_clinica',
    id: e.id,
    tenant_id: e.tenant_id,
    patient_id: e.patient_id,
    admission_id: e.admission_id,
    professional_id: e.professional_id,
    plantilla: e.plantilla,
    plantilla_version: e.plantilla_version,
    contenido: e.contenido,
    diagnostico_principal: e.diagnostico_principal,
    diagnosticos_relacionados: e.diagnosticos_relacionados,
    tipo_diagnostico_principal: e.tipo_diagnostico_principal,
    finalidad: e.finalidad,
    causa_externa: e.causa_externa,
    iniciado_at: iso(e.iniciado_at),
    firmado_at: iso(e.firmado_at),
  };
}

export function addendumPayload(a: any, encounterHash: string) {
  return {
    tipo: 'nota_aclaratoria',
    id: a.id,
    tenant_id: a.tenant_id,
    encounter_id: a.encounter_id,
    encounter_hash: encounterHash,
    autor_id: a.autor_id,
    motivo: a.motivo,
    texto: a.texto,
    created_at: iso(a.created_at),
  };
}

export function orderPayload(o: any) {
  return {
    tipo: 'orden_medica',
    id: o.id,
    tenant_id: o.tenant_id,
    encounter_id: o.encounter_id,
    patient_id: o.patient_id,
    professional_id: o.professional_id,
    tipo_orden: o.tipo,
    items: o.items,
    observaciones: o.observaciones,
    firmado_at: iso(o.firmado_at),
  };
}

export async function signHash(
  app: FastifyInstance,
  db: Db,
  userId: string,
  pin: string,
  hash: string,
): Promise<{ firma: string; signing_key_id: string }> {
  const key = await one<{ id: string; encrypted_private_key: string }>(
    db,
    'select id, encrypted_private_key from signing_keys where user_id = $1 and revoked_at is null',
    [userId],
  );
  if (!key) throw conflict('No tiene llave de firma registrada');
  try {
    const firma = await signWithPin(key.encrypted_private_key, pin, app.ctx.config.APP_ENCRYPTION_KEY, userId, hash);
    return { firma, signing_key_id: key.id };
  } catch (e) {
    if (e instanceof InvalidPinError) throw new HttpError(403, 'PIN de firma incorrecto');
    throw e;
  }
}

export type Verificacion = { valido: boolean; hash_coincide: boolean; firma_valida: boolean; fingerprint: string | null };

export async function verifyStored(
  db: Db,
  payload: unknown,
  stored: { content_hash: string | null; firma: string | null; signing_key_id: string | null },
): Promise<Verificacion> {
  if (!stored.content_hash || !stored.firma || !stored.signing_key_id) {
    return { valido: false, hash_coincide: false, firma_valida: false, fingerprint: null };
  }
  const key = await one<{ public_key: string; fingerprint: string }>(
    db,
    'select public_key, fingerprint from signing_keys where id = $1',
    [stored.signing_key_id],
  );
  const hash = hashCanonical(payload);
  const hashOk = hash === stored.content_hash;
  const firmaOk = !!key && verifySignature(key.public_key, stored.content_hash, stored.firma);
  return { valido: hashOk && firmaOk, hash_coincide: hashOk, firma_valida: firmaOk, fingerprint: key?.fingerprint ?? null };
}
