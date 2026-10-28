// By Kompilador
'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Vacio } from './ui';
import { api, mensajeError, nombrePaciente } from '@/lib/api';

export function BuscarPaciente({ onElegir, accion = 'Seleccionar' }: { onElegir: (p: any) => void; accion?: string }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any[] | null>(null);
  const [error, setError] = useState('');

  async function buscar(ev: FormEvent) {
    ev.preventDefault();
    setError('');
    try {
      setRes(await api.get(`/patients?q=${encodeURIComponent(q.trim())}`));
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  return (
    <div className="stack">
      <form onSubmit={buscar} className="row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Documento o nombre" minLength={2} required style={{ flex: 1 }} aria-label="Buscar paciente" />
        <button className="btn">Buscar</button>
      </form>
      <Alert>{error}</Alert>
      {res && res.length === 0 && <Vacio>Sin resultados.</Vacio>}
      {res && res.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Documento</th>
                <th>Nombre</th>
                <th>Nacimiento</th>
                <th>EPS</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {res.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.tipo_documento} {p.numero_documento}
                  </td>
                  <td>{nombrePaciente(p)}</td>
                  <td>{p.fecha_nacimiento}</td>
                  <td>{p.eps_nombre ?? '—'}</td>
                  <td className="acciones">
                    <button type="button" className="btn btn-sm" onClick={() => onElegir(p)}>
                      {accion}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
