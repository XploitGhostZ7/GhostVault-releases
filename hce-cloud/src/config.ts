// By Kompilador
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  APP_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'APP_ENCRYPTION_KEY debe ser 32 bytes en base64'),
  MFA_REQUIRED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  CORS_ORIGINS: z.string().default(''),
  FEV_PROVIDER: z.enum(['sandbox']).default('sandbox'),
  RIPS_VALIDATOR: z.enum(['sandbox']).default('sandbox'),
  ACCESS_TOKEN_TTL: z.string().default('30m'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const detalle = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuración inválida: ${detalle}`);
  }
  return parsed.data;
}
