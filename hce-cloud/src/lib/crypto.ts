// By Kompilador
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  scrypt,
  sign,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import { promisify } from 'node:util';
import { sha256Hex } from './canonical.js';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, key] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scryptAsync(password.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return timingSafeEqual(expected, actual);
}

export const DUMMY_PASSWORD_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

type Sealed = { v: 1; iv: string; tag: string; ct: string; salt?: string };

function seal(key: Buffer, plaintext: Buffer, aad: string, salt?: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const sealed: Sealed = {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
    ...(salt ? { salt: salt.toString('base64') } : {}),
  };
  return Buffer.from(JSON.stringify(sealed)).toString('base64');
}

function open(key: Buffer, blob: string, aad: string): Buffer {
  const s = JSON.parse(Buffer.from(blob, 'base64').toString('utf8')) as Sealed;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(s.iv, 'base64'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(s.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(s.ct, 'base64')), decipher.final()]);
}

export function encryptWithMasterKey(masterKeyB64: string, plaintext: string, aad: string): string {
  return seal(Buffer.from(masterKeyB64, 'base64'), Buffer.from(plaintext, 'utf8'), aad);
}

export function decryptWithMasterKey(masterKeyB64: string, blob: string, aad: string): string {
  return open(Buffer.from(masterKeyB64, 'base64'), blob, aad).toString('utf8');
}

export type SigningKeyMaterial = {
  publicKeyPem: string;
  fingerprint: string;
  encryptedPrivateKey: string;
};

export async function generateSigningKey(pin: string, masterKeyB64: string, userId: string): Promise<SigningKeyMaterial> {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const der = privateKey.export({ type: 'pkcs8', format: 'der' });
  const salt = randomBytes(16);
  const pinKey = await scryptAsync(pin, salt, 32, SCRYPT);
  const inner = seal(pinKey, der, `firma:${userId}`, salt);
  return {
    publicKeyPem,
    fingerprint: fingerprintOf(publicKeyPem),
    encryptedPrivateKey: encryptWithMasterKey(masterKeyB64, inner, `firma:${userId}`),
  };
}

export function fingerprintOf(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return sha256Hex(der);
}

export class InvalidPinError extends Error {}

export async function signWithPin(
  encryptedPrivateKey: string,
  pin: string,
  masterKeyB64: string,
  userId: string,
  messageHex: string,
): Promise<string> {
  const inner = decryptWithMasterKey(masterKeyB64, encryptedPrivateKey, `firma:${userId}`);
  const s = JSON.parse(Buffer.from(inner, 'base64').toString('utf8')) as Sealed;
  const pinKey = await scryptAsync(pin, Buffer.from(s.salt ?? '', 'base64'), 32, SCRYPT);
  let der: Buffer;
  try {
    der = open(pinKey, inner, `firma:${userId}`);
  } catch {
    throw new InvalidPinError('PIN de firma incorrecto');
  }
  const key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  return sign(null, Buffer.from(messageHex, 'hex'), key).toString('base64');
}

export function verifySignature(publicKeyPem: string, messageHex: string, signatureB64: string): boolean {
  return verify(null, Buffer.from(messageHex, 'hex'), publicKeyPem, Buffer.from(signatureB64, 'base64'));
}
