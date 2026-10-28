// By Kompilador
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { NAV, tieneRol } from '@/lib/nav';
import type { Me } from '@/lib/session-types';

export { tieneRol };

const MeContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('Sesión no disponible');
  return me;
}

export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const mfaPendiente = me.mfaRequerido && !me.mfaSesion;

  useEffect(() => {
    if (mfaPendiente && !pathname.startsWith('/cuenta')) router.replace('/cuenta?mfa=1');
  }, [mfaPendiente, pathname, router]);

  async function salir() {
    await api.del('/session').catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  const items = mfaPendiente ? NAV.filter((n) => n.href === '/cuenta') : NAV.filter((n) => tieneRol(me, ...n.roles));

  return (
    <MeContext.Provider value={me}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <strong>HCE Cloud</strong>
            <span>{me.prestador}</span>
          </div>
          <nav className="nav" aria-label="Principal">
            {items.map((n) => (
              <Link key={n.href} href={n.href} aria-current={pathname.startsWith(n.href) ? 'page' : undefined}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="user-box">
            <strong>{me.nombre}</strong>
            {me.roles.join(' · ')}
            <br />
            <button type="button" onClick={salir}>
              Cerrar sesión
            </button>
          </div>
        </aside>
        <main className="main">{children}</main>
      </div>
    </MeContext.Provider>
  );
}
