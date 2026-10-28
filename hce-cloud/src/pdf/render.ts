// By Kompilador
import PDFDocument from 'pdfkit';
import { numeroALetras } from '../lib/numeros.js';
import type { Template } from '../modules/clinical/templates.js';

type Doc = InstanceType<typeof PDFDocument>;

const TZ = 'America/Bogota';
const fmt = (d: Date | string | null | undefined) =>
  d
    ? new Intl.DateTimeFormat('es-CO', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short', hour12: false }).format(new Date(d))
    : '';

function edad(fechaNacimiento: string, ref: Date): string {
  const n = new Date(`${fechaNacimiento}T00:00:00-05:00`);
  let anos = ref.getFullYear() - n.getFullYear();
  const m = ref.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < n.getDate())) anos--;
  if (anos >= 2) return `${anos} años`;
  const meses = (ref.getFullYear() - n.getFullYear()) * 12 + ref.getMonth() - n.getMonth() - (ref.getDate() < n.getDate() ? 1 : 0);
  return `${meses} meses`;
}

function toBuffer(build: (doc: Doc) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 50, bottom: 60, left: 50, right: 50 }, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const y = doc.page.height - 45;
      doc.page.margins.bottom = 0;
      doc
        .fontSize(7)
        .fillColor('#666')
        .text(
          `Documento confidencial — Res. 1995/1999 y Ley 1581/2012. Página ${i + 1} de ${range.count}`,
          50,
          y,
          { width: doc.page.width - 100, align: 'center' },
        );
    }
    doc.end();
  });
}

function encabezado(doc: Doc, tenant: any, titulo: string) {
  doc.fillColor('#000').fontSize(13).font('Helvetica-Bold').text(tenant.razon_social, { align: 'center' });
  doc
    .fontSize(8)
    .font('Helvetica')
    .text(
      `NIT ${tenant.nit}${tenant.dv ? `-${tenant.dv}` : ''} · Código de prestador ${tenant.codigo_prestador}` +
        (tenant.direccion ? ` · ${tenant.direccion}` : '') +
        (tenant.telefono ? ` · Tel. ${tenant.telefono}` : ''),
      { align: 'center' },
    );
  doc.moveDown(0.6).fontSize(12).font('Helvetica-Bold').text(titulo, { align: 'center' });
  doc.moveDown(0.6);
}

function bloquePaciente(doc: Doc, p: any, fecha: Date) {
  const nombre = [p.primer_nombre, p.segundo_nombre, p.primer_apellido, p.segundo_apellido].filter(Boolean).join(' ');
  doc.fontSize(9).font('Helvetica-Bold').text('Paciente: ', { continued: true }).font('Helvetica').text(nombre);
  doc
    .font('Helvetica-Bold')
    .text('Documento: ', { continued: true })
    .font('Helvetica')
    .text(
      `${p.tipo_documento} ${p.numero_documento}   Nacimiento: ${p.fecha_nacimiento} (${edad(p.fecha_nacimiento, fecha)})   Sexo: ${p.sexo}`,
    );
  if (p.eps_nombre) doc.font('Helvetica-Bold').text('Asegurador: ', { continued: true }).font('Helvetica').text(p.eps_nombre);
  doc.moveDown(0.5);
  linea(doc);
}

function linea(doc: Doc) {
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor('#bbb').stroke().moveDown(0.4);
}

function valorTexto(v: unknown): string {
  if (v === true) return 'Sí';
  if (v === false) return 'No';
  return String(v);
}

function bloqueFirma(doc: Doc, prof: any, firmadoAt: Date | string, hash: string, fingerprint: string) {
  doc.moveDown(0.8);
  linea(doc);
  doc.fontSize(9).font('Helvetica-Bold').text('Firmado electrónicamente por');
  doc
    .font('Helvetica')
    .text(`${prof.nombre} · ${prof.tipo_documento} ${prof.numero_documento}`)
    .text(`Registro profesional: ${prof.registro_profesional ?? 'N/D'}${prof.especialidad ? ` · ${prof.especialidad}` : ''}`)
    .text(`Fecha de firma: ${fmt(firmadoAt)}`);
  doc
    .fontSize(7)
    .fillColor('#444')
    .text(`SHA-256 del registro: ${hash}`)
    .text(`Huella de la llave Ed25519: ${fingerprint}`)
    .fillColor('#000');
}

