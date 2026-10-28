// By Kompilador
export function normalizarTexto(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s.+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizarEncabezado(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function normalizarCie10(c: string): string {
  return c.toUpperCase().replace(/[.\s-]/g, '');
}

export function normalizarCups(c: string): string {
  return c.toUpperCase().replace(/[.\s-]/g, '');
}

export function aBooleano(v: string | undefined, porDefecto: boolean): boolean {
  if (v === undefined || v.trim() === '') return porDefecto;
  const n = normalizarEncabezado(v);
  if (['si', 's', 'true', '1', 'activo', 'vigente', 'habilitado', 'yes', 'y'].includes(n)) return true;
  if (['no', 'n', 'false', '0', 'inactivo', 'vencido', 'deshabilitado', 'cancelado', 'suspendido'].includes(n)) return false;
  return porDefecto;
}

export function aSexo(v: string | undefined): 'H' | 'M' | null {
  if (!v) return null;
  const n = normalizarEncabezado(v);
  if (['h', 'hombre', 'masculino'].includes(n)) return 'H';
  if (['m', 'mujer', 'f', 'femenino'].includes(n)) return 'M';
  return null;
}

export function aEdad(v: string | undefined): number | null {
  if (!v || !/^\d{1,3}$/.test(v.trim())) return null;
  const n = Number(v.trim());
  return n <= 150 ? n : null;
}
