// By Kompilador
import { describe, expect, it } from 'vitest';
import { canonicalize } from '../src/lib/canonical.js';
import { generateSigningKey, signWithPin, verifySignature, InvalidPinError } from '../src/lib/crypto.js';
import { numeroALetras } from '../src/lib/numeros.js';
import { base32Encode, totpAt, verifyTotp } from '../src/lib/totp.js';
import { contentSchema, getTemplate } from '../src/modules/clinical/templates.js';
import { fechaHoraColombia, prevalidarRips } from '../src/modules/billing/rips.js';
import { derivedId } from '../src/modules/fhir/mapper.js';

describe('utilidades', () => {
  it('canonicaliza JSON con llaves ordenadas', () => {
    expect(canonicalize({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it('TOTP cumple el vector de prueba del RFC 6238', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(totpAt(secret, 59_000)).toBe('287082');
    expect(totpAt(secret, 1_111_111_109_000)).toBe('081804');
    expect(verifyTotp(secret, '287082', 59_000)).toBe(true);
    expect(verifyTotp(secret, '287083', 59_000)).toBe(false);
  });

  it('escribe cantidades en letras para la fórmula médica', () => {
    expect(numeroALetras(21)).toBe('veintiuno');
    expect(numeroALetras(100)).toBe('cien');
    expect(numeroALetras(115)).toBe('ciento quince');
    expect(numeroALetras(1500)).toBe('mil quinientos');
    expect(numeroALetras(21000)).toBe('veintiún mil');
    expect(numeroALetras(31045)).toBe('treinta y un mil cuarenta y cinco');
  });

  it('firma y verifica con Ed25519 protegido por PIN', async () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const k = await generateSigningKey('123456', key, 'u1');
    const hash = 'ab'.repeat(32);
    const firma = await signWithPin(k.encryptedPrivateKey, '123456', key, 'u1', hash);
    expect(verifySignature(k.publicKeyPem, hash, firma)).toBe(true);
    expect(verifySignature(k.publicKeyPem, 'cd'.repeat(32), firma)).toBe(false);
    await expect(signWithPin(k.encryptedPrivateKey, '654321', key, 'u1', hash)).rejects.toBeInstanceOf(InvalidPinError);
    await expect(signWithPin(k.encryptedPrivateKey, '123456', key, 'otro', hash)).rejects.toThrow();
  });

  it('convierte fechas a hora de Colombia en formato RIPS', () => {
    expect(fechaHoraColombia('2026-03-01T02:30:00Z')).toBe('2026-02-28 21:30');
  });

  it('genera UUID v5 deterministas', () => {
    expect(derivedId('a', 'b')).toBe(derivedId('a', 'b'));
    expect(derivedId('a', 'b')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('plantillas', () => {
  it('valida campos obligatorios solo al firmar', () => {
    const t = getTemplate('psicologia')!;
    expect(contentSchema(t, false).safeParse({ motivo: { motivo_consulta: 'Ansiedad' } }).success).toBe(true);
    expect(contentSchema(t, true).safeParse({ motivo: { motivo_consulta: 'Ansiedad' } }).success).toBe(false);
    expect(contentSchema(t, false).safeParse({ examen_mental: { riesgo_suicida: 'quizas' } }).success).toBe(false);
  });
});

describe('prevalidación RIPS', () => {
  it('reporta campos faltantes', () => {
    const h = prevalidarRips({
      numDocumentoIdObligado: '900123456',
      numFactura: 'SETT1',
      tipoNota: null,
      numNota: null,
      usuarios: [
        {
          tipoDocumentoIdentificacion: 'CC', numDocumentoIdentificacion: '1', tipoUsuario: '01', fechaNacimiento: '2000-01-01',
          codSexo: 'H', codPaisResidencia: '170', codMunicipioResidencia: null, codZonaTerritorialResidencia: '01',
          incapacidad: 'NO', consecutivo: 1, codPaisOrigen: '170', servicios: { consultas: [] },
        },
      ],
    });
    expect(h.map((x) => x.ruta)).toEqual(['usuarios[0].codMunicipioResidencia']);
  });
});
