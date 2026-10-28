// By Kompilador
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detalle?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (m: string, d?: unknown) => new HttpError(400, m, d);
export const unauthorized = (m = 'No autenticado') => new HttpError(401, m);
export const forbidden = (m = 'Acceso denegado') => new HttpError(403, m);
export const notFound = (m = 'No encontrado') => new HttpError(404, m);
export const conflict = (m: string, d?: unknown) => new HttpError(409, m, d);

export function orNotFound<T>(v: T, m?: string): NonNullable<T> {
  if (v === undefined || v === null) throw notFound(m);
  return v as NonNullable<T>;
}
