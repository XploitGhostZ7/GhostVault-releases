// By Kompilador
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export async function migrate(connectionString: string, log = console.log): Promise<void> {
  const dir = process.env.MIGRATIONS_DIR ?? join(process.cwd(), 'db', 'migrations');
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`create table if not exists schema_migrations (
      nombre text primary key, aplicada_at timestamptz not null default now())`);
    await client.query('revoke all on schema_migrations from public');
    const aplicadas = new Set((await client.query('select nombre from schema_migrations')).rows.map((r) => r.nombre));
    const archivos = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const f of archivos) {
      if (aplicadas.has(f)) continue;
      const sql = await readFile(join(dir, f), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (nombre) values ($1)', [f]);
        await client.query('commit');
        log(`Migración aplicada: ${f}`);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Falló ${f}: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    console.error('Defina MIGRATION_DATABASE_URL');
    process.exit(1);
  }
  await migrate(url);
}
