// By Kompilador
'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Estado, Field, Modal, Vacio } from './ui';
import { api, mensajeError } from '@/lib/api';

const TIPOS: Array<[string, string]> = [
  ['formula', 'Fórmula médica'],
  ['laboratorio', 'Laboratorio clínico'],
  ['imagen', 'Imágenes diagnósticas'],
  ['procedimiento', 'Procedimientos'],
  ['interconsulta', 'Interconsulta'],
];

const MED_VACIO = { cum: '', nombre: '', concentracion: '', forma_farmaceutica: '', via: 'Oral', dosis: '', frecuencia: '', duracion_dias: '', cantidad: '', unidad: '', indicaciones: '' };
const SERV_VACIO = { cups: '', descripcion: '', cantidad: '1', prioridad: 'rutinaria', justificacion: '' };

type Med = typeof MED_VACIO;
type Serv = typeof SERV_VACIO;

function NuevaOrden({ encounterId, onCreada }: { encounterId: string; onCreada: () => void }) {
  const [tipo, setTipo] = useState('formula');
  const [meds, setMeds] = useState<Med[]>([{ ...MED_VACIO }]);
  const [servs, setServs] = useState<Serv[]>([{ ...SERV_VACIO }]);
  const [obs, setObs] = useState('');
  const [error, setError] = useState('');

  const setMed = (i: number, k: keyof Med, v: string) => setMeds(meds.map((m, j) => (j === i ? { ...m, [k]: v } : m)));
  const setServ = (i: number, k: keyof Serv, v: string) => setServs(servs.map((s, j) => (j === i ? { ...s, [k]: v } : s)));

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    setError('');
    const sinVacios = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v.trim() !== ''));
    const items =
      tipo === 'formula'
        ? meds.map((m) => ({ ...sinVacios(m), duracion_dias: Number(m.duracion_dias), cantidad: Number(m.cantidad) }))
        : servs.map((s) => ({ ...sinVacios(s), cups: s.cups.toUpperCase(), cantidad: Number(s.cantidad) }));
    try {
      await api.post(`/encounters/${encounterId}/orders`, { tipo, items, ...(obs ? { observaciones: obs } : {}) });
      onCreada();
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  return (
    <form onSubmit={guardar} className="stack">
      <Alert>{error}</Alert>
      <Field label="Tipo de orden">
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {TIPOS.map(([c, n]) => (
            <option key={c} value={c}>
              {n}
            </option>
          ))}
        </select>
      </Field>
      {tipo === 'formula'
        ? meds.map((m, i) => (
            <fieldset key={i}>
              <legend>Medicamento {i + 1}</legend>
              <div className="form-grid">
                <Field label="Nombre (DCI) *">
                  <input value={m.nombre} onChange={(e) => setMed(i, 'nombre', e.target.value)} required />
                </Field>
                <Field label="Concentración *">
                  <input value={m.concentracion} onChange={(e) => setMed(i, 'concentracion', e.target.value)} required placeholder="500 mg" />
                </Field>
                <Field label="Forma farmacéutica *">
                  <input value={m.forma_farmaceutica} onChange={(e) => setMed(i, 'forma_farmaceutica', e.target.value)} required placeholder="Tableta" />
                </Field>
                <Field label="Vía *">
                  <input value={m.via} onChange={(e) => setMed(i, 'via', e.target.value)} required />
                </Field>
                <Field label="Dosis *">
                  <input value={m.dosis} onChange={(e) => setMed(i, 'dosis', e.target.value)} required placeholder="1 tableta" />
                </Field>
                <Field label="Cada *">
                  <input value={m.frecuencia} onChange={(e) => setMed(i, 'frecuencia', e.target.value)} required placeholder="8 horas" />
                </Field>
                <Field label="Días *">
                  <input type="number" min={1} max={365} value={m.duracion_dias} onChange={(e) => setMed(i, 'duracion_dias', e.target.value)} required />
                </Field>
                <Field label="Cantidad total *">
                  <input type="number" min={1} max={9999} value={m.cantidad} onChange={(e) => setMed(i, 'cantidad', e.target.value)} required />
                </Field>
                <Field label="Unidad">
                  <input value={m.unidad} onChange={(e) => setMed(i, 'unidad', e.target.value)} placeholder="tabletas" />
                </Field>
                <Field label="CUM">
                  <input value={m.cum} onChange={(e) => setMed(i, 'cum', e.target.value)} pattern="[0-9]{1,12}(-[0-9]{1,3})?" />
                </Field>
                <Field label="Indicaciones" wide>
                  <input value={m.indicaciones} onChange={(e) => setMed(i, 'indicaciones', e.target.value)} />
                </Field>
              </div>
            </fieldset>
          ))
        : servs.map((s, i) => (
            <fieldset key={i}>
              <legend>Servicio {i + 1}</legend>
              <div className="form-grid">
                <Field label="CUPS *">
                  <input value={s.cups} onChange={(e) => setServ(i, 'cups', e.target.value)} required pattern="[0-9A-Za-z]{6}" />
                </Field>
                <Field label="Descripción *">
                  <input value={s.descripcion} onChange={(e) => setServ(i, 'descripcion', e.target.value)} required />
                </Field>
                <Field label="Cantidad">
                  <input type="number" min={1} max={99} value={s.cantidad} onChange={(e) => setServ(i, 'cantidad', e.target.value)} />
                </Field>
                <Field label="Prioridad">
                  <select value={s.prioridad} onChange={(e) => setServ(i, 'prioridad', e.target.value)}>
                    <option value="rutinaria">Rutinaria</option>
                    <option value="urgente">Urgente</option>
                  </select>
                </Field>
                <Field label="Justificación" wide>
                  <input value={s.justificacion} onChange={(e) => setServ(i, 'justificacion', e.target.value)} />
                </Field>
              </div>
            </fieldset>
          ))}
      <div className="row">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => (tipo === 'formula' ? setMeds([...meds, { ...MED_VACIO }]) : setServs([...servs, { ...SERV_VACIO }]))}
        >
          + Agregar ítem
        </button>
      </div>
      <Field label="Observaciones">
        <textarea value={obs} onChange={(e) => setObs(e.target.value)} maxLength={1000} />
      </Field>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-primary">Guardar borrador</button>
      </div>
    </form>
  );
}

