// By Kompilador
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { HistoriaEditor, HistoriaLectura, limpiarContenido, type Contenido, type Plantilla } from '@/components/historia';
import { CatalogoInput, CodigosMultiples, useDescripcion } from '@/components/catalogo';
import { Ordenes } from '@/components/ordenes';
import { useMe } from '@/components/session';
import { Alert, Badge, Encabezado, Estado, Field, Modal } from '@/components/ui';
import { api, fechaHora, mensajeError, nombrePaciente } from '@/lib/api';

type Dx = {
  diagnostico_principal: string;
  relacionados: string[];
  tipo_diagnostico_principal: string;
  finalidad: string;
  causa_externa: string;
};

function PinModal({ titulo, onCerrar, onFirmar }: { titulo: string; onCerrar: () => void; onFirmar: (pin: string) => Promise<void> }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    setError('');
    setEnviando(true);
    try {
      await onFirmar(pin);
      onCerrar();
    } catch (e) {
      setError(mensajeError(e));
      setPin('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="stack">
      <p className="muted">Al firmar, el registro queda sellado y no podrá modificarse. Las correcciones posteriores se hacen con notas aclaratorias.</p>
      <Alert>{error}</Alert>
      <Field label="PIN de firma">
        <input type="password" inputMode="numeric" pattern="[0-9]{6,12}" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus required autoComplete="off" />
      </Field>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onCerrar}>
          Cancelar
        </button>
        <button className="btn btn-primary" disabled={enviando}>
          {enviando ? 'Firmando…' : titulo}
        </button>
      </div>
    </form>
  );
}

