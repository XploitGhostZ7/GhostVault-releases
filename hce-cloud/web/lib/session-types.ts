// By Kompilador
export type Rol = 'admin' | 'medico' | 'recepcion' | 'facturacion' | 'auditor';

export type Me = {
  id: string;
  email: string;
  nombre: string;
  roles: Rol[];
  especialidad: string | null;
  registro_profesional: string | null;
  totp_enabled: boolean;
  tenant: string;
  prestador: string;
  tiene_firma: boolean;
  mfaSesion: boolean;
  mfaRequerido: boolean;
};
