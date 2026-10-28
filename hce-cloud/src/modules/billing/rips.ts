// By Kompilador
// Estructura RIPS en JSON como soporte de la FEV (Resolución 2275 de 2023). Alcance actual: consultas.

export type RipsConsulta = {
  codPrestador: string;
  fechaInicioAtencion: string;
  numAutorizacion: string | null;
  codConsulta: string;
  modalidadGrupoServicioTecSal: string;
  grupoServicios: string;
  codServicio: number;
  finalidadTecnologiaSalud: string;
  causaMotivoAtencion: string;
  codDiagnosticoPrincipal: string;
  codDiagnosticoRelacionado1: string | null;
  codDiagnosticoRelacionado2: string | null;
  codDiagnosticoRelacionado3: string | null;
  tipoDiagnosticoPrincipal: string;
  tipoDocumentoIdentificacion: string;
  numDocumentoIdentificacion: string;
  vrServicio: number;
  conceptoRecaudo: string;
  valorPagoModerador: number;
  numFEVPagoModerador: string | null;
  consecutivo: number;
};

export type RipsUsuario = {
  tipoDocumentoIdentificacion: string;
  numDocumentoIdentificacion: string;
  tipoUsuario: string;
  fechaNacimiento: string;
  codSexo: string;
  codPaisResidencia: string;
  codMunicipioResidencia: string | null;
  codZonaTerritorialResidencia: string | null;
  incapacidad: 'SI' | 'NO';
  consecutivo: number;
  codPaisOrigen: string;
  servicios: { consultas: RipsConsulta[] };
};

export type RipsDocumento = {
  numDocumentoIdObligado: string;
  numFactura: string;
  tipoNota: string | null;
  numNota: string | null;
  usuarios: RipsUsuario[];
};

export type AtencionFacturable = {
  patient: any;
  admission: any;
  encounter: any;
  professional: { tipo_documento: string; numero_documento: string };
};

export function fechaHoraColombia(d: Date | string): string {
  const t = new Date(new Date(d).getTime() - 5 * 3600_000);
  return t.toISOString().slice(0, 16).replace('T', ' ');
}

export function buildRips(input: {
  nitObligado: string;
  codPrestador: string;
  numFactura: string;
  atenciones: AtencionFacturable[];
}): RipsDocumento {
  const porUsuario = new Map<string, AtencionFacturable[]>();
  for (const a of input.atenciones) {
    const lista = porUsuario.get(a.patient.id) ?? [];
    lista.push(a);
    porUsuario.set(a.patient.id, lista);
  }

  let consecutivoUsuario = 0;
  const usuarios: RipsUsuario[] = [];
  for (const lista of porUsuario.values()) {
    const p = lista[0]!.patient;
    lista.sort((x, y) => new Date(x.encounter.iniciado_at).getTime() - new Date(y.encounter.iniciado_at).getTime());
    usuarios.push({
      tipoDocumentoIdentificacion: p.tipo_documento,
      numDocumentoIdentificacion: p.numero_documento,
      tipoUsuario: lista[0]!.admission.tipo_usuario,
      fechaNacimiento: p.fecha_nacimiento,
      codSexo: p.sexo,
      codPaisResidencia: p.pais_residencia,
      codMunicipioResidencia: p.municipio_residencia,
      codZonaTerritorialResidencia: p.zona_residencia,
      incapacidad: 'NO',
      consecutivo: ++consecutivoUsuario,
      codPaisOrigen: p.pais_origen,
      servicios: {
        consultas: lista.map(({ admission: ad, encounter: e, professional: pr }, i) => ({
          codPrestador: input.codPrestador,
          fechaInicioAtencion: fechaHoraColombia(e.iniciado_at),
          numAutorizacion: ad.num_autorizacion,
          codConsulta: ad.cod_consulta,
          modalidadGrupoServicioTecSal: ad.modalidad,
          grupoServicios: ad.grupo_servicios,
          codServicio: Number(ad.cod_servicio),
          finalidadTecnologiaSalud: e.finalidad,
          causaMotivoAtencion: e.causa_externa,
          codDiagnosticoPrincipal: e.diagnostico_principal,
          codDiagnosticoRelacionado1: e.diagnosticos_relacionados[0] ?? null,
          codDiagnosticoRelacionado2: e.diagnosticos_relacionados[1] ?? null,
          codDiagnosticoRelacionado3: e.diagnosticos_relacionados[2] ?? null,
          tipoDiagnosticoPrincipal: e.tipo_diagnostico_principal,
          tipoDocumentoIdentificacion: pr.tipo_documento,
          numDocumentoIdentificacion: pr.numero_documento,
          vrServicio: Number(ad.valor_servicio),
          conceptoRecaudo: ad.concepto_recaudo,
          valorPagoModerador: Number(ad.valor_pago_moderador),
          numFEVPagoModerador: null,
          consecutivo: i + 1,
        })),
      },
    });
  }

  return {
    numDocumentoIdObligado: input.nitObligado,
    numFactura: input.numFactura,
    tipoNota: null,
    numNota: null,
    usuarios,
  };
}

