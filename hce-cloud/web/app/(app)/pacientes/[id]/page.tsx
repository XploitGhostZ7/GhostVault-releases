// By Kompilador
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { PacienteForm } from '@/components/paciente-form';
import { tieneRol, useMe } from '@/components/session';
import { Alert, Badge, Encabezado, Estado, Modal, Vacio } from '@/components/ui';
import { api, fechaHora, mensajeError, nombrePaciente } from '@/lib/api';

function edad(fecha: string): string {
  const n = new Date(`${fecha}T00:00:00`);
  const h = new Date();
  let a = h.getFullYear() - n.getFullYear();
  if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) a--;
  return `${a} años`;
}

export default function PacientePage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const clinico = tieneRol(me, 'medico', 'auditor');
  const [p, setP] = useState<any>(null);
  const [historial, setHistorial] = useState<any[] | null>(null);
  const [editar, setEditar] = useState(false);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    try {
      setP(await api.get(`/patients/${id}`));
      if (clinico) setHistorial(await api.get(`/patients/${id}/encounters`));
    } catch (e) {
      setError(mensajeError(e));
    }
  }, [id, clinico]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function exportarFhir() {
    try {
      const bundle = await api.get(`/fhir/Patient/${id}/$everything`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/fhir+json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `fhir-${p.tipo_documento}${p.numero_documento}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  if (error && !p) return <Alert>{error}</Alert>;
  if (!p) return <p className="muted">Cargando…</p>;

  return (
    <>
      <Encabezado titulo={nombrePaciente(p)} sub={`${p.tipo_documento} ${p.numero_documento} · ${edad(p.fecha_nacimiento)}`}>
        {clinico && (
          <button className="btn" onClick={exportarFhir}>
            Exportar FHIR R4
          </button>
        )}
        {tieneRol(me, 'admin', 'recepcion', 'medico') && (
          <button className="btn" onClick={() => setEditar(true)}>
            Editar datos
          </button>
        )}
      </Encabezado>
      <Alert>{error}</Alert>
      <div className="cols-main">
        <section className="card">
          <div className="card-head">
            <h2>Historial clínico</h2>
          </div>
          {!clinico ? (
            <Vacio>Su rol no tiene acceso al contenido clínico.</Vacio>
          ) : historial?.length === 0 ? (
            <Vacio>Sin atenciones registradas.</Vacio>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Atención</th>
                    <th>Profesional</th>
                    <th>Dx</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {historial?.map((h) => (
                    <tr key={h.id}>
                      <td>{fechaHora(h.iniciado_at)}</td>
                      <td>{h.plantilla.replace('_', ' ')}</td>
                      <td>{h.profesional}</td>
                      <td>{h.diagnostico_principal ?? '—'}</td>
                      <td>
                        <Estado valor={h.estado} /> {h.notas_aclaratorias > 0 && <Badge tono="warn">{h.notas_aclaratorias} nota(s)</Badge>}
                      </td>
                      <td className="acciones">
                        <Link className="btn btn-sm" href={`/atencion/${h.id}`}>
                          Ver
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Datos del paciente</h2>
          </div>
          <dl className="kv">
            <dt>Nacimiento</dt>
            <dd>{p.fecha_nacimiento}</dd>
            <dt>Sexo</dt>
            <dd>{{ M: 'Mujer', H: 'Hombre', I: 'Indeterminado' }[p.sexo as 'M' | 'H' | 'I']}</dd>
            <dt>Teléfono</dt>
            <dd>{p.telefono ?? '—'}</dd>
            <dt>Correo</dt>
            <dd>{p.email ?? '—'}</dd>
            <dt>Dirección</dt>
            <dd>{p.direccion ?? '—'}</dd>
            <dt>Municipio</dt>
            <dd>{p.municipio_residencia ?? '—'}</dd>
            <dt>EPS</dt>
            <dd>{p.eps_nombre ? `${p.eps_nombre} (${p.eps_codigo ?? 's/c'})` : '—'}</dd>
            <dt>Tipo usuario</dt>
            <dd>{p.tipo_usuario}</dd>
            <dt>Ley 1581</dt>
            <dd>{p.consentimiento_datos_at ? <Badge tono="ok">Autorizó {fechaHora(p.consentimiento_datos_at)}</Badge> : <Badge tono="error">Sin autorización</Badge>}</dd>
          </dl>
        </section>
      </div>
      <Modal titulo="Editar paciente" abierto={editar} onCerrar={() => setEditar(false)}>
        <PacienteForm
          inicial={p}
          onGuardado={(np) => {
            setP(np);
            setEditar(false);
          }}
        />
      </Modal>
    </>
  );
}
