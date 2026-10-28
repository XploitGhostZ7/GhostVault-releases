// By Kompilador
import { many, one, type Db } from '../db.js';
import { normalizarCie10, normalizarCups, normalizarTexto } from './normalizar.js';
import type { TipoCatalogo } from './importer.js';

const TABLA: Record<TipoCatalogo, string> = { cie10: 'cat_cie10', cups: 'cat_cups', cum: 'cat_cum' };

const COLUMNAS: Record<TipoCatalogo, string> = {
  cie10: 'codigo, descripcion, sexo, edad_min, edad_max, habilitado',
  cups: 'codigo, descripcion, sexo, habilitado',
  cum: 'codigo, producto, descripcion_comercial, principio_activo, concentracion, forma_farmaceutica, via, atc, registro_sanitario, titular, vigente',
};

const ACTIVO: Record<TipoCatalogo, string> = { cie10: 'habilitado', cups: 'habilitado', cum: 'vigente' };

function patronesTokens(q: string): string[] {
  return q
    .split(' ')
    .filter((t) => t.length > 0)
    .slice(0, 6)
    .map((t) => `%${t.replace(/[%_\\]/g, '\\$&')}%`);
}

export async function buscarCatalogo(db: Db, tipo: TipoCatalogo, q: string, limit = 20, incluirInactivos = false) {
  const texto = normalizarTexto(q);
  if (!texto) return [];
  const codigo = tipo === 'cie10' ? normalizarCie10(q) : tipo === 'cups' ? normalizarCups(q) : q.trim();
  return many(
    db,
    `select ${COLUMNAS[tipo]}
       from ${TABLA[tipo]}
      where ($4 or ${ACTIVO[tipo]})
        and (codigo like $1 || '%' or busqueda like all ($3::text[]) or $2 <% busqueda)
      order by (codigo = $1) desc, (codigo like $1 || '%') desc, (busqueda like all ($3::text[])) desc,
               word_similarity($2, busqueda) desc, codigo
      limit $5`,
    [codigo.replace(/[%_\\]/g, '\\$&'), texto, patronesTokens(texto), incluirInactivos, limit],
  );
}

export async function obtenerCodigo(db: Db, tipo: TipoCatalogo, codigo: string) {
  return one(db, `select ${COLUMNAS[tipo]} from ${TABLA[tipo]} where codigo = $1`, [codigo]);
}

export async function catalogoCargado(db: Db, tipo: TipoCatalogo): Promise<boolean> {
  const r = await one<{ e: boolean }>(db, `select exists (select 1 from ${TABLA[tipo]}) as e`);
  return !!r?.e;
}

export async function estadoCatalogos(db: Db) {
  return many(db, 'select catalogo, version, fuente, registros, sha256, cargado_at from cat_versiones order by catalogo');
}

function edadEnAnos(fechaNacimiento: string, ref: Date): number {
  const [a, m, d] = fechaNacimiento.split('-').map(Number) as [number, number, number];
  let edad = ref.getUTCFullYear() - a;
  if (ref.getUTCMonth() + 1 < m || (ref.getUTCMonth() + 1 === m && ref.getUTCDate() < d)) edad--;
  return edad;
}

export type Paciente = { sexo: string; fecha_nacimiento: string };

export async function validarCie10(db: Db, codigos: string[], paciente?: Paciente, ref = new Date()): Promise<string[]> {
  const unicos = [...new Set(codigos.filter(Boolean))];
  if (unicos.length === 0 || !(await catalogoCargado(db, 'cie10'))) return [];
  const filas = await many(db, 'select codigo, descripcion, sexo, edad_min, edad_max, habilitado from cat_cie10 where codigo = any($1)', [unicos]);
  const porCodigo = new Map(filas.map((f) => [f.codigo, f]));
  const errores: string[] = [];
  for (const c of unicos) {
    const f = porCodigo.get(c);
    if (!f) {
      errores.push(`${c}: no existe en el catálogo CIE-10`);
      continue;
    }
    if (!f.habilitado) errores.push(`${c}: código no habilitado`);
    if (paciente) {
      if (f.sexo && paciente.sexo !== 'I' && f.sexo !== paciente.sexo) {
        errores.push(`${c}: aplica solo a ${f.sexo === 'H' ? 'hombres' : 'mujeres'}`);
      }
      const edad = edadEnAnos(paciente.fecha_nacimiento, ref);
      if (f.edad_min !== null && edad < f.edad_min) errores.push(`${c}: edad mínima ${f.edad_min} años (paciente ${edad})`);
      if (f.edad_max !== null && edad > f.edad_max) errores.push(`${c}: edad máxima ${f.edad_max} años (paciente ${edad})`);
    }
  }
  return errores;
}

export async function validarCups(db: Db, codigos: string[], paciente?: Paciente): Promise<string[]> {
  const unicos = [...new Set(codigos.filter(Boolean))];
  if (unicos.length === 0 || !(await catalogoCargado(db, 'cups'))) return [];
  const filas = await many(db, 'select codigo, sexo, habilitado from cat_cups where codigo = any($1)', [unicos]);
  const porCodigo = new Map(filas.map((f) => [f.codigo, f]));
  const errores: string[] = [];
  for (const c of unicos) {
    const f = porCodigo.get(c);
    if (!f) errores.push(`${c}: no existe en el catálogo CUPS`);
    else if (!f.habilitado) errores.push(`${c}: código CUPS no habilitado`);
    else if (paciente && f.sexo && paciente.sexo !== 'I' && f.sexo !== paciente.sexo) {
      errores.push(`${c}: aplica solo a ${f.sexo === 'H' ? 'hombres' : 'mujeres'}`);
    }
  }
  return errores;
}

export async function validarCum(db: Db, codigos: string[]): Promise<string[]> {
  const unicos = [...new Set(codigos.filter(Boolean))];
  if (unicos.length === 0 || !(await catalogoCargado(db, 'cum'))) return [];
  const filas = await many(db, 'select codigo, vigente from cat_cum where codigo = any($1)', [unicos]);
  const porCodigo = new Map(filas.map((f) => [f.codigo, f]));
  return unicos.flatMap((c) => {
    const f = porCodigo.get(c);
    if (!f) return [`${c}: no existe en el catálogo CUM`];
    if (!f.vigente) return [`${c}: registro CUM no vigente`];
    return [];
  });
}