export type Hallazgo = { ruta: string; mensaje: string };

export function prevalidarRips(doc: RipsDocumento): Hallazgo[] {
  const h: Hallazgo[] = [];
  const req = (ruta: string, v: unknown, re?: RegExp) => {
    if (v === null || v === undefined || v === '') h.push({ ruta, mensaje: 'Campo obligatorio' });
    else if (re && !re.test(String(v))) h.push({ ruta, mensaje: `Formato inválido: ${String(v)}` });
  };
  req('numDocumentoIdObligado', doc.numDocumentoIdObligado, /^[0-9]{5,15}$/);
  req('numFactura', doc.numFactura, /^[A-Za-z0-9-]{1,20}$/);
  if (doc.usuarios.length === 0) h.push({ ruta: 'usuarios', mensaje: 'Debe incluir al menos un usuario' });
  doc.usuarios.forEach((u, i) => {
    const b = `usuarios[${i}]`;
    req(`${b}.tipoDocumentoIdentificacion`, u.tipoDocumentoIdentificacion, /^[A-Z]{2}$/);
    req(`${b}.numDocumentoIdentificacion`, u.numDocumentoIdentificacion);
    req(`${b}.tipoUsuario`, u.tipoUsuario, /^[0-9]{2}$/);
    req(`${b}.fechaNacimiento`, u.fechaNacimiento, /^\d{4}-\d{2}-\d{2}$/);
    req(`${b}.codSexo`, u.codSexo, /^[HMI]$/);
    req(`${b}.codPaisResidencia`, u.codPaisResidencia, /^[0-9]{3}$/);
    if (u.codPaisResidencia === '170') {
      req(`${b}.codMunicipioResidencia`, u.codMunicipioResidencia, /^[0-9]{5}$/);
      req(`${b}.codZonaTerritorialResidencia`, u.codZonaTerritorialResidencia, /^0[12]$/);
    }
    u.servicios.consultas.forEach((c, j) => {
      const cb = `${b}.servicios.consultas[${j}]`;
      req(`${cb}.codPrestador`, c.codPrestador, /^[0-9]{12}$/);
      req(`${cb}.fechaInicioAtencion`, c.fechaInicioAtencion, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
      req(`${cb}.codConsulta`, c.codConsulta, /^[0-9A-Z]{6}$/);
      req(`${cb}.codServicio`, c.codServicio, /^[0-9]{3,4}$/);
      req(`${cb}.finalidadTecnologiaSalud`, c.finalidadTecnologiaSalud, /^[0-9]{2}$/);
      req(`${cb}.causaMotivoAtencion`, c.causaMotivoAtencion, /^[0-9]{2}$/);
      req(`${cb}.codDiagnosticoPrincipal`, c.codDiagnosticoPrincipal, /^[A-Z][0-9]{2}[0-9X]?$/);
      req(`${cb}.tipoDiagnosticoPrincipal`, c.tipoDiagnosticoPrincipal, /^0[123]$/);
      req(`${cb}.numDocumentoIdentificacion`, c.numDocumentoIdentificacion);
      if (!(c.vrServicio >= 0)) h.push({ ruta: `${cb}.vrServicio`, mensaje: 'Valor inválido' });
      if (c.valorPagoModerador > c.vrServicio) {
        h.push({ ruta: `${cb}.valorPagoModerador`, mensaje: 'El pago moderador supera el valor del servicio' });
      }
    });
  });
  return h;
}
