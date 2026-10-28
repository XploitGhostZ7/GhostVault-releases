// By Kompilador
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aObjetos, parseCsv } from '../src/catalogs/csv.js';
import { importarCatalogo, resolverColumnas, transformar } from '../src/catalogs/importer.js';
import { APP_URL, OWNER_URL } from './env.js';
import { PASSWORD, login, makeApp, nuevoTenant, ok, type Api } from './helpers.js';

const fixture = (n: string) => readFile(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

async function conOwner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: OWNER_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

describe('parser e importador', () => {
  it('lee CSV con BOM, punto y coma y comillas', async () => {
    const filas = parseCsv(await fixture('cie10.csv'));
    expect(filas[0]![0]).toBe('Codigo');
    expect(filas[1]).toEqual(['J03.9', 'Amigdalitis aguda, no especificada', 'SI', 'A', '0', '150']);
    expect(parseCsv('a,b\n"x ""y""",2\r\n')).toEqual([['a', 'b'], ['x "y"', '2']]);
  });

  it('resuelve encabezados por alias y exige los obligatorios', () => {
    expect(resolverColumnas('cie10', ['Código', 'Nombre', 'AplicaASexo'])).toMatchObject({ codigo: 'Código', descripcion: 'Nombre', sexo: 'AplicaASexo' });
    expect(() => resolverColumnas('cups', ['Code', 'Texto'])).toThrow(/--map codigo=/);
    expect(resolverColumnas('cups', ['Code', 'Texto'], { codigo: 'Code', descripcion: 'Texto' })).toEqual({ codigo: 'Code', descripcion: 'Texto' });
  });

  it('agrupa principios activos del CUM y compone la concentración', async () => {
    const { encabezados, registros } = aObjetos(parseCsv(await fixture('cum.csv')));
    const { filas } = transformar('cum', registros, resolverColumnas('cum', encabezados));
    const combo = filas.find((f: any) => f.codigo === '20000001-1');
    expect(combo.principios).toEqual(['ACETAMINOFÉN', 'CAFEÍNA']);
    expect(combo.concentraciones).toEqual(['500 mg', '65 mg']);
    expect(filas.find((f: any) => f.codigo === '19943231-2').vigente).toBe(false);
  });
});

describe('catálogos en la API', () => {
  let app: FastifyInstance;
  let medico: Api;
  let recepcion: Api;
  let medicoId: string;

  beforeAll(async () => {
    await conOwner(async (c) => {
      await expect(
        importarCatalogo(c, { tipo: 'cie10', contenido: await fixture('cie10.csv'), version: 'prueba', fuente: 'fixture' }),
      ).rejects.toThrow(/rechazadas/);
      const cie = await importarCatalogo(c, { tipo: 'cie10', contenido: await fixture('cie10.csv'), version: 'prueba', fuente: 'fixture', maxRechazos: 0.2 });
      expect(cie.registros).toBe(7);
      expect(cie.rechazados).toEqual([{ fila: 9, motivo: 'Código CIE-10 inválido: "XX"' }]);
      expect((await importarCatalogo(c, { tipo: 'cups', contenido: await fixture('cups.csv'), version: 'prueba', fuente: 'fixture' })).registros).toBe(4);
      expect((await importarCatalogo(c, { tipo: 'cum', contenido: await fixture('cum.csv'), version: 'prueba', fuente: 'fixture' })).registros).toBe(3);
    });

    app = await makeApp();
    const t = await nuevoTenant('cat');
    const admin = await login(app, t.slug, t.email);
    medicoId = ok(
      await admin.post('/users', {
        email: 'med@cat.co', nombre: 'Médico Catálogo', tipo_documento: 'CC', numero_documento: '777', roles: ['medico'], password: PASSWORD,
      }),
      201,
    ).id;
    ok(await admin.post('/users', { email: 'rec@cat.co', nombre: 'Recepción', tipo_documento: 'CC', numero_documento: '778', roles: ['recepcion'], password: PASSWORD }), 201);
    medico = await login(app, t.slug, 'med@cat.co');
    recepcion = await login(app, t.slug, 'rec@cat.co');
    ok(await medico.post('/users/me/signing-key', { password: PASSWORD, pin: '135790' }), 201);
  });

  afterAll(async () => {
    await app.close();
    await conOwner(async (c) => {
      await c.query('delete from cat_cie10; delete from cat_cups; delete from cat_cum; delete from cat_versiones');
    });
  });

  it('busca sin importar tildes, por código y con errores de digitación', async () => {
    const amig = ok<any[]>(await medico.get('/catalogos/cie10?q=amigdalitis'));
    expect(amig[0].codigo).toBe('J039');
    expect(ok<any[]>(await medico.get('/catalogos/cie10?q=hipertension'))[0].codigo).toBe('I10X');
    expect(ok<any[]>(await medico.get('/catalogos/cie10?q=I10'))[0].codigo).toBe('I10X');
    expect(ok<any[]>(await medico.get('/catalogos/cie10?q=j03.9'))[0].codigo).toBe('J039');
    expect(ok<any[]>(await medico.get('/catalogos/cie10?q=j0')).map((r) => r.codigo)).toEqual(['J029', 'J039']);
    expect(ok<any[]>(await medico.get('/catalogos/cie10?q=faringits'))[0].codigo).toBe('J029');
    expect(ok<any[]>(await medico.get('/catalogos/cie10?q=resfriado'))).toHaveLength(0);
    expect(ok<any[]>(await medico.get('/catalogos/cie10?q=resfriado&inactivos=true'))).toHaveLength(1);
    expect(ok<any[]>(await medico.get('/catalogos/cups?q=hemograma'))[0].codigo).toBe('902210');
    expect(ok<any[]>(await medico.get('/catalogos/cups?q=consulta medicina general primera')).map((r) => r.codigo)).toEqual(['890201']);

    const amox = ok<any[]>(await medico.get('/catalogos/cum?q=amoxicilina'));
    expect(amox.map((r) => r.codigo)).toEqual(['19943231-1']);
    expect(amox[0]).toMatchObject({ principio_activo: 'AMOXICILINA', concentracion: '500 mg', forma_farmaceutica: 'CAPSULA DURA', via: 'ORAL' });
    const combo = ok<any[]>(await medico.get('/catalogos/cum?q=cafeina'));
    expect(combo[0].principio_activo).toBe('ACETAMINOFÉN + CAFEÍNA');

    const estado = ok<any[]>(await medico.get('/catalogos/estado'));
    expect(estado.map((e) => [e.catalogo, e.registros])).toEqual([['cie10', 7], ['cum', 3], ['cups', 4]]);
  });

  it('el rol de la aplicación no puede modificar catálogos', async () => {
    const c = new pg.Client({ connectionString: APP_URL });
    await c.connect();
    await expect(c.query("insert into cat_cups (codigo, descripcion, busqueda) values ('999999','x','x')")).rejects.toThrow(/permission denied/);
    await expect(c.query('delete from cat_cie10')).rejects.toThrow(/permission denied/);
    await c.end();
  });

  it('valida CUPS, CIE-10 (incluido sexo) y CUM contra los catálogos cargados', async () => {
    const p = ok(
      await recepcion.post('/patients', {
        tipo_documento: 'CC', numero_documento: '80555666', primer_nombre: 'Pedro', primer_apellido: 'Ruiz',
        fecha_nacimiento: '1970-02-02', sexo: 'H', consentimiento_datos: true,
      }),
      201,
    );
    const base = { patient_id: p.id, professional_id: medicoId, cod_servicio: '328', valor_servicio: 50000 };
    const malo = await recepcion.post('/admissions', { ...base, cod_consulta: '999999' });
    expect(malo.status).toBe(400);
    expect(malo.body.detalle).toEqual(['999999: no existe en el catálogo CUPS']);
    const adm = ok(await recepcion.post('/admissions', { ...base, cod_consulta: '890201' }), 201);

    const e = ok(await medico.post('/encounters', { admission_id: adm.id, plantilla: 'medicina_general' }), 201);
    const dxMalo = await medico.patch(`/encounters/${e.id}`, { diagnostico_principal: 'I10' });
    expect(dxMalo.status).toBe(400);
    expect(dxMalo.body.detalle).toEqual(['I10: no existe en el catálogo CIE-10']);

    ok(
      await medico.patch(`/encounters/${e.id}`, {
        contenido: {
          motivo: { motivo_consulta: 'Control', enfermedad_actual: 'Sin cambios' },
          antecedentes: { alergias: 'Niega' },
          examen_fisico: { estado_general: 'Bueno', hallazgos: 'Normal' },
          analisis_plan: { analisis: 'Estable', plan: 'Continuar' },
        },
        diagnostico_principal: 'O800',
        diagnosticos_relacionados: ['I10X'],
        tipo_diagnostico_principal: '02',
        finalidad: '15',
        causa_externa: '38',
      }),
    );
    const firma = await medico.post(`/encounters/${e.id}/sign`, { pin: '135790' });
    expect(firma.status).toBe(400);
    expect(firma.body.detalle).toEqual(['O800: aplica solo a mujeres']);

    ok(await medico.patch(`/encounters/${e.id}`, { diagnostico_principal: 'N40X' }));
    ok(await medico.post(`/encounters/${e.id}/sign`, { pin: '135790' }));

    const med = { nombre: 'Amoxicilina', concentracion: '500 mg', forma_farmaceutica: 'Cápsula', via: 'Oral', dosis: '1', frecuencia: '8 horas', duracion_dias: 7, cantidad: 21 };
    const inactivo = await medico.post(`/encounters/${e.id}/orders`, { tipo: 'formula', items: [{ ...med, cum: '19943231-2' }] });
    expect(inactivo.body.detalle).toEqual(['19943231-2: registro CUM no vigente']);
    ok(await medico.post(`/encounters/${e.id}/orders`, { tipo: 'formula', items: [{ ...med, cum: '19943231-1' }, { ...med, nombre: 'Sin CUM' }] }), 201);

    const citologia = await medico.post(`/encounters/${e.id}/orders`, { tipo: 'laboratorio', items: [{ cups: '892901', descripcion: 'Citología' }] });
    expect(citologia.body.detalle).toEqual(['892901: aplica solo a mujeres']);
    ok(await medico.post(`/encounters/${e.id}/orders`, { tipo: 'laboratorio', items: [{ cups: '902210', descripcion: 'Hemograma IV' }] }), 201);
  });
});