export function renderHistoriaPdf(data: {
  tenant: any;
  patient: any;
  encounter: any;
  professional: any;
  template: Template;
  fingerprint: string | null;
  addenda: any[];
}): Promise<Buffer> {
  const { tenant, patient, encounter: e, professional, template, addenda } = data;
  return toBuffer((doc) => {
    encabezado(doc, tenant, `HISTORIA CLÍNICA — ${template.nombre.toUpperCase()}`);
    bloquePaciente(doc, patient, new Date(e.iniciado_at));
    doc
      .fontSize(9)
      .font('Helvetica')
      .text(`Fecha de atención: ${fmt(e.iniciado_at)}   Estado: ${e.estado === 'firmado' ? 'FIRMADA' : 'BORRADOR (sin validez)'}`)
      .moveDown(0.5);

    for (const sec of template.sections) {
      const valores = (e.contenido?.[sec.key] ?? {}) as Record<string, unknown>;
      const campos = sec.fields.filter((f) => valores[f.key] !== undefined && valores[f.key] !== null && valores[f.key] !== '');
      if (campos.length === 0) continue;
      doc.fontSize(10).font('Helvetica-Bold').text(sec.label.toUpperCase()).moveDown(0.2);
      for (const f of campos) {
        doc
          .fontSize(9)
          .font('Helvetica-Bold')
          .text(`${f.label}: `, { continued: true })
          .font('Helvetica')
          .text(`${valorTexto(valores[f.key])}${f.unit && f.type === 'number' ? ` ${f.unit}` : ''}`);
      }
      doc.moveDown(0.4);
    }

    doc.fontSize(10).font('Helvetica-Bold').text('DIAGNÓSTICOS (CIE-10)').moveDown(0.2);
    doc
      .fontSize(9)
      .font('Helvetica')
      .text(`Principal: ${e.diagnostico_principal ?? '—'} (tipo ${e.tipo_diagnostico_principal ?? '—'})`);
    if (e.diagnosticos_relacionados?.length) doc.text(`Relacionados: ${e.diagnosticos_relacionados.join(', ')}`);
    doc.text(`Finalidad: ${e.finalidad ?? '—'}   Causa externa: ${e.causa_externa ?? '—'}`);

    if (e.estado === 'firmado') bloqueFirma(doc, professional, e.firmado_at, e.content_hash, data.fingerprint ?? '');

    if (addenda.length > 0) {
      doc.moveDown(0.8).fontSize(10).font('Helvetica-Bold').text('NOTAS ACLARATORIAS');
      for (const a of addenda) {
        doc.moveDown(0.3).fontSize(9).font('Helvetica-Bold').text(`${fmt(a.created_at)} — ${a.autor_nombre}`);
        doc.font('Helvetica-Oblique').text(`Motivo: ${a.motivo}`).font('Helvetica').text(a.texto);
        doc.fontSize(7).fillColor('#444').text(`SHA-256: ${a.content_hash} · Llave: ${a.fingerprint}`).fillColor('#000');
      }
    }
  });
}

const TITULOS: Record<string, string> = {
  formula: 'FÓRMULA MÉDICA',
  procedimiento: 'ORDEN DE PROCEDIMIENTOS',
  laboratorio: 'ORDEN DE LABORATORIO CLÍNICO',
  imagen: 'ORDEN DE IMÁGENES DIAGNÓSTICAS',
  interconsulta: 'ORDEN DE INTERCONSULTA',
};

export function renderOrdenPdf(data: {
  tenant: any;
  patient: any;
  order: any;
  professional: any;
  diagnostico: string | null;
  fingerprint: string | null;
}): Promise<Buffer> {
  const { tenant, patient, order: o, professional } = data;
  return toBuffer((doc) => {
    encabezado(doc, tenant, `${TITULOS[o.tipo] ?? 'ORDEN'} N.º ${o.consecutivo}`);
    bloquePaciente(doc, patient, new Date(o.created_at));
    doc.fontSize(9).font('Helvetica').text(`Diagnóstico: ${data.diagnostico ?? '—'}   Fecha: ${fmt(o.firmado_at ?? o.created_at)}`);
    doc.moveDown(0.5);

    o.items.forEach((it: any, i: number) => {
      if (o.tipo === 'formula') {
        doc
          .fontSize(10)
          .font('Helvetica-Bold')
          .text(`${i + 1}. ${it.nombre} ${it.concentracion} — ${it.forma_farmaceutica}${it.cum ? ` (CUM ${it.cum})` : ''}`);
        doc
          .fontSize(9)
          .font('Helvetica')
          .text(`Vía ${it.via}. ${it.dosis} cada ${it.frecuencia} durante ${it.duracion_dias} día(s).`)
          .text(`Cantidad total: ${it.cantidad} (${numeroALetras(it.cantidad)}) ${it.unidad ?? ''}`.trim());
        if (it.indicaciones) doc.text(`Indicaciones: ${it.indicaciones}`);
      } else {
        doc.fontSize(10).font('Helvetica-Bold').text(`${i + 1}. [${it.cups}] ${it.descripcion}`);
        doc
          .fontSize(9)
          .font('Helvetica')
          .text(`Cantidad: ${it.cantidad} (${numeroALetras(it.cantidad)})   Prioridad: ${it.prioridad ?? 'rutinaria'}`);
        if (it.justificacion) doc.text(`Justificación: ${it.justificacion}`);
      }
      doc.moveDown(0.4);
    });

    if (o.observaciones) doc.fontSize(9).font('Helvetica-Bold').text('Observaciones: ', { continued: true }).font('Helvetica').text(o.observaciones);
    if (o.estado === 'firmado') bloqueFirma(doc, professional, o.firmado_at, o.content_hash, data.fingerprint ?? '');
    else doc.moveDown().fontSize(11).fillColor('#b00').text('BORRADOR — SIN VALIDEZ', { align: 'center' }).fillColor('#000');
  });
}
