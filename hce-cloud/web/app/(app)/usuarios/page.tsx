// By Kompilador
'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useMe } from '@/components/session';
import { Alert, Badge, Encabezado, Field, Modal, Vacio } from '@/components/ui';
import { api, fechaHora, mensajeError } from '@/lib/api';

const ROLES: Array<[string, string]> = [
  ['admin', 'Administrador'],
  ['medico', 'Profesional de salud'],
  ['recepcion', 'Recepción'],
  ['facturacion', 'Facturación'],
  ['auditor', 'Auditor'],
];
const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

const NUEVO = {
  email: '',
  nombre: '',
  tipo_documento: 'CC',
  numero_documento: '',
  registro_profesional: '',
  especialidad: '',
  roles: ['recepcion'] as string[],
  password: '',
};

function UsuarioForm({ inicial, onListo }: { inicial?: any; onListo: () => void }) {
  const [d, setD] = useState(inicial ? { ...NUEVO, ...inicial, registro_profesional: inicial.registro_profesional ?? '', especialidad: inicial.especialidad ?? '' } : NUEVO);
  const [error, setError] = useState('');
  const set = (k: keyof typeof NUEVO) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });

  function rol(r: string, on: boolean) {
    setD({ ...d, roles: on ? [...d.roles, r] : d.roles.filter((x: string) => x !== r) });
  }

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    setError('');
    try {
      if (inicial) {
        await api.patch(`/users/${inicial.id}`, {
          nombre: d.nombre,
          roles: d.roles,
          registro_profesional: d.registro_profesional || null,
          especialidad: d.especialidad || null,
        });
      } else {
        await api.post('/users', {
          ...d,
          registro_profesional: d.registro_profesional || undefined,
          especialidad: d.especialidad || undefined,
        });
      }
      onListo();
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  return (
    <form onSubmit={guardar} className="stack">
      <Alert>{error}</Alert>
      <div className="form-grid">
        <Field label="Nombre completo">
          <input value={d.nombre} onChange={set('nombre')} required minLength={3} />
        </Field>
        <Field label="Correo">
          <input type="email" value={d.email} onChange={set('email')} required disabled={!!inicial} />
        </Field>
        <Field label="Tipo doc.">
          <input value={d.tipo_documento} onChange={set('tipo_documento')} required maxLength={3} disabled={!!inicial} />
        </Field>
        <Field label="Número de documento">
          <input value={d.numero_documento} onChange={set('numero_documento')} required disabled={!!inicial} />
        </Field>
        <Field label="Registro profesional (ReTHUS)">
          <input value={d.registro_profesional} onChange={set('registro_profesional')} />
        </Field>
        <Field label="Especialidad">
          <input value={d.especialidad} onChange={set('especialidad')} />
        </Field>
        {!inicial && (
          <Field label="Contraseña inicial" hint="Mín. 12 caracteres con mayúsculas, minúsculas y números">
            <input type="password" value={d.password} onChange={set('password')} required minLength={12} autoComplete="new-password" />
          </Field>
        )}
      </div>
      <fieldset>
        <legend>Roles</legend>
        <div className="row">
          {ROLES.map(([r, n]) => (
            <label key={r} className="check">
              <input type="checkbox" checked={d.roles.includes(r)} onChange={(e) => rol(r, e.target.checked)} /> {n}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" disabled={d.roles.length === 0}>
          Guardar
        </button>
      </div>
    </form>
  );
}

function Horarios({ medicos }: { medicos: any[] }) {
  const [prof, setProf] = useState('');
  const [lista, setLista] = useState<any[]>([]);
  const [n, setN] = useState({ dia_semana: '1', hora_inicio: '08:00', hora_fin: '12:00', duracion_min: '20' });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!prof && medicos[0]) setProf(medicos[0].id);
  }, [medicos, prof]);

  const cargar = useCallback(async () => {
    if (!prof) return;
    try {
      setLista(await api.get(`/schedules?professional_id=${prof}`));
    } catch (e) {
      setError(mensajeError(e));
    }
  }, [prof]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function agregar(ev: FormEvent) {
    ev.preventDefault();
    setError('');
    try {
      await api.post('/schedules', {
        professional_id: prof,
        dia_semana: Number(n.dia_semana),
        hora_inicio: n.hora_inicio,
        hora_fin: n.hora_fin,
        duracion_min: Number(n.duracion_min),
      });
      cargar();
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  async function quitar(id: string) {
    try {
      await api.del(`/schedules/${id}`);
      cargar();
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Horarios de atención</h2>
        <select value={prof} onChange={(e) => setProf(e.target.value)} style={{ width: 'auto' }} aria-label="Profesional">
          {medicos.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre}
            </option>
          ))}
        </select>
      </div>
      <Alert>{error}</Alert>
      {medicos.length === 0 ? (
        <Vacio>Cree primero un usuario con rol de profesional de salud.</Vacio>
      ) : (
        <>
          {lista.length === 0 ? (
            <Vacio>Sin horarios.</Vacio>
          ) : (
            <ul className="item-list">
              {lista.map((h) => (
                <li key={h.id}>
                  <span>
                    <strong>{DIAS[h.dia_semana]}</strong> {h.hora_inicio.slice(0, 5)}–{h.hora_fin.slice(0, 5)} · cupos de {h.duracion_min} min
                  </span>
                  <button className="btn btn-sm btn-danger" onClick={() => quitar(h.id)}>
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={agregar} className="row" style={{ marginTop: '0.75rem' }}>
            <Field label="Día">
              <select value={n.dia_semana} onChange={(e) => setN({ ...n, dia_semana: e.target.value })}>
                {DIAS.slice(1).map((d, i) => (
                  <option key={d} value={i + 1}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Desde">
              <input type="time" value={n.hora_inicio} onChange={(e) => setN({ ...n, hora_inicio: e.target.value })} />
            </Field>
            <Field label="Hasta">
              <input type="time" value={n.hora_fin} onChange={(e) => setN({ ...n, hora_fin: e.target.value })} />
            </Field>
            <Field label="Minutos">
              <input type="number" min={5} max={240} value={n.duracion_min} onChange={(e) => setN({ ...n, duracion_min: e.target.value })} style={{ width: 90 }} />
            </Field>
            <button className="btn btn-primary">Agregar</button>
          </form>
        </>
      )}
    </section>
  );
}

const NOMBRES_CATALOGO: Record<string, string> = { cie10: 'CIE-10 (diagnósticos)', cups: 'CUPS (procedimientos)', cum: 'CUM (medicamentos)' };

function Catalogos() {
  const [estado, setEstado] = useState<any[] | null>(null);
  useEffect(() => {
    api.get<any[]>('/catalogos/estado').then(setEstado).catch(() => setEstado([]));
  }, []);
  const porTipo = new Map((estado ?? []).map((e) => [e.catalogo, e]));
  return (
    <section className="card">
      <div className="card-head">
        <h2>Catálogos de referencia</h2>
      </div>
      <p className="muted" style={{ marginBottom: '0.75rem' }}>
        Se cargan con <span className="mono">npm run catalogo</span> desde los archivos oficiales de SISPRO e INVIMA. Mientras un catálogo no esté
        cargado, solo se valida el formato de los códigos.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Catálogo</th>
              <th>Versión</th>
              <th>Fuente</th>
              <th>Registros</th>
              <th>Cargado</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(NOMBRES_CATALOGO).map(([tipo, nombre]) => {
              const e = porTipo.get(tipo);
              return (
                <tr key={tipo}>
                  <td>{nombre}</td>
                  <td>{e?.version ?? <Badge tono="warn">Sin cargar</Badge>}</td>
                  <td>{e?.fuente ?? '—'}</td>
                  <td>{e ? e.registros.toLocaleString('es-CO') : '—'}</td>
                  <td>{e ? fechaHora(e.cargado_at) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function UsuariosPage() {
  const me = useMe();
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [editar, setEditar] = useState<any>(null);
  const [nuevo, setNuevo] = useState(false);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    try {
      setUsuarios(await api.get('/users'));
    } catch (e) {
      setError(mensajeError(e));
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function activo(u: any) {
    try {
      await api.patch(`/users/${u.id}`, { activo: !u.activo });
      cargar();
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  async function resetMfa(u: any) {
    if (!window.confirm(`¿Reiniciar el segundo factor de ${u.nombre}? Deberá configurarlo de nuevo al ingresar.`)) return;
    try {
      await api.post(`/users/${u.id}/reset-mfa`);
      cargar();
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  const medicos = usuarios.filter((u) => u.roles.includes('medico') && u.activo);

  return (
    <>
      <Encabezado titulo="Usuarios y horarios">
        <button className="btn btn-primary" onClick={() => setNuevo(true)}>
          Nuevo usuario
        </button>
      </Encabezado>
      <Alert>{error}</Alert>
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Roles</th>
                <th>MFA</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.nombre}
                    {u.especialidad && <div className="muted">{u.especialidad}</div>}
                  </td>
                  <td>{u.email}</td>
                  <td>{u.roles.join(', ')}</td>
                  <td>{u.totp_enabled ? <Badge tono="ok">Activo</Badge> : <Badge tono="warn">No</Badge>}</td>
                  <td>{u.activo ? <Badge tono="ok">Activo</Badge> : <Badge>Inactivo</Badge>}</td>
                  <td className="acciones">
                    <button className="btn btn-sm" onClick={() => setEditar(u)}>
                      Editar
                    </button>
                    {u.totp_enabled && (
                      <button className="btn btn-sm" onClick={() => resetMfa(u)}>
                        Reiniciar MFA
                      </button>
                    )}
                    {u.id !== me.id && (
                      <button className={`btn btn-sm${u.activo ? ' btn-danger' : ''}`} onClick={() => activo(u)}>
                        {u.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Horarios medicos={medicos} />
      <Catalogos />
      <Modal titulo="Nuevo usuario" abierto={nuevo} onCerrar={() => setNuevo(false)}>
        <UsuarioForm
          onListo={() => {
            setNuevo(false);
            cargar();
          }}
        />
      </Modal>
      <Modal titulo="Editar usuario" abierto={!!editar} onCerrar={() => setEditar(null)}>
        {editar && (
          <UsuarioForm
            inicial={editar}
            onListo={() => {
              setEditar(null);
              cargar();
            }}
          />
        )}
      </Modal>
    </>
  );
}
