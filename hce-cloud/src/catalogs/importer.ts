// By Kompilador
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { aObjetos, parseCsv } from './csv.js';
import { aBooleano, aEdad, aSexo, normalizarCie10, normalizarCups, normalizarEncabezado, normalizarTexto } from './normalizar.js';

export type TipoCatalogo = 'cie10' | 'cups' | 'cum';

// Alias de encabezados por campo, en orden de preferencia. Cubren los nombres usados en las
// tablas de referencia de SISPRO y en el conjunto CUM de INVIMA publicado en datos.gov.co.
// Cualquier formato distinto se resuelve con un mapeo explícito (--map campo=Columna).
const ALIAS: Record<TipoCatalogo, Record<string, string[]>> = {
  cie10: {
    codigo: ['codigo', 'codigocie10', 'cie10', 'codigodiagnostico', 'cod'],
    descripcion: ['nombre', 'descripcion', 'nombrediagnostico', 'descripciondiagnostico'],
    sexo: ['sexo', 'aplicaasexo', 'aplicasexo'],
    edad_min: ['edadminima', 'edadmin', 'limiteinferior'],
    edad_max: ['edadmaxima', 'edadmax', 'limitesuperior'],
    habilitado: ['habilitado', 'estado', 'activo', 'vigente'],
  },
  cups: {
    codigo: ['codigo', 'codigocups', 'cups', 'cod'],
    descripcion: ['nombre', 'descripcion', 'descripcioncups', 'nombreprocedimiento'],
    sexo: ['sexo', 'aplicaasexo', 'aplicasexo'],
    habilitado: ['habilitado', 'estado', 'activo', 'vigente'],
  },
  cum: {
    codigo: ['cum', 'codigocum'],
    expediente: ['expediente', 'expedientecum'],
    consecutivo: ['consecutivocum', 'consecutivo'],
    producto: ['producto', 'nombreproducto'],
    descripcion_comercial: ['descripcioncomercial'],
    principio_activo: ['principioactivo', 'principio'],
    cantidad: ['cantidad'],
    unidad_medida: ['unidadmedida'],
    concentracion: ['concentracion'],
    forma_farmaceutica: ['formafarmaceutica'],
    via: ['viaadministracion', 'via'],
    atc: ['atc'],
    registro_sanitario: ['registrosanitario'],
    titular: ['titular'],
    estado: ['estadocum', 'estadoregistro', 'estado'],
  },
};

const REQUERIDOS: Record<TipoCatalogo, string[][]> = {
  cie10: [['codigo'], ['descripcion']],
  cups: [['codigo'], ['descripcion']],
  cum: [['codigo', 'expediente'], ['producto', 'principio_activo']],
};

export type Rechazo = { fila: number; motivo: string };

export type ResultadoImportacion = {
  tipo: TipoCatalogo;
  registros: number;
  rechazados: Rechazo[];
  columnas: Record<string, string>;
};

export function resolverColumnas(
  tipo: TipoCatalogo,
  encabezados: string[],
  mapeo: Record<string, string> = {},
): Record<string, string> {
  const porNormal = new Map(encabezados.map((h) => [normalizarEncabezado(h), h]));
  const out: Record<string, string> = {};
  for (const [campo, alias] of Object.entries(ALIAS[tipo])) {
    if (mapeo[campo]) {
      const col = encabezados.find((h) => h === mapeo[campo]) ?? porNormal.get(normalizarEncabezado(mapeo[campo]));
      if (!col) throw new Error(`La columna "${mapeo[campo]}" indicada para ${campo} no existe`);
      out[campo] = col;
      continue;
    }
    const col = alias.map((a) => porNormal.get(a)).find(Boolean);
    if (col) out[campo] = col;
  }
  for (const opciones of REQUERIDOS[tipo]) {
    if (!opciones.some((c) => out[c])) {
      throw new Error(
        `No se encontró columna para ${opciones.join(' o ')}. Encabezados: ${encabezados.join(', ')}. Use --map ${opciones[0]}=<columna>`,
      );
    }
  }
  return out;
}

