// By Kompilador
const UNIDADES = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
  'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte',
  'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos',
  'setecientos', 'ochocientos', 'novecientos'];

function menorMil(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cien';
  const c = Math.floor(n / 100);
  const r = n % 100;
  let resto: string;
  if (r < 30) resto = UNIDADES[r]!;
  else {
    const d = Math.floor(r / 10);
    const u = r % 10;
    resto = u === 0 ? DECENAS[d]! : `${DECENAS[d]} y ${UNIDADES[u]}`;
  }
  return [CENTENAS[c], resto].filter(Boolean).join(' ');
}

export function numeroALetras(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) throw new Error('Fuera de rango');
  if (n === 0) return 'cero';
  const miles = Math.floor(n / 1000);
  const resto = n % 1000;
  const parteMiles = miles === 0 ? '' : miles === 1 ? 'mil' : `${menorMil(miles).replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un')} mil`;
  return [parteMiles, menorMil(resto)].filter(Boolean).join(' ');
}
