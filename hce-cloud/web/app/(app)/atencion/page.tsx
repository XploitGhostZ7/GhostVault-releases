// By Kompilador
'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useMe } from '@/components/session';
import { Alert, Encabezado, Estado, Field, Vacio } from '@/components/ui';
import { api, hora, hoyBogota, mensajeError } from '@/lib/api';

export default function BandejaPage() {
  const me = useMe();
  const router = useRouter();
  const [fecha, setFecha] = useState(hoyBogota());
  const [lista, setLista] = useState<any[]>([]);
  const [plantillas, setPlantillas] = useState<any[]>([]);
  const [elegida, setElegida] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    try {
      setLista(await api.get(`/admissions?fecha=${fecha}&professional_id=${me.id}`));
    } catch (e) {
      setError(mensajeError(e));
    }
  }, [fecha, me.id]);

  useEffect(() => {
    cargar();
    api.get('/templates').then(setPlantillas).catch(() => undefined);
  }, [cargar]);

  async function iniciar(a: any) {
    setError('');
    try {
      const e = await api.post('/encounters', { admission_id: a.id, plantilla: elegida[a.id] ?? sugerida(a) });
      router.push(`/atencion/${e.id}`);
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  function sugerida(a: any): string {
    return plantillas.find((p) => p.cupsSugerido === a.cod_consulta)?.code ?? 'medicina_general';
  }

  const activas = lista.filter((a) => a.estado !== 'anulada');

  return (
    <>
      <Encabezado titulo="Atención" sub="Pacientes admitidos a su nombre">
        <Field label="Fecha">
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Field>
      </Encabezado>
      {!me.tiene_firma && <Alert tipo="warn">Aún no tiene llave de firma. Regístrela en Mi cuenta para poder firmar historias.</Alert>}
      <Alert>{error}</Alert>
      <section className="card">
        {activas.length === 0 ? (
          <Vacio>No hay pacientes admitidos para esta fecha.</Vacio>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ingreso</th>
                  <th>Paciente</th>
                  <th>Consulta</th>
                  <th>Historia</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {activas.map((a) => (
                  <tr key={a.id}>
                    <td>{hora(a.fecha_ingreso)}</td>
                    <td>
                      {a.paciente}
                      <div className="muted">
                        {a.tipo_documento} {a.numero_documento}
                      </div>
                    </td>
                    <td>CUPS {a.cod_consulta}</td>
                    <td>{a.encounter_id ? <Estado valor={a.encounter_estado} /> : <span className="muted">Pendiente</span>}</td>
                    <td className="acciones">
                      {a.encounter_id ? (
                        <button className="btn btn-sm btn-primary" onClick={() => router.push(`/atencion/${a.encounter_id}`)}>
                          {a.encounter_estado === 'firmado' ? 'Ver' : 'Continuar'}
                        </button>
                      ) : (
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          <select
                            aria-label="Plantilla"
                            value={elegida[a.id] ?? sugerida(a)}
                            onChange={(e) => setElegida({ ...elegida, [a.id]: e.target.value })}
                            style={{ width: 'auto' }}
                          >
                            {plantillas.map((p) => (
                              <option key={p.code} value={p.code}>
                                {p.nombre}
                              </option>
                            ))}
                          </select>
                          <button className="btn btn-sm btn-primary" onClick={() => iniciar(a)}>
                            Iniciar atención
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