export function Ordenes({
  encounterId,
  ordenes,
  editable,
  onCambio,
  pedirPin,
}: {
  encounterId: string;
  ordenes: any[];
  editable: boolean;
  onCambio: () => void;
  pedirPin: (titulo: string, accion: (pin: string) => Promise<void>) => void;
}) {
  const [nueva, setNueva] = useState(false);
  const nombre = Object.fromEntries(TIPOS);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Fórmula y órdenes</h2>
        {editable && (
          <button className="btn btn-sm" onClick={() => setNueva(true)}>
            + Nueva
          </button>
        )}
      </div>
      {ordenes.length === 0 ? (
        <Vacio>Sin órdenes.</Vacio>
      ) : (
        <ul className="item-list">
          {ordenes.map((o) => (
            <li key={o.id}>
              <span>
                <strong>N.º {o.consecutivo}</strong> · {nombre[o.tipo]} <Estado valor={o.estado} />
              </span>
              <span className="row">
                {editable && o.estado === 'borrador' && (
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() =>
                      pedirPin(`Firmar orden N.º ${o.consecutivo}`, async (pin) => {
                        await api.post(`/orders/${o.id}/sign`, { pin });
                        onCambio();
                      })
                    }
                  >
                    Firmar
                  </button>
                )}
                <a className="btn btn-sm" href={`/api/orders/${o.id}/pdf`} target="_blank" rel="noopener noreferrer">
                  PDF
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Modal titulo="Nueva orden" abierto={nueva} onCerrar={() => setNueva(false)}>
        <NuevaOrden
          encounterId={encounterId}
          onCreada={() => {
            setNueva(false);
            onCambio();
          }}
        />
      </Modal>
    </section>
  );
}
