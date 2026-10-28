// By Kompilador
// Contratos para el proveedor tecnológico de facturación electrónica (DIAN) y para el
// Mecanismo Único de Validación de RIPS (MinSalud). Las implementaciones sandbox permiten
// operar el flujo completo mientras se contrata e integra el proveedor real.
import { createHash } from 'node:crypto';
import { canonicalize } from '../../lib/canonical.js';
import { prevalidarRips, type Hallazgo, type RipsDocumento } from './rips.js';

export type FacturaSalud = {
  emisor: { nit: string; dv: string | null; razonSocial: string; codigoPrestador: string };
  adquirente: { tipo: 'eps' | 'particular' | 'otro'; tipoDocumento: string; numeroDocumento: string; nombre: string };
  items: Array<{ codigo: string; descripcion: string; cantidad: number; valorUnitario: number; valorPagoModerador: number }>;
  sectorSalud: {
    modalidadPago: string | null;
    numeroContrato: string | null;
    usuarios: Array<{ tipoDocumento: string; numeroDocumento: string; tipoUsuario: string; numAutorizacion: string | null }>;
  };
  totalServicios: number;
  totalPagoModerador: number;
  totalAPagar: number;
  consecutivoSugerido: number;
};

export type FacturaEmitida = {
  prefijo: string;
  numero: string;
  cufe: string;
  fechaEmision: Date;
  referencia: string;
  xmlBase64: string;
};

export interface ProveedorFEV {
  readonly nombre: string;
  emitir(factura: FacturaSalud): Promise<FacturaEmitida>;
}

export type ResultadoValidacionRips = {
  aprobado: boolean;
  cuv: string | null;
  hallazgos: Hallazgo[];
};

export interface ValidadorRips {
  readonly nombre: string;
  validar(input: { xmlFevBase64: string; rips: RipsDocumento }): Promise<ResultadoValidacionRips>;
}

export class SandboxFEV implements ProveedorFEV {
  readonly nombre = 'sandbox';

  async emitir(f: FacturaSalud): Promise<FacturaEmitida> {
    const prefijo = 'SETT';
    const numero = String(f.consecutivoSugerido);
    const fechaEmision = new Date();
    const cufe = createHash('sha384')
      .update(
        [prefijo + numero, fechaEmision.toISOString(), f.totalAPagar.toFixed(2), f.emisor.nit, f.adquirente.numeroDocumento, 'sandbox'].join(
          '|',
        ),
      )
      .digest('hex');
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?><Invoice ambiente="sandbox"><ID>${prefijo}${numero}</ID>` +
      `<UUID schemeName="CUFE-SHA384">${cufe}</UUID><Total>${f.totalAPagar.toFixed(2)}</Total></Invoice>`;
    return { prefijo, numero, cufe, fechaEmision, referencia: `sandbox-${cufe.slice(0, 12)}`, xmlBase64: Buffer.from(xml).toString('base64') };
  }
}

export class SandboxValidadorRips implements ValidadorRips {
  readonly nombre = 'sandbox';

  async validar({ rips }: { xmlFevBase64: string; rips: RipsDocumento }): Promise<ResultadoValidacionRips> {
    const hallazgos = prevalidarRips(rips);
    if (hallazgos.length > 0) return { aprobado: false, cuv: null, hallazgos };
    const cuv = createHash('sha384').update(canonicalize(rips)).digest('hex');
    return { aprobado: true, cuv, hallazgos: [] };
  }
}

export function crearProveedorFEV(nombre: string): ProveedorFEV {
  if (nombre === 'sandbox') return new SandboxFEV();
  throw new Error(`Proveedor FEV no soportado: ${nombre}`);
}

export function crearValidadorRips(nombre: string): ValidadorRips {
  if (nombre === 'sandbox') return new SandboxValidadorRips();
  throw new Error(`Validador RIPS no soportado: ${nombre}`);
}
