// By Kompilador
'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alert, Badge, Encabezado, Field, Vacio } from '@/components/ui';
import { api, fechaHora, mensajeError } from '@/lib/api';

const ENTIDADES = ['', 'paciente', 'historia_clinica', 'orden', 'cita', 'admision', 'factura', 'usuario', 'auditoria', 'horario'];

export default function AuditoriaPage() {
  const [filtros, setFiltros] = useState({ paciente_id: '', entidad: '', desde: '', hasta: '' });
  const [rows, setRows] = useState<any[]>([]);
  const [hayMas, setHayMas] = useState(false);
  const [cadena, setCadena] = useState<any>(null);
  const [error, setError] = useState('');

  const consulta = useCallback(
    (antes?: number) => {
      const p = new URLSearchParams({ limit: '100' });
      if (filtros.paciente_id) p.set('paciente_id', filtros.paciente_id.trim());
      if (filtros.entidad) p.set('entidad', filtros.entidad);
      if (filtros.desde) p.set('desde', new Date(`${filtros.desde}T00:00:00-05:00`).toISOString());
      if (filtros.hasta) p.set('hasta', new Date(`${filtros.hasta}T23:59:59-05:00`).toISOString());
      if (antes) p.set('antes_de', String(antes));
      return api.get<any[]>(`/audit?${p}`);
    },
    [filtros],
  );

  const buscar = useCallback(async () => {
    setError('');
    try {
      const r = await consulta();
      setRows(r);
      setHayMas(r.length === 100);
    } catch (e) {
      setError(mensajeError(e));
    }
  }, [consulta]);

  useEffect(() => {
    buscar();
  }, []);

  async function mas() {
    const ultimo = rows[rows.length - 1];
    if (!ultimo) return;
    try {
      const r = await consulta(Number(ultimo.seq));
      setRows([...rows, ...r]);
      setHayMas(r.length === 100);
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  async function verificar() {
    setError('');
    try {
      setCadena(await api.get('/audit/verify'));
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  function enviar(ev: FormEvent) {
    ev.preventDefault();
    buscar();
  }

  const set = (k: keyof typeof filtros) => (e: { target: { value: string } }) => setFiltros({ ...filtros, [k]: e.target.value });

  return (
    <>
      <Encabezado titulo="Auditoría" sub="Registro inmutable encadenado por SHA-256 de accesos y cambios">
        <button className="btn btn-primary" onClick={verificar}>
          Verificar integridad
        </button>
      </Encabezado>
      <Alert>{error}</Alert>
      {cadena && (
        <Alert tipo={cadena.valido ? 'ok' : 'error'}>
          {cadena.valido
            ? `Cadena íntegra: ${cadena.registros} registros verificados.`
            : `Cadena alterada: el primer registro inconsistente es el N.º ${cadena.primer_error}.`}
          <div className="mono">Hash cabeza: {cadena.hash_cabeza}</div>
        </Alert>
      )}
      <section className="card">
        <form onSubmit={enviar} className="row" style={{ marginBottom: '1rem' }}>
          <Field label="ID del paciente">
            <input value={filtros.paciente_id} onChange={set('paciente_id')} placeholder="UUID" style={{ minWidth: 300 }} />
          </Field>
          <Field label="Entidad">
            <select value={filtros.entidad} onChange={set('entidad')}>
              {ENTIDADES.map((e) => (
                <option key={e} value={e}>
                  {e ? e.replace('_', ' ') : 'Todas'}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Desde">
            <input type="date" value={filtros.desde} onChange={set('desde')} />
          </Field>
          <Field label="Hasta">
            <input type="date" value={filtros.hasta} onChange={set('hasta')} />
          </Field>
          <button className="btn">Filtrar</button>
        </form>
        {rows.length === 0 ? (
          <Vacio>Sin registros.</Vacio>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>N.º</th>
                  <th>Fecha</th>
                  <th>Usuario</th>
                  <th>Acción</th>
                  <th>Entidad</th>
                  <th>Paciente</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.seq}>
                    <td>{r.seq}</td>
                    <td>{fechaHora(r.at)}</td>
                    <td>{r.actor ?? <span className="muted">sistema</span>}</td>
                    <td>
                      <Badge tono={r.accion.includes('fallido') || r.accion.includes('bloqueado') ? 'error' : r.accion === 'firmar' ? 'ok' : 'neutro'}>
                        {r.accion.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td>{r.entidad.replace('_', ' ')}</td>
                    <td className="mono">{r.paciente_id ? r.paciente_id.slice(0, 8) : '—'}</td>
                    <td className="mono">{r.actor_ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {hayMas && (
          <div className="row" style={{ justifyContent: 'center', marginTop: '0.75rem' }}>
            <button className="btn" onClick={mas}>
              Cargar más
            </button>
          </div>
        )}
      </section>
    </>
  );
}
