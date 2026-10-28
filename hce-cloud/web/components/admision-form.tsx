// By Kompilador
'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { CatalogoInput, useDescripcion } from './catalogo';
import { Alert, Field } from './ui';
import { api, mensajeError } from '@/lib/api';

type Plantilla = { code: string; nombre: string; codServicioSugerido: string; cupsSugerido: string };

export function AdmisionForm({ cita, onAdmitida }: { cita: any; onAdmitida: () => void }) {
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [d, setD] = useState({
    cod_servicio: '328',
    cod_consulta: '890201',
    num_autorizacion: '',
    valor_servicio: '',
    concepto_recaudo: '05',
    valor_pago_moderador: '0',
    modalidad: '01',
    grupo_servicios: '01',
  });
  const [error, setError] = useState('');
  const descCups = useDescripcion('cups', d.cod_consulta);
  const set = (k: keyof typeof d) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });

  useEffect(() => {
    api.get<Plantilla[]>('/templates').then(setPlantillas).catch(() => undefined);
  }, []);

  function sugerir(code: string) {
    const t = plantillas.find((p) => p.code === code);
    if (t) setD({ ...d, cod_servicio: t.codServicioSugerido, cod_consulta: t.cupsSugerido });
  }

  async function admitir(ev: FormEvent) {
    ev.preventDefault();
    setError('');
    try {
      await api.post('/admissions', {
        appointment_id: cita.id,
        cod_servicio: d.cod_servicio,
        cod_consulta: d.cod_consulta.toUpperCase(),
        num_autorizacion: d.num_autorizacion || undefined,
        valor_servicio: Number(d.valor_servicio),
        concepto_recaudo: d.concepto_recaudo,
        valor_pago_moderador: Number(d.valor_pago_moderador || 0),
        modalidad: d.modalidad,
        grupo_servicios: d.grupo_servicios,
      });
      onAdmitida();
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  return (
    <form onSubmit={admitir}>
      <p className="muted" style={{ marginBottom: '0.75rem' }}>
        {cita.paciente} · {cita.tipo_documento} {cita.numero_documento} · {cita.profesional}
      </p>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <Field label="Tipo de consulta" hint="Sugiere servicio y CUPS">
          <select onChange={(e) => sugerir(e.target.value)} defaultValue="medicina_general">
            {plantillas.map((p) => (
              <option key={p.code} value={p.code}>
                {p.nombre}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Código de servicio (REPS)">
          <input value={d.cod_servicio} onChange={set('cod_servicio')} pattern="[0-9]{3,4}" required />
        </Field>
        <Field label="CUPS de la consulta" hint={descCups ?? undefined}>
          <CatalogoInput
            tipo="cups"
            value={d.cod_consulta}
            onChange={(v) => setD({ ...d, cod_consulta: v })}
            onElegir={(it) => setD({ ...d, cod_consulta: it.codigo })}
            required
          />
        </Field>
        <Field label="N.º de autorización">
          <input value={d.num_autorizacion} onChange={set('num_autorizacion')} />
        </Field>
        <Field label="Valor del servicio (COP)">
          <input type="number" min={0} step={1} value={d.valor_servicio} onChange={set('valor_servicio')} required />
        </Field>
        <Field label="Concepto de recaudo" hint="01 copago, 02 cuota moderadora, 05 no aplica">
          <select value={d.concepto_recaudo} onChange={set('concepto_recaudo')}>
            <option value="01">01 · Copago</option>
            <option value="02">02 · Cuota moderadora</option>
            <option value="03">03 · Pagos compartidos</option>
            <option value="04">04 · Anticipo</option>
            <option value="05">05 · No aplica</option>
          </select>
        </Field>
        <Field label="Valor pagado por el usuario">
          <input type="number" min={0} step={1} value={d.valor_pago_moderador} onChange={set('valor_pago_moderador')} />
        </Field>
        <Field label="Modalidad (RIPS)" hint="01 intramural; ver tabla de referencia SISPRO">
          <input value={d.modalidad} onChange={set('modalidad')} pattern="[0-9]{2}" required />
        </Field>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
        <button className="btn btn-primary">Admitir</button>
      </div>
    </form>
  );
}