type FilaCie = { codigo: string; descripcion: string; sexo: string | null; edad_min: number | null; edad_max: number | null; habilitado: boolean };
type FilaCups = { codigo: string; descripcion: string; sexo: string | null; habilitado: boolean };
type FilaCum = {
  codigo: string;
  producto: string;
  descripcion_comercial: string | null;
  principios: string[];
  concentraciones: string[];
  forma_farmaceutica: string | null;
  via: string | null;
  atc: string | null;
  registro_sanitario: string | null;
  titular: string | null;
  vigente: boolean;
};

const val = (r: Record<string, string>, col?: string) => (col ? (r[col] ?? '').trim() : '');
const nulo = (s: string) => (s === '' ? null : s);

export function transformar(tipo: TipoCatalogo, registros: Record<string, string>[], cols: Record<string, string>) {
  const rechazados: Rechazo[] = [];
  const filas = new Map<string, any>();
  registros.forEach((r, i) => {
    const fila = i + 2;
    if (tipo === 'cie10') {
      const codigo = normalizarCie10(val(r, cols.codigo));
      const descripcion = val(r, cols.descripcion);
      if (!/^[A-Z][0-9]{2}[0-9X]?$/.test(codigo)) return rechazados.push({ fila, motivo: `Código CIE-10 inválido: "${codigo}"` });
      if (!descripcion) return rechazados.push({ fila, motivo: 'Sin descripción' });
      const em = aEdad(val(r, cols.edad_min));
      const eM = aEdad(val(r, cols.edad_max));
      filas.set(codigo, {
        codigo,
        descripcion,
        sexo: aSexo(val(r, cols.sexo)),
        edad_min: em,
        edad_max: em !== null && eM !== null && eM < em ? null : eM,
        habilitado: aBooleano(val(r, cols.habilitado), true),
      } satisfies FilaCie);
    } else if (tipo === 'cups') {
      const codigo = normalizarCups(val(r, cols.codigo));
      const descripcion = val(r, cols.descripcion);
      if (!/^[0-9A-Z]{6}$/.test(codigo)) return rechazados.push({ fila, motivo: `Código CUPS inválido: "${codigo}"` });
      if (!descripcion) return rechazados.push({ fila, motivo: 'Sin descripción' });
      filas.set(codigo, { codigo, descripcion, sexo: aSexo(val(r, cols.sexo)), habilitado: aBooleano(val(r, cols.habilitado), true) } satisfies FilaCups);
    } else {
      let codigo = val(r, cols.codigo).replace(/\s/g, '');
      if (!codigo && cols.expediente) {
        const exp = val(r, cols.expediente).replace(/\D/g, '');
        const cons = val(r, cols.consecutivo).replace(/\D/g, '');
        codigo = exp && cons ? `${Number(exp)}-${Number(cons)}` : '';
      }
      if (!/^[0-9]{1,12}-[0-9]{1,3}$/.test(codigo)) return rechazados.push({ fila, motivo: `Código CUM inválido: "${codigo}"` });
      const producto = val(r, cols.producto);
      const principio = val(r, cols.principio_activo);
      if (!producto && !principio) return rechazados.push({ fila, motivo: 'Sin producto ni principio activo' });
      const cantidad = val(r, cols.cantidad);
      const unidad = val(r, cols.unidad_medida);
      const concentracion = cantidad && unidad ? `${cantidad} ${unidad}` : val(r, cols.concentracion);
      const previo = filas.get(codigo) as FilaCum | undefined;
      if (previo) {
        if (principio && !previo.principios.includes(principio)) {
          previo.principios.push(principio);
          previo.concentraciones.push(concentracion);
        }
        return;
      }
      filas.set(codigo, {
        codigo,
        producto: producto || principio,
        descripcion_comercial: nulo(val(r, cols.descripcion_comercial)),
        principios: principio ? [principio] : [],
        concentraciones: principio ? [concentracion] : [],
        forma_farmaceutica: nulo(val(r, cols.forma_farmaceutica)),
        via: nulo(val(r, cols.via)),
        atc: nulo(val(r, cols.atc)),
        registro_sanitario: nulo(val(r, cols.registro_sanitario)),
        titular: nulo(val(r, cols.titular)),
        vigente: aBooleano(val(r, cols.estado), true),
      } satisfies FilaCum);
    }
  });
  return { filas: [...filas.values()], rechazados };
}

