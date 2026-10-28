// By Kompilador
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detalle?: unknown,
  ) {
    super(message);
  }
}

type Metodo = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function request<T>(method: Metodo, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    headers: {
      'x-hce-request': '1',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (r.status === 401 && path !== '/session') {
    window.location.href = '/login?expirada=1';
    throw new ApiError(401, 'Sesión expirada');
  }
  const data = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, data?.error ?? 'Error inesperado', data?.detalle);
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  patch: <T = any>(p: string, b: unknown) => request<T>('PATCH', p, b),
  del: <T = any>(p: string) => request<T>('DELETE', p),
};

export function mensajeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (Array.isArray(e.detalle) && e.detalle.length) {
      const items = e.detalle.map((d: any) => (typeof d === 'string' ? d : d.campo ? `${d.campo}: ${d.mensaje}` : d.mensaje ?? d.ruta));
      return `${e.message}: ${items.join(' · ')}`;
    }
    return e.message;
  }
  return 'No fue posible completar la operación';
}

export function hoyBogota(offsetDias = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(Date.now() + offsetDias * 86_400_000));
}

export function fechaHora(d: string | null | undefined): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d));
}

export function hora(d: string): string {
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
}

export function pesos(n: number): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
}

export function nombrePaciente(p: any): string {
  return [p.primer_nombre, p.segundo_nombre, p.primer_apellido, p.segundo_apellido].filter(Boolean).join(' ');
}
