// By Kompilador
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Alert, Field } from '@/components/ui';
import { ApiError, api, mensajeError } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [tenant, setTenant] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [pideTotp, setPideTotp] = useState(false);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    setError('');
    setCargando(true);
    try {
      const r = await api.post<{ mfaPendiente: boolean }>('/session', { tenant, email, password, ...(pideTotp ? { totp } : {}) });
      router.replace(r.mfaPendiente ? '/cuenta?mfa=1' : '/');
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && (e.detalle as any)?.mfaRequerido) {
        setPideTotp(true);
        setError(pideTotp ? 'Código incorrecto' : '');
      } else {
        setError(mensajeError(e));
      }
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="login-wrap">
      <main className="login-card">
        <h1>HCE Cloud</h1>
        <p className="muted">Historia clínica electrónica</p>
        {params.get('expirada') && <Alert tipo="info">Su sesión expiró. Ingrese de nuevo.</Alert>}
        <form onSubmit={enviar}>
          <Alert>{error}</Alert>
          <Field label="Prestador">
            <input value={tenant} onChange={(e) => setTenant(e.target.value.trim().toLowerCase())} required autoComplete="organization" placeholder="ips-ejemplo" />
          </Field>
          <Field label="Correo">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
          </Field>
          <Field label="Contraseña">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </Field>
          {pideTotp && (
            <Field label="Código de autenticación (6 dígitos)">
              <input
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                autoComplete="one-time-code"
                autoFocus
                required
              />
            </Field>
          )}
          <button className="btn btn-primary" disabled={cargando}>
            {cargando ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