const LOTE = 1000;

async function insertarLotes(db: pg.ClientBase, tabla: string, columnas: string[], filas: unknown[][]) {
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    const params: unknown[] = [];
    const values = lote.map((f) => `(${f.map((v) => `$${params.push(v)}`).join(',')})`);
    await db.query(`insert into ${tabla} (${columnas.join(',')}) values ${values.join(',')}`, params);
  }
}

export async function importarCatalogo(
  db: pg.ClientBase,
  opts: {
    tipo: TipoCatalogo;
    contenido: string;
    version: string;
    fuente: string;
    mapeo?: Record<string, string>;
    maxRechazos?: number;
  },
): Promise<ResultadoImportacion> {
  const { encabezados, registros } = aObjetos(parseCsv(opts.contenido));
  if (registros.length === 0) throw new Error('El archivo no tiene registros');
  const cols = resolverColumnas(opts.tipo, encabezados, opts.mapeo);
  const { filas, rechazados } = transformar(opts.tipo, registros, cols);
  const limite = opts.maxRechazos ?? 0.01;
  if (filas.length === 0) throw new Error('Ningún registro válido');
  if (rechazados.length / registros.length > limite) {
    throw new Error(
      `${rechazados.length} de ${registros.length} filas rechazadas (límite ${(limite * 100).toFixed(1)} %). Primeras: ` +
        rechazados.slice(0, 5).map((r) => `fila ${r.fila}: ${r.motivo}`).join('; '),
    );
  }

  await db.query('begin');
  try {
    if (opts.tipo === 'cie10') {
      await db.query('delete from cat_cie10');
      await insertarLotes(
        db,
        'cat_cie10',
        ['codigo', 'descripcion', 'sexo', 'edad_min', 'edad_max', 'habilitado', 'busqueda'],
        (filas as FilaCie[]).map((f) => [f.codigo, f.descripcion, f.sexo, f.edad_min, f.edad_max, f.habilitado, normalizarTexto(`${f.codigo} ${f.descripcion}`)]),
      );
    } else if (opts.tipo === 'cups') {
      await db.query('delete from cat_cups');
      await insertarLotes(
        db,
        'cat_cups',
        ['codigo', 'descripcion', 'sexo', 'habilitado', 'busqueda'],
        (filas as FilaCups[]).map((f) => [f.codigo, f.descripcion, f.sexo, f.habilitado, normalizarTexto(`${f.codigo} ${f.descripcion}`)]),
      );
    } else {
      await db.query('delete from cat_cum');
      await insertarLotes(
        db,
        'cat_cum',
        ['codigo', 'producto', 'descripcion_comercial', 'principio_activo', 'concentracion', 'forma_farmaceutica', 'via', 'atc', 'registro_sanitario', 'titular', 'vigente', 'busqueda'],
        (filas as FilaCum[]).map((f) => {
          const principio = f.principios.join(' + ') || f.producto;
          const concentracion = f.concentraciones.filter(Boolean).join(' + ') || null;
          return [
            f.codigo,
            f.producto,
            f.descripcion_comercial,
            principio,
            concentracion,
            f.forma_farmaceutica,
            f.via,
            f.atc,
            f.registro_sanitario,
            f.titular,
            f.vigente,
            normalizarTexto(`${principio} ${f.producto} ${f.descripcion_comercial ?? ''} ${f.codigo}`),
          ];
        }),
      );
    }
    await db.query(
      `insert into cat_versiones (catalogo, version, fuente, registros, sha256)
       values ($1,$2,$3,$4,$5)
       on conflict (catalogo) do update set version = excluded.version, fuente = excluded.fuente,
         registros = excluded.registros, sha256 = excluded.sha256, cargado_at = now()`,
      [opts.tipo, opts.version, opts.fuente, filas.length, createHash('sha256').update(opts.contenido).digest('hex')],
    );
    await db.query('commit');
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
  return { tipo: opts.tipo, registros: filas.length, rechazados, columnas: cols };
}
