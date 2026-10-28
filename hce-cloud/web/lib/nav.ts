// By Kompilador
import type { Me, Rol } from './session-types';

export const NAV: Array<{ href: string; label: string; roles: Rol[] }> = [
  { href: '/atencion', label: 'Atención', roles: ['medico'] },
  { href: '/agenda', label: 'Agenda', roles: ['admin', 'recepcion', 'medico'] },
  { href: '/pacientes', label: 'Pacientes', roles: ['admin', 'recepcion', 'medico', 'auditor', 'facturacion'] },
  { href: '/facturacion', label: 'Facturación', roles: ['admin', 'facturacion'] },
  { href: '/auditoria', label: 'Auditoría', roles: ['admin', 'auditor'] },
  { href: '/usuarios', label: 'Usuarios y horarios', roles: ['admin'] },
  { href: '/cuenta', label: 'Mi cuenta', roles: ['admin', 'recepcion', 'medico', 'auditor', 'facturacion'] },
];

export function tieneRol(me: Pick<Me, 'roles'>, ...roles: Rol[]): boolean {
  return roles.some((r) => me.roles.includes(r));
}

export function inicioPara(me: Me): string {
  return NAV.find((n) => tieneRol(me, ...n.roles))?.href ?? '/cuenta';
}
