// By Kompilador
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { importarCatalogo, type TipoCatalogo } from '../src/catalogs/importer.js';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values: v } = parseArgs({
    options: {
      tipo: { type: 'string' },
      archivo: { type: 'string' },
      version: { type: 'string' },
      fuente: { type: 'string' },
      encoding: { type: 'string', default: 'utf8' },
      map: { type: 'string', multiple: true },
      'max-rechazos': { type: 'string', default: '0.01' },
    },
  });
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url || !v.tipo || !['cie10', 'cups', 'cum'].includes(v.tipo) || !v.archivo || !v.version) {
    console.error(
      'Uso: MIGRATION_DATABASE_URL=... npm run catalogo -- --tipo cie10|cups|cum --archivo ruta.csv --version "2026" ' +
        '[--fuente "SISPRO"] [--encoding latin1] [--map codigo=Codigo] [--max-rechazos 0.01]',
    );
    process.exit(1);
  }
  const buffer = await readFile(v.archivo);
  const contenido = new TextDecoder(v.encoding === 'latin1' ? 'latin1' : 'utf-8').decode(buffer);
  const mapeo = Object.fromEntries((v.map ?? []).map((m) => m.split('=', 2) as [string, string]));
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const r = await importarCatalogo(client, {
      tipo: v.tipo as TipoCatalogo,
      contenido,
      version: v.version,
      fuente: v.fuente ?? basename(v.archivo),
      mapeo,
      maxRechazos: Number(v['max-rechazos']),
    });
    console.log(`Catálogo ${r.tipo}: ${r.registros} registros cargados.`);
    console.log(`Columnas usadas: ${Object.entries(r.columnas).map(([c, h]) => `${c}←"${h}"`).join(', ')}`);
    if (r.rechazados.length) {
      console.log(`${r.rechazados.length} filas rechazadas:`);
      for (const x of r.rechazados.slice(0, 20)) console.log(`  fila ${x.fila}: ${x.motivo}`);
    }
  } catch (e) {
    console.error(`Importación fallida: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
