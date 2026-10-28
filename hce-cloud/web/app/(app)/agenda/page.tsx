// By Kompilador
'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AdmisionForm } from '@/components/admision-form';
import { BuscarPaciente } from '@/components/buscar-paciente';
import { tieneRol, useMe } from '@/components/session';
import { Alert, Encabezado, Estado, Field, Modal, Vacio } from '@/components/ui';
import { api, hora, hoyBogota, mensajeError, nombrePaciente } from '@/lib/api';

export default function AgendaPage() {
  const me = useMe();
  const gestiona = tieneRol(me, 'admin', 'recepcion');
  const [medicos, setMedicos] = useState<any[]>([]);
  const [profesional, setProfesional] = useState(me.roles.includes('medico') && !gestiona ? me.id : '');
  const [fecha, setFecha] = useState(hoyBogota());
  const [slots, setSlots] = useState<any[]>([]);
  const [citas, setCitas] = useState<any[]>([]);
  const [slot, setSlot] = useState<any>(null);
  const [paciente, setPaciente] = useState<any>(null);
  const [motivo, setMotivo] = useState('');
  const [admitir, setAdmitir] = useState<any>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    api
      .get<any[]>('/users?rol=medico')
      .then((m) => {
        const activos = m.filter((u) => u.activo);
        setMedicos(activos);
        setProfesional((actual) => actual || activos[0]?.id || '');
      })
      .catch((e) => setError(mensajeError(e)));
  }, []);

  const cargar = useCallback(async () => {
    setError('');
    try {
      const qs = profesional ? `&professional_id=${profesional}` : '';
      setCitas(await api.get(`/appointments?fecha=${fecha}${qs}`));
      setSlots(profesional ? await api.get(`/agenda/slots?professional_id=${profesional}&fecha=${fecha}`) : []);
    } catch (e) {
      setError(mensajeError(e));
    }
  }, [fecha, profesional]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function agendar(ev: FormEvent) {
    ev.preventDefault();
    try {
      await api.post('/appointments', {
        patient_id: paciente.id,
        professional_id: profesional,
        inicio: slot.inicio,
        duracion_min: Math.round((new Date(slot.fin).getTime() - new Date(slot.inicio).getTime()) / 60000),
        motivo: motivo || undefined,
      });
      setAviso(`Cita asignada a ${nombrePaciente(paciente)} a las ${hora(slot.inicio)}`);
      cerrarCita();
      cargar();
    } catch (e) {
      setError(mensajeError(e));
      cerrarCita();
    }
  }

  function cerrarCita() {
    setSlot(null);
    setPaciente(null);
    setMotivo('');
  }

  async function transicion(c: any, accion: 'confirm' | 'cancel' | 'no-show') {
    let motivo: string | undefined;
    if (accion === 'cancel') {
      motivo = window.prompt('Motivo de la cancelación') ?? undefined;
      if (!motivo) return;
    }
    try {
      await api.post(`/appointments/${c.id}/${accion}`, motivo ? { motivo } : {});
      cargar();
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  return (
    <>
      <Encabezado titulo="Agenda" sub="Cupos disponibles y citas del día">
        <div className="row">
          <Field label="Profesional">
            <select value={profesional} onChange={(e) => setProfesional(e.target.value)}>
              {gestiona && <option value="">Todos</option>}
              {medicos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                  {m.especialidad ? ` · ${m.especialidad}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fecha">
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Field>
        </div>
      </Encabezado>
      <Alert>{error}</Alert>
      <Alert tipo="ok">{aviso}</Alert>

      <div className={gestiona ? 'cols-main' : ''}>
        <section className="card">
          <div className="card-head">
            <h2>Citas</h2>
            <span className="muted">{citas.length} registradas</span>
          </div>
          {citas.length === 0 ? (
            <Vacio>No hay citas para esta fecha.</Vacio>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Paciente</th>
                    <th>Profesional</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {citas.map((c) => (
                    <tr key={c.id}>
                      <td>
                        {hora(c.inicio)}–{hora(c.fin)}
                      </td>
                      <td>
                        {c.paciente}
                        <div className="muted">
                          {c.tipo_documento} {c.numero_documento}
                          {c.motivo ? ` · ${c.motivo}` : ''}
                        </div>
                      </td>
                      <td>{c.profesional}</td>
                      <td>
                        <Estado valor={c.estado} />
                      </td>
                      <td className="acciones">
                        {gestiona && ['programada', 'confirmada'].includes(c.estado) && (
                          <div className="acciones-grupo">
                            <button className="btn btn-sm btn-primary" onClick={() => setAdmitir(c)}>
                              Admitir
                            </button>
                            {c.estado === 'programada' && (
                              <button className="btn btn-sm" onClick={() => transicion(c, 'confirm')}>
                                Confirmar
                              </button>
                            )}
                            <button className="btn btn-sm" onClick={() => transicion(c, 'no-show')}>
                              No asistió
                            </button>
                            <button className="btn btn-sm btn-danger" onClick={() => transicion(c, 'cancel')}>
                              Cancelar
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

        {gestiona && (
          <section className="card">
            <div className="card-head">
              <h2>Cupos disponibles</h2>
            </div>
            {!profesional ? (
              <Vacio>Seleccione un profesional.</Vacio>
            ) : slots.length === 0 ? (
              <Vacio>Sin cupos. Revise los horarios en Usuarios y horarios.</Vacio>
            ) : (
              <div className="slots">
                {slots.map((s) => (
                  <button key={s.inicio} className="slot" onClick={() => setSlot(s)}>
                    {hora(s.inicio)}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <Modal titulo={slot ? `Asignar cita · ${hora(slot.inicio)}` : 'Asignar cita'} abierto={!!slot} onCerrar={cerrarCita}>
        {!paciente ? (
          <BuscarPaciente onElegir={setPaciente} />
        ) : (
          <form onSubmit={agendar} className="stack">
            <p>
              <strong>{nombrePaciente(paciente)}</strong> · {paciente.tipo_documento} {paciente.numero_documento}{' '}
              <button type="button" className="btn btn-sm" onClick={() => setPaciente(null)}>
                Cambiar
              </button>
            </p>
            <Field label="Motivo (opcional)">
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
            </Field>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-primary">Confirmar cita</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal titulo="Admisión" abierto={!!admitir} onCerrar={() => setAdmitir(null)}>
        {admitir && (
          <AdmisionForm
            cita={admitir}
            onAdmitida={() => {
              setAviso(`${admitir.paciente} admitido. Ya aparece en la bandeja del profesional.`);
              setAdmitir(null);
              cargar();
            }}
          />
        )}
      </Modal>
    </>
  );
}
