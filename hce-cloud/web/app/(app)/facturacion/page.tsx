// By Kompilador
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Encabezado, Estado, Field, Modal, Vacio } from '@/components/ui';
import { api, fechaHora, hoyBogota, mensajeError, pesos } from '@/lib/api';

const PAGADOR_VACIO = { tipo: 'eps', tipo_documento: 'NI', numero_documento: '', nombre: '' };

export default function FacturacionPage() {
  const [fecha, setFecha] = useState(hoyBogota());
  const [admisiones, setAdmisiones] = useState<any[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [facturas, setFacturas] = useState<any[]>([]);
  const [pagador, setPagador] = useState(PAGADOR_VACIO);
  const [contrato, setContrato] = useState({ modalidad_pago: '', numero_contrato: '' });
  const [preview, setPreview] = useState<any>(null);
  const [detalle, setDetalle] = useState<any>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(async () => {
    try {
      const [a, f] = await Promise.all([api.get(`/admissions?fecha=${fecha}&estado=cerrada`), api.get('/billing/invoices')]);
      setAdmisiones(a);
      setFacturas(f);
      setSel(new Set());
    } catch (e) {
      setError(mensajeError(e));
    }
  }, [fecha]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const facturables = admisiones.filter((a) => !a.facturada && a.encounter_estado === 'firmado');
  const seleccion = facturables.filter((a) => sel.has(a.id));
  const total = seleccion.reduce((s, a) => s + a.valor_servicio - a.valor_pago_moderador, 0);

  function alternar(id: string) {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSel(n);
  }

  async function previsualizar() {
    setError('');
    try {
      setPreview(await api.post('/billing/rips/preview', { admission_ids: [...sel] }));
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  async function crear() {
    setError('');
    try {
      const f = await api.post('/billing/invoices', {
        admission_ids: [...sel],
        pagador,
        ...(contrato.modalidad_pago ? { modalidad_pago: contrato.modalidad_pago } : {}),
        ...(contrato.numero_contrato ? { numero_contrato: contrato.numero_contrato } : {}),
      });
      setAviso(`Factura en borrador por ${pesos(f.total)}. Emítala para enviarla a la DIAN y generar los RIPS.`);
      setPreview(null);
      cargar();
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  async function emitir(f: any) {
    setError('');
    try {
      const r = await api.post(`/billing/invoices/${f.id}/emitir`);
      setAviso(
        r.estado === 'validada'
          ? `Factura ${r.prefijo}${r.numero} emitida y RIPS validados (CUV ${r.cuv.slice(0, 12)}…)`
          : `Factura ${r.prefijo}${r.numero} emitida, pero los RIPS fueron rechazados. Revise el detalle.`,
      );
      cargar();
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  async function verDetalle(f: any) {
    try {
      setDetalle(await api.get(`/billing/invoices/${f.id}`));
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  const setP = (k: keyof typeof PAGADOR_VACIO) => (e: { target: { value: string } }) => setPagador({ ...pagador, [k]: e.target.value });

  return (
    <>
      <Encabezado titulo="Facturación" sub="FEV del sector salud con RIPS como soporte (Res. 2275 de 2023)">
        <Field label="Fecha de atención">
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Field>
      </Encabezado>
      <Alert>{error}</Alert>
      <Alert tipo="ok">{aviso}</Alert>

      <div className="cols-main">
        <section className="card">
          <div className="card-head">
            <h2>Atenciones cerradas</h2>
            <span className="muted">{facturables.length} pendientes de facturar</span>
          </div>
          {admisiones.length === 0 ? (
            <Vacio>Sin atenciones cerradas en esta fecha.</Vacio>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th />
                    <th>Paciente</th>
                    <th>Profesional</th>
                    <th>CUPS</th>
                    <th>Valor</th>
                    <th>Moderador</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {admisiones.map((a) => {
                    const ok = !a.facturada && a.encounter_estado === 'firmado';
                    return (
                      <tr key={a.id}>
                        <td>
                          <input type="checkbox" disabled={!ok} checked={sel.has(a.id)} onChange={() => alternar(a.id)} aria-label={`Seleccionar ${a.paciente}`} />
                        </td>
                        <td>
                          {a.paciente}
                          <div className="muted">
                            {a.tipo_documento} {a.numero_documento}
                            {a.num_autorizacion ? ` · Aut. ${a.num_autorizacion}` : ''}
                          </div>
                        </td>
                        <td>{a.profesional}</td>
                        <td>{a.cod_consulta}</td>
                        <td>{pesos(a.valor_servicio)}</td>
                        <td>{pesos(a.valor_pago_moderador)}</td>
                        <td>{a.facturada ? <Badge tono="ok">facturada</Badge> : <span className="muted">Pendiente</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Nueva factura</h2>
          </div>
          <div className="stack">
            <Field label="Tipo de pagador">
              <select value={pagador.tipo} onChange={setP('tipo')}>
                <option value="eps">EPS / EAPB</option>
                <option value="particular">Particular</option>
                <option value="otro">Otro</option>
              </select>
            </Field>
            <div className="grid-2">
              <Field label="Tipo doc.">
                <input value={pagador.tipo_documento} onChange={setP('tipo_documento')} maxLength={3} />
              </Field>
              <Field label="Número">
                <input value={pagador.numero_documento} onChange={setP('numero_documento')} />
              </Field>
            </div>
            <Field label="Nombre o razón social">
              <input value={pagador.nombre} onChange={setP('nombre')} />
            </Field>
            <div className="grid-2">
              <Field label="Modalidad de pago" hint="Código de 2 dígitos">
                <input value={contrato.modalidad_pago} onChange={(e) => setContrato({ ...contrato, modalidad_pago: e.target.value })} pattern="[0-9]{2}" />
              </Field>
              <Field label="N.º de contrato">
                <input value={contrato.numero_contrato} onChange={(e) => setContrato({ ...contrato, numero_contrato: e.target.value })} />
              </Field>
            </div>
            <p>
              <strong>{seleccion.length}</strong> atención(es) · Total a cargo del pagador <strong>{pesos(total)}</strong>
            </p>
            <div className="row">
              <button className="btn" disabled={sel.size === 0} onClick={previsualizar}>
                Prevalidar RIPS
              </button>
              <button className="btn btn-primary" disabled={sel.size === 0 || !pagador.numero_documento || !pagador.nombre} onClick={crear}>
                Crear factura
              </button>
            </div>
            {preview && (
              <Alert tipo={preview.hallazgos.length ? 'warn' : 'ok'}>
                {preview.hallazgos.length
                  ? preview.hallazgos.map((h: any) => `${h.ruta}: ${h.mensaje}`).join(' · ')
                  : `RIPS sin hallazgos: ${preview.rips.usuarios.length} usuario(s).`}
              </Alert>
            )}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Facturas</h2>
        </div>
        {facturas.length === 0 ? (
          <Vacio>Aún no hay facturas.</Vacio>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Pagador</th>
                  <th>Total</th>
                  <th>Emisión</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {facturas.map((f) => (
                  <tr key={f.id}>
                    <td>{f.numero ? `${f.prefijo}${f.numero}` : '—'}</td>
                    <td>{f.pagador.nombre}</td>
                    <td>{pesos(f.total)}</td>
                    <td>{fechaHora(f.fecha_emision)}</td>
                    <td>
                      <Estado valor={f.estado} />
                    </td>
                    <td className="acciones">
                      {f.estado === 'borrador' && (
                        <button className="btn btn-sm btn-primary" onClick={() => emitir(f)}>
                          Emitir
                        </button>
                      )}
                      {f.cufe && (
                        <a className="btn btn-sm" href={`/api/billing/invoices/${f.id}/rips`} download>
                          RIPS JSON
                        </a>
                      )}
                      <button className="btn btn-sm" onClick={() => verDetalle(f)}>
                        Detalle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal titulo="Detalle de factura" abierto={!!detalle} onCerrar={() => setDetalle(null)}>
        {detalle && (
          <dl className="kv">
            <dt>Estado</dt>
            <dd>
              <Estado valor={detalle.estado} />
            </dd>
            <dt>Número</dt>
            <dd>{detalle.numero ? `${detalle.prefijo}${detalle.numero}` : '—'}</dd>
            <dt>Pagador</dt>
            <dd>
              {detalle.pagador.nombre} ({detalle.pagador.tipo_documento} {detalle.pagador.numero_documento})
            </dd>
            <dt>Total</dt>
            <dd>{pesos(detalle.total)}</dd>
            <dt>Atenciones</dt>
            <dd>{detalle.items.length}</dd>
            <dt>Proveedor</dt>
            <dd>{detalle.proveedor ?? '—'}</dd>
            <dt>CUFE</dt>
            <dd className="mono">{detalle.cufe ?? '—'}</dd>
            <dt>CUV</dt>
            <dd className="mono">{detalle.cuv ?? '—'}</dd>
            {detalle.respuesta_validacion?.hallazgos?.length > 0 && (
              <>
                <dt>Hallazgos</dt>
                <dd>{detalle.respuesta_validacion.hallazgos.map((h: any) => `${h.ruta}: ${h.mensaje}`).join(' · ')}</dd>
              </>
            )}
          </dl>
        )}
      </Modal>
    </>
  );
}
