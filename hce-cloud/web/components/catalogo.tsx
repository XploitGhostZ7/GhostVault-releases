// By Kompilador
'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '@/lib/api';

export type TipoCatalogo = 'cie10' | 'cups' | 'cum';

export function etiquetaItem(tipo: TipoCatalogo, it: any): string {
  if (tipo === 'cum') {
    return [`${it.principio_activo}${it.concentracion ? ` ${it.concentracion}` : ''}`, it.forma_farmaceutica, it.producto].filter(Boolean).join(' · ');
  }
  return it.descripcion;
}

export function CatalogoInput({
  tipo,
  value,
  onChange,
  onElegir,
  placeholder,
  disabled,
  required,
  pattern,
  ariaLabel,
}: {
  tipo: TipoCatalogo;
  value: string;
  onChange: (v: string) => void;
  onElegir: (item: any) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  pattern?: string;
  ariaLabel?: string;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const [escribiendo, setEscribiendo] = useState(false);
  const listaId = useId();
  const seq = useRef(0);

  useEffect(() => {
    if (!escribiendo || value.trim().length < 2) {
      setItems([]);
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await api.get<any[]>(`/catalogos/${tipo}?q=${encodeURIComponent(value.trim())}&limit=12`);
        if (n === seq.current) {
          setItems(r);
          setActivo(0);
          setAbierto(true);
        }
      } catch {
        if (n === seq.current) setItems([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [value, tipo, escribiendo]);

  function elegir(it: any) {
    onElegir(it);
    setAbierto(false);
    setEscribiendo(false);
    setItems([]);
  }

  function teclado(e: KeyboardEvent<HTMLInputElement>) {
    if (!abierto || items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActivo((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActivo((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      elegir(items[activo]);
    } else if (e.key === 'Escape') {
      setAbierto(false);
    }
  }

  return (
    <div className="ac">
      <input
        value={value}
        onChange={(e) => {
          setEscribiendo(true);
          onChange(e.target.value);
        }}
        onKeyDown={teclado}
        onBlur={() => setTimeout(() => setAbierto(false), 120)}
        onFocus={() => items.length > 0 && setAbierto(true)}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        pattern={pattern}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={abierto}
        aria-controls={listaId}
        aria-autocomplete="list"
        autoComplete="off"
      />
      {abierto && items.length > 0 && (
        <ul className="ac-list" id={listaId} role="listbox">
          {items.map((it, i) => (
            <li
              key={it.codigo}
              role="option"
              aria-selected={i === activo}
              className={i === activo ? 'activo' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                elegir(it);
              }}
              onMouseEnter={() => setActivo(i)}
            >
              <span className="ac-codigo">{it.codigo}</span>
              <span>{etiquetaItem(tipo, it)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const FORMATO: Record<TipoCatalogo, RegExp> = {
  cie10: /^[A-Z][0-9]{2}[0-9X]?$/,
  cups: /^[0-9A-Z]{6}$/,
  cum: /^[0-9]{1,12}-[0-9]{1,3}$/,
};

export function useDescripcion(tipo: TipoCatalogo, codigo: string): string | null {
  const [desc, setDesc] = useState<string | null>(null);
  useEffect(() => {
    const c = codigo.trim().toUpperCase().replace('.', '');
    if (!FORMATO[tipo].test(c)) {
      setDesc(null);
      return;
    }
    let vigente = true;
    const t = setTimeout(() => {
      api
        .get(`/catalogos/${tipo}/${encodeURIComponent(c)}`)
        .then((r) => vigente && setDesc(etiquetaItem(tipo, r)))
        .catch(() => vigente && setDesc(null));
    }, 300);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [tipo, codigo]);
  return desc;
}

export function CodigoConDescripcion({ tipo, codigo }: { tipo: TipoCatalogo; codigo: string }) {
  const desc = useDescripcion(tipo, codigo);
  return (
    <>
      <strong>{codigo}</strong>
      {desc && <span className="muted"> · {desc}</span>}
    </>
  );
}

export function CodigosMultiples({
  tipo,
  codigos,
  onChange,
  max,
  disabled,
  ariaLabel,
}: {
  tipo: TipoCatalogo;
  codigos: string[];
  onChange: (c: string[]) => void;
  max: number;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [texto, setTexto] = useState('');

  function agregar(codigo: string) {
    const c = codigo.trim().toUpperCase().replace('.', '');
    if (!c || codigos.includes(c) || codigos.length >= max) return;
    onChange([...codigos, c]);
    setTexto('');
  }

  return (
    <div>
      {codigos.length > 0 && (
        <div className="chips">
          {codigos.map((c) => (
            <span key={c} className="chip">
              <span>
                <CodigoConDescripcion tipo={tipo} codigo={c} />
              </span>
              {!disabled && (
                <button type="button" aria-label={`Quitar ${c}`} onClick={() => onChange(codigos.filter((x) => x !== c))}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {!disabled && codigos.length < max && (
        <div className="row">
          <div style={{ flex: 1 }}>
            <CatalogoInput tipo={tipo} value={texto} onChange={setTexto} onElegir={(it) => agregar(it.codigo)} placeholder="Buscar por código o nombre" ariaLabel={ariaLabel} />
          </div>
          <button type="button" className="btn btn-sm" onClick={() => agregar(texto)} disabled={!texto.trim()}>
            Agregar
          </button>
        </div>
      )}
    </div>
  );
}
