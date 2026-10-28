// By Kompilador
export function detectarDelimitador(primeraLinea: string): string {
  const candidatos = [',', ';', '\t', '|'];
  let mejor = ',';
  let max = -1;
  for (const c of candidatos) {
    const n = primeraLinea.split(c).length;
    if (n > max) {
      max = n;
      mejor = c;
    }
  }
  return mejor;
}

export function parseCsv(texto: string, delimitador?: string): string[][] {
  const limpio = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  const d = delimitador ?? detectarDelimitador(limpio.slice(0, limpio.indexOf('\n') >>> 0));
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i]!;
    if (comillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"';
          i++;
        } else comillas = false;
      } else campo += c;
      continue;
    }
    if (c === '"' && campo === '') comillas = true;
    else if (c === d) {
      fila.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && limpio[i + 1] === '\n') i++;
      fila.push(campo);
      if (fila.some((v) => v.trim() !== '')) filas.push(fila);
      fila = [];
      campo = '';
    } else campo += c;
  }
  if (campo !== '' || fila.length) {
    fila.push(campo);
    if (fila.some((v) => v.trim() !== '')) filas.push(fila);
  }
  return filas;
}

export function aObjetos(filas: string[][]): { encabezados: string[]; registros: Record<string, string>[] } {
  const [encabezados = [], ...resto] = filas;
  const enc = encabezados.map((h) => h.trim());
  return {
    encabezados: enc,
    registros: resto.map((f) => Object.fromEntries(enc.map((h, i) => [h, (f[i] ?? '').trim()]))),
  };
}
