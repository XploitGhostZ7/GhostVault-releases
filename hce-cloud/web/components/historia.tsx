// By Kompilador
'use client';

import { Field } from './ui';

export type CampoPlantilla = {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'boolean';
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  unit?: string;
};

export type Plantilla = {
  code: string;
  version: number;
  nombre: string;
  sections: Array<{ key: string; label: string; fields: CampoPlantilla[] }>;
};

export type Contenido = Record<string, Record<string, unknown>>;

function Control({ f, valor, onChange }: { f: CampoPlantilla; valor: unknown; onChange: (v: unknown) => void }) {
  switch (f.type) {
    case 'textarea':
      return <textarea value={(valor as string) ?? ''} onChange={(e) => onChange(e.target.value)} required={f.required} />;
    case 'number':
      return (
        <input
          type="number"
          step="any"
          min={f.min}
          max={f.max}
          value={valor === undefined || valor === null ? '' : String(valor)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    case 'date':
      return <input type="date" value={(valor as string) ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
    case 'boolean':
      return (
        <select value={valor === true ? 'si' : valor === false ? 'no' : ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'si')}>
          <option value="">—</option>
          <option value="si">Sí</option>
          <option value="no">No</option>
        </select>
      );
    case 'select':
      return (
        <select value={(valor as string) ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {f.options?.map((o) => (
            <option key={o} value={o}>
              {o.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      );
    default:
      return <input value={(valor as string) ?? ''} onChange={(e) => onChange(e.target.value)} maxLength={500} />;
  }
}

export function HistoriaEditor({ plantilla, contenido, onChange }: { plantilla: Plantilla; contenido: Contenido; onChange: (c: Contenido) => void }) {
  return (
    <>
      {plantilla.sections.map((s) => (
        <fieldset key={s.key}>
          <legend>{s.label}</legend>
          <div className="form-grid">
            {s.fields.map((f) => (
              <Field
                key={f.key}
                label={`${f.label}${f.unit && f.type === 'number' ? ` (${f.unit})` : ''}${f.required ? ' *' : ''}`}
                wide={f.type === 'textarea'}
              >
                <Control
                  f={f}
                  valor={contenido[s.key]?.[f.key]}
                  onChange={(v) => onChange({ ...contenido, [s.key]: { ...(contenido[s.key] ?? {}), [f.key]: v } })}
                />
              </Field>
            ))}
          </div>
        </fieldset>
      ))}
    </>
  );
}

function texto(v: unknown): string {
  if (v === true) return 'Sí';
  if (v === false) return 'No';
  return String(v).replace(/_/g, ' ');
}

export function HistoriaLectura({ plantilla, contenido }: { plantilla: Plantilla; contenido: Contenido }) {
  return (
    <>
      {plantilla.sections.map((s) => {
        const campos = s.fields.filter((f) => {
          const v = contenido[s.key]?.[f.key];
          return v !== undefined && v !== null && v !== '';
        });
        if (campos.length === 0) return null;
        return (
          <div key={s.key} className="record-section">
            <h3>{s.label}</h3>
            {campos.map((f) => (
              <p key={f.key} className="record-field">
                <b>{f.label}:</b> {texto(contenido[s.key]![f.key])}
                {f.unit && f.type === 'number' ? ` ${f.unit}` : ''}
              </p>
            ))}
          </div>
        );
      })}
    </>
  );
}

export function limpiarContenido(c: Contenido): Contenido {
  const out: Contenido = {};
  for (const [sec, campos] of Object.entries(c)) {
    const limpio: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(campos ?? {})) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      limpio[k] = v;
    }
    if (Object.keys(limpio).length) out[sec] = limpio;
  }
  return out;
}
