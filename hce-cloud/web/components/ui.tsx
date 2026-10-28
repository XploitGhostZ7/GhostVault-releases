// By Kompilador
'use client';

import { useEffect, useRef, type ReactNode } from 'react';

export function Alert({ tipo = 'error', children }: { tipo?: 'error' | 'ok' | 'info' | 'warn'; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className={`alert alert-${tipo}`} role={tipo === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field${wide ? ' field-wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Badge({ children, tono = 'neutro' }: { children: ReactNode; tono?: 'neutro' | 'ok' | 'warn' | 'error' | 'info' }) {
  return <span className={`badge badge-${tono}`}>{children}</span>;
}

const TONOS: Record<string, 'neutro' | 'ok' | 'warn' | 'error' | 'info'> = {
  programada: 'info',
  confirmada: 'info',
  admitida: 'warn',
  atendida: 'ok',
  cancelada: 'neutro',
  inasistencia: 'error',
  abierta: 'warn',
  cerrada: 'ok',
  anulada: 'neutro',
  borrador: 'warn',
  firmado: 'ok',
  emitida: 'info',
  validada: 'ok',
  rechazada: 'error',
};

export function Estado({ valor }: { valor: string }) {
  return <Badge tono={TONOS[valor] ?? 'neutro'}>{valor}</Badge>;
}

export function Modal({ titulo, abierto, onCerrar, children }: { titulo: string; abierto: boolean; onCerrar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);
  return (
    <dialog ref={ref} className="modal" onClose={onCerrar} aria-label={titulo}>
      <div className="modal-head">
        <h2>{titulo}</h2>
        <button type="button" className="btn-icon" onClick={onCerrar} aria-label="Cerrar">
          ×
        </button>
      </div>
      <div className="modal-body">{abierto && children}</div>
    </dialog>
  );
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="vacio">{children}</p>;
}

export function Encabezado({ titulo, sub, children }: { titulo: string; sub?: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{titulo}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}
