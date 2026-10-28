// By Kompilador
'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Field } from './ui';
import { api, mensajeError } from '@/lib/api';

export const TIPOS_DOC: Array<[string, string]> = [
  ['CC', 'Cédula de ciudadanía'],
  ['TI', 'Tarjeta de identidad'],
  ['RC', 'Registro civil'],
  ['CE', 'Cédula de extranjería'],
  ['PA', 'Pasaporte'],
  ['PT', 'Permiso por protección temporal'],
  ['PE', 'Permiso especial de permanencia'],
  ['CD', 'Carné diplomático'],
  ['SC', 'Salvoconducto'],
  ['CN', 'Certificado de nacido vivo'],
  ['AS', 'Adulto sin identificar'],
  ['MS', 'Menor sin identificar'],
  ['DE', 'Documento extranjero'],
  ['SI', 'Sin identificación'],
];

const VACIO = {
  tipo_documento: 'CC',
  numero_documento: '',
  primer_nombre: '',
  segundo_nombre: '',
  primer_apellido: '',
  segundo_apellido: '',
  fecha_nacimiento: '',
  sexo: 'M',
  municipio_residencia: '',
  zona_residencia: '01',
  direccion: '',
  telefono: '',
  email: '',
  tipo_usuario: '01',
  eps_codigo: '',
  eps_nombre: '',
  consentimiento_datos: false,
};

type Datos = typeof VACIO;

export function PacienteForm({ inicial, onGuardado }: { inicial?: any; onGuardado: (p: any) => void }) {
  const [d, setD] = useState<Datos>(() => (inicial ? { ...VACIO, ...limpiar(inicial), consentimiento_datos: !!inicial.consentimiento_datos_at } : VACIO));
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const set = (k: keyof Datos) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    setError('');
    setGuardando(true);
    const body: Record<string, unknown> = { ...d };
    for (const k of Object.keys(body)) if (body[k] === '') body[k] = null;
    try {
      const p = inicial ? await api.patch(`/patients/${inicial.id}`, body) : await api.post('/patients', body);
      onGuardado(p);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar}>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <Field label="Tipo de documento">
          <select value={d.tipo_documento} onChange={set('tipo_documento')} disabled={!!inicial}>
            {TIPOS_DOC.map(([c, n]) => (
              <option key={c} value={c}>
                {c} · {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Número">
          <input value={d.numero_documento} onChange={set('numero_documento')} required pattern="[A-Za-z0-9]{3,20}" disabled={!!inicial} />
        </Field>
        <Field label="Primer nombre">
          <input value={d.primer_nombre} onChange={set('primer_nombre')} required />
        </Field>
        <Field label="Segundo nombre">
          <input value={d.segundo_nombre} onChange={set('segundo_nombre')} />
        </Field>
        <Field label="Primer apellido">
          <input value={d.primer_apellido} onChange={set('primer_apellido')} required />
        </Field>
        <Field label="Segundo apellido">
          <input value={d.segundo_apellido} onChange={set('segundo_apellido')} />
        </Field>
        <Field label="Fecha de nacimiento">
          <input type="date" value={d.fecha_nacimiento} onChange={set('fecha_nacimiento')} required />
        </Field>
        <Field label="Sexo biológico">
          <select value={d.sexo} onChange={set('sexo')}>
            <option value="M">Mujer</option>
            <option value="H">Hombre</option>
            <option value="I">Indeterminado</option>
          </select>
        </Field>
        <Field label="Municipio (DIVIPOLA)" hint="5 dígitos, p. ej. 11001">
          <input value={d.municipio_residencia} onChange={set('municipio_residencia')} pattern="[0-9]{5}" />
        </Field>
        <Field label="Zona">
          <select value={d.zona_residencia} onChange={set('zona_residencia')}>
            <option value="01">Urbana</option>
            <option value="02">Rural</option>
          </select>
        </Field>
        <Field label="Dirección">
          <input value={d.direccion} onChange={set('direccion')} />
        </Field>
        <Field label="Teléfono">
          <input value={d.telefono} onChange={set('telefono')} />
        </Field>
        <Field label="Correo">
          <input type="email" value={d.email} onChange={set('email')} />
        </Field>
        <Field label="Tipo de usuario (RIPS)" hint="01 contributivo, 02 subsidiado…">
          <input value={d.tipo_usuario} onChange={set('tipo_usuario')} pattern="[0-9]{2}" required />
        </Field>
        <Field label="Código EPS">
          <input value={d.eps_codigo} onChange={set('eps_codigo')} />
        </Field>
        <Field label="EPS / asegurador">
          <input value={d.eps_nombre} onChange={set('eps_nombre')} />
        </Field>
        <label className="check field-wide">
          <input
            type="checkbox"
            checked={d.consentimiento_datos}
            disabled={!!inicial?.consentimiento_datos_at}
            onChange={(e) => setD({ ...d, consentimiento_datos: e.target.checked })}
          />
          El paciente autorizó el tratamiento de sus datos personales sensibles (Ley 1581 de 2012).
        </label>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
        <button className="btn btn-primary" disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar paciente'}
        </button>
      </div>
    </form>
  );
}

function limpiar(p: any): Partial<Datos> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(VACIO)) if (k !== 'consentimiento_datos') out[k] = p[k] ?? '';
  return out as Partial<Datos>;
}
