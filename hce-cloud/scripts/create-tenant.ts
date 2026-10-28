// By Kompilador
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { hashPassword } from '../src/lib/crypto.js';

export type NuevoTenant = {
  slug: string;
  razonSocial: string;
  nit: string;
  dv?: string;
  codigoPrestador: string;
  municipio?: string;
  admin: { email: string; nombre: string; tipoDocumento: string; numeroDocumento: string; password: string };
};

export async function createTenant(connectionString: string, t: NuevoTenant): Promise<{ tenantId: string; adminId: string }> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const tenantId = randomUUID();
  try {
    await client.query('begin');
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query(
      `insert into tenants (id, slug, razon_social, nit, dv, codigo_prestador, municipio)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [tenantId, t.slug, t.razonSocial, t.nit, t.dv ?? null, t.codigoPrestador, t.municipio ?? null],
    );
    const admin = await client.query(
      `insert into users (email, nombre, tipo_documento, numero_documento, roles, password_hash)
       values ($1,$2,$3,$4,array['admin'],$5) returning id`,
      [t.admin.email.toLowerCase(), t.admin.nombre, t.admin.tipoDocumento, t.admin.numeroDocumento, await hashPassword(t.admin.password)],
    );
    await client.query("select audit_append(null, 'cli', 'crear', 'tenant', $1, null, '{}'::jsonb)", [tenantId]);
    await client.query('commit');
    return { tenantId, adminId: admin.rows[0].id };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values: v } = parseArgs({
    options: {
      slug: { type: 'string' },
      razon: { type: 'string' },
      nit: { type: 'string' },
      dv: { type: 'string' },
      prestador: { type: 'string' },
      municipio: { type: 'string' },
      'admin-email': { type: 'string' },
      'admin-nombre': { type: 'string' },
      'admin-cc': { type: 'string' },
    },
  });
  const password = process.env.ADMIN_PASSWORD;
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url || !password || !v.slug || !v.razon || !v.nit || !v.prestador || !v['admin-email'] || !v['admin-nombre'] || !v['admin-cc']) {
    console.error(
      'Uso: MIGRATION_DATABASE_URL=... ADMIN_PASSWORD=... npm run tenant -- --slug x --razon "IPS" --nit 900123456 --dv 7 ' +
        '--prestador 110010000001 --admin-email a@b.co --admin-nombre "Nombre" --admin-cc 1010',
    );
    process.exit(1);
  }
  const r = await createTenant(url, {
    slug: v.slug,
    razonSocial: v.razon,
    nit: v.nit,
    dv: v.dv,
    codigoPrestador: v.prestador,
    municipio: v.municipio,
    admin: { email: v['admin-email'], nombre: v['admin-nombre'], tipoDocumento: 'CC', numeroDocumento: v['admin-cc'], password },
  });
  console.log(`Tenant creado: ${r.tenantId} · admin ${r.adminId}`);
}