export default function HistoriaPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const [e, setE] = useState<any>(null);
  const [plantilla, setPlantilla] = useState<Plantilla | null>(null);
  const [paciente, setPaciente] = useState<any>(null);
  const [contenido, setContenido] = useState<Contenido>({});
  const [dx, setDx] = useState<Dx>({ diagnostico_principal: '', relacionados: [], tipo_diagnostico_principal: '', finalidad: '', causa_externa: '' });
  const [sucio, setSucio] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [firma, setFirma] = useState<{ titulo: string; accion: (pin: string) => Promise<void> } | null>(null);
  const [nota, setNota] = useState(false);
  const [verificacion, setVerificacion] = useState<any>(null);
  const descPrincipal = useDescripcion('cie10', dx.diagnostico_principal);

  const cargar = useCallback(async () => {
    try {
      const enc = await api.get(`/encounters/${id}`);
      const [t, p] = await Promise.all([api.get(`/templates/${enc.plantilla}`), api.get(`/patients/${enc.patient_id}`)]);
      setE(enc);
      setPlantilla(t);
      setPaciente(p);
      setContenido(enc.contenido ?? {});
      setDx({
        diagnostico_principal: enc.diagnostico_principal ?? '',
        relacionados: enc.diagnosticos_relacionados ?? [],
        tipo_diagnostico_principal: enc.tipo_diagnostico_principal ?? '',
        finalidad: enc.finalidad ?? '',
        causa_externa: enc.causa_externa ?? '',
      });
      setSucio(false);
    } catch (err) {
      setError(mensajeError(err));
    }
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (!sucio) return;
    const aviso = (ev: BeforeUnloadEvent) => ev.preventDefault();
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [sucio]);

  const editable = e?.estado === 'borrador' && e?.professional_id === me.id;
  const esMedico = me.roles.includes('medico');

  async function guardar(silencioso = false) {
    setError('');
    const vacioANull = (v: string) => (v.trim() === '' ? null : v.trim());
    const r = await api.patch(`/encounters/${id}`, {
      contenido: limpiarContenido(contenido),
      diagnostico_principal: vacioANull(dx.diagnostico_principal),
      diagnosticos_relacionados: dx.relacionados,
      tipo_diagnostico_principal: vacioANull(dx.tipo_diagnostico_principal),
      finalidad: vacioANull(dx.finalidad),
      causa_externa: vacioANull(dx.causa_externa),
    });
    setE((prev: any) => ({ ...prev, ...r }));
    setSucio(false);
    if (!silencioso) setAviso('Borrador guardado');
  }

  async function guardarClick() {
    try {
      await guardar();
    } catch (err) {
      setError(mensajeError(err));
    }
  }

  async function prepararFirma() {
    try {
      await guardar(true);
      setFirma({
        titulo: 'Firmar historia',
        accion: async (pin) => {
          await api.post(`/encounters/${id}/sign`, { pin });
          setAviso('Historia clínica firmada');
          await cargar();
        },
      });
    } catch (err) {
      setError(mensajeError(err));
    }
  }

  async function verificar() {
    try {
      setVerificacion(await api.get(`/encounters/${id}/verify`));
    } catch (err) {
      setError(mensajeError(err));
    }
  }

  if (error && !e) return <Alert>{error}</Alert>;
  if (!e || !plantilla || !paciente) return <p className="muted">Cargando…</p>;

  const setD = (k: Exclude<keyof Dx, 'relacionados'>) => (ev: { target: { value: string } }) => {
    setDx({ ...dx, [k]: ev.target.value });
    setSucio(true);
  };

  return (
    <>
      <Encabezado
        titulo={plantilla.nombre}
        sub={`${nombrePaciente(paciente)} · ${paciente.tipo_documento} ${paciente.numero_documento} · Inicio ${fechaHora(e.iniciado_at)}`}
      >
        <Estado valor={e.estado} />
        <Link className="btn" href={`/pacientes/${paciente.id}`}>
          Ver paciente
        </Link>
        <a className="btn" href={`/api/encounters/${id}/pdf`} target="_blank" rel="noopener noreferrer">
          PDF
        </a>
        {editable && (
          <>
            <button className="btn" onClick={guardarClick} disabled={!sucio}>
              Guardar borrador
            </button>
            <button className="btn btn-primary" onClick={prepararFirma} disabled={!me.tiene_firma}>
              Firmar historia
            </button>
          </>
        )}
      </Encabezado>
      <Alert>{error}</Alert>
      <Alert tipo="ok">{aviso}</Alert>
      {editable && !me.tiene_firma && <Alert tipo="warn">Registre su llave de firma en Mi cuenta para poder firmar.</Alert>}
      {e.estado === 'borrador' && !editable && <Alert tipo="info">Borrador en elaboración por el profesional tratante.</Alert>}

      <div className="cols-main">
        <div>
          {editable ? (
            <HistoriaEditor
              plantilla={plantilla}
              contenido={contenido}
              onChange={(c) => {
                setContenido(c);
                setSucio(true);
                setAviso('');
              }}
            />
          ) : (
            <section className="card">
              <HistoriaLectura plantilla={plantilla} contenido={contenido} />
            </section>
          )}

          {e.estado === 'firmado' && (
            <section className="card">
              <div className="card-head">
                <h2>Notas aclaratorias</h2>
                {esMedico && (
                  <button className="btn btn-sm" onClick={() => setNota(true)} disabled={!me.tiene_firma}>
                    + Nota aclaratoria
                  </button>
                )}
              </div>
              {e.addenda.length === 0 ? (
                <p className="muted">Sin notas.</p>
              ) : (
                e.addenda.map((a: any) => (
                  <div key={a.id} className="addendum">
                    <strong>
                      {fechaHora(a.created_at)} · {a.autor_nombre}
                    </strong>
                    <div>
                      <em>Motivo: {a.motivo}</em>
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{a.texto}</div>
                  </div>
                ))
              )}
            </section>
          )}
        </div>

        <div>
          <section className="card">
            <div className="card-head">
              <h2>Diagnóstico y datos RIPS</h2>
            </div>
            <div className="stack">
              <Field label="Diagnóstico principal (CIE-10) *">
                <CatalogoInput
                  tipo="cie10"
                  value={dx.diagnostico_principal}
                  onChange={(v) => {
                    setDx({ ...dx, diagnostico_principal: v });
                    setSucio(true);
                  }}
                  onElegir={(it) => {
                    setDx({ ...dx, diagnostico_principal: it.codigo });
                    setSucio(true);
                  }}
                  disabled={!editable}
                  placeholder="Código o nombre del diagnóstico"
                />
                {descPrincipal && <span className="desc-codigo">{descPrincipal}</span>}
              </Field>
              <div className="field">
                <span className="field-label">Relacionados (máx. 3)</span>
                <CodigosMultiples
                  tipo="cie10"
                  codigos={dx.relacionados}
                  max={3}
                  disabled={!editable}
                  ariaLabel="Diagnóstico relacionado"
                  onChange={(c) => {
                    setDx({ ...dx, relacionados: c });
                    setSucio(true);
                  }}
                />
              </div>
              <Field label="Tipo de diagnóstico principal *">
                <select value={dx.tipo_diagnostico_principal} onChange={setD('tipo_diagnostico_principal')} disabled={!editable}>
                  <option value="">—</option>
                  <option value="01">01 · Impresión diagnóstica</option>
                  <option value="02">02 · Confirmado nuevo</option>
                  <option value="03">03 · Confirmado repetido</option>
                </select>
              </Field>
              <Field label="Finalidad de la consulta *" hint="Código de 2 dígitos según tabla RIPS">
                <input value={dx.finalidad} onChange={setD('finalidad')} disabled={!editable} pattern="[0-9]{2}" />
              </Field>
              <Field label="Causa / motivo de atención *" hint="Código de 2 dígitos según tabla RIPS">
                <input value={dx.causa_externa} onChange={setD('causa_externa')} disabled={!editable} pattern="[0-9]{2}" />
              </Field>
            </div>
          </section>

          {e.estado === 'firmado' && (
            <section className="card">
              <div className="card-head">
                <h2>Firma</h2>
                <button className="btn btn-sm" onClick={verificar}>
                  Verificar
                </button>
              </div>
              <div className="firma-box">
                Firmada el {fechaHora(e.firmado_at)}
                <div className="mono" style={{ marginTop: '0.35rem' }}>
                  SHA-256 {e.content_hash}
                </div>
              </div>
              {verificacion && (
                <p style={{ marginTop: '0.6rem' }}>
                  {verificacion.valido ? (
                    <Badge tono="ok">Íntegra · firma válida</Badge>
                  ) : (
                    <Badge tono="error">Alerta: el registro no coincide con la firma</Badge>
                  )}{' '}
                  {verificacion.notas.length > 0 && <span className="muted">{verificacion.notas.length} nota(s) verificada(s)</span>}
                </p>
              )}
            </section>
          )}

          <Ordenes
            encounterId={id}
            ordenes={e.orders}
            editable={e.professional_id === me.id}
            onCambio={cargar}
            pedirPin={(titulo, accion) => setFirma({ titulo, accion })}
          />
        </div>
      </div>

      <Modal titulo={firma?.titulo ?? 'Firmar'} abierto={!!firma} onCerrar={() => setFirma(null)}>
        {firma && <PinModal titulo={firma.titulo} onCerrar={() => setFirma(null)} onFirmar={firma.accion} />}
      </Modal>

      <Modal titulo="Nota aclaratoria" abierto={nota} onCerrar={() => setNota(false)}>
        <NotaForm
          encounterId={id}
          onListo={async () => {
            setNota(false);
            setAviso('Nota aclaratoria firmada');
            await cargar();
          }}
        />
      </Modal>
    </>
  );
}

function NotaForm({ encounterId, onListo }: { encounterId: string; onListo: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [texto, setTexto] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    setError('');
    try {
      await api.post(`/encounters/${encounterId}/addenda`, { motivo, texto, pin });
      onListo();
    } catch (e) {
      setError(mensajeError(e));
      setPin('');
    }
  }

  return (
    <form onSubmit={enviar} className="stack">
      <Alert>{error}</Alert>
      <Field label="Motivo">
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} minLength={5} maxLength={300} required />
      </Field>
      <Field label="Texto de la nota">
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} minLength={5} required rows={5} />
      </Field>
      <Field label="PIN de firma">
        <input type="password" inputMode="numeric" pattern="[0-9]{6,12}" value={pin} onChange={(e) => setPin(e.target.value)} required autoComplete="off" />
      </Field>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-primary">Firmar nota</button>
      </div>
    </form>
  );
}
