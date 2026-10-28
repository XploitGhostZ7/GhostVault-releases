// By Kompilador
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { Suspense, useState, type FormEvent } from 'react';
import { useMe } from '@/components/session';
import { Alert, Badge, Encabezado, Field } from '@/components/ui';
import { api, mensajeError } from '@/lib/api';

function Mfa() {
  const me = useMe();
  const router = useRouter();
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  async function iniciar() {
    setError('');
    try {
      const r = await api.post<{ secret: string; otpauth: string }>('/auth/mfa/enroll');
      setSecret(r.secret);
      setQr(await QRCode.toDataURL(r.otpauth, { margin: 1, width: 360 }));
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  async function confirmar(ev: FormEvent) {
    ev.preventDefault();
    setError('');
    try {
      await api.post('/auth/mfa/confirm', { code });
      router.replace('/');
      router.refresh();
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Autenticación en dos pasos</h2>
        {me.totp_enabled ? <Badge tono="ok">Activa</Badge> : <Badge tono="warn">Inactiva</Badge>}
      </div>
      <Alert>{error}</Alert>
      {me.totp_enabled ? (
        <p className="muted">Su cuenta está protegida con un código TOTP. Si pierde el dispositivo, solicite el reinicio al administrador.</p>
      ) : !qr ? (
        <>
          <p className="muted">Use Google Authenticator, Microsoft Authenticator, Aegis o similar.</p>
          <button className="btn btn-primary" onClick={iniciar}>
            Configurar
          </button>
        </>
      ) : (
        <form onSubmit={confirmar} className="stack">
          <p className="muted">Escanee el código y escriba los 6 dígitos que muestra la aplicación.</p>
          <img src={qr} alt="Código QR para la aplicación autenticadora" className="qr" />
          <p className="mono">Clave manual: {secret}</p>
          <div className="row">
            <Field label="Código">
              <input inputMode="numeric" maxLength={6} pattern="[0-9]{6}" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
            </Field>
            <button className="btn btn-primary">Activar</button>
          </div>
        </form>
      )}
    </section>
  );
}

function LlaveFirma() {
  const me = useMe();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  async function crear(ev: FormEvent) {
    ev.preventDefault();
    if (pin !== pin2) return setMsg({ tipo: 'error', texto: 'Los PIN no coinciden' });
    try {
      const r = await api.post<{ fingerprint: string }>('/users/me/signing-key', { password, pin });
      setMsg({ tipo: 'ok', texto: `Llave creada. Huella: ${r.fingerprint.slice(0, 16)}…` });
      setPassword('');
      setPin('');
      setPin2('');
      router.refresh();
    } catch (e) {
      setMsg({ tipo: 'error', texto: mensajeError(e) });
    }
  }

  if (!me.roles.includes('medico')) return null;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Firma electrónica</h2>
        {me.tiene_firma ? <Badge tono="ok">Registrada</Badge> : <Badge tono="warn">Sin registrar</Badge>}
      </div>
      <p className="muted">
        La llave Ed25519 se protege con su PIN y firma cada historia, nota aclaratoria y orden. Generar una nueva revoca la anterior; las firmas ya
        hechas siguen siendo verificables.
      </p>
      {msg && <Alert tipo={msg.tipo}>{msg.texto}</Alert>}
      <form onSubmit={crear} className="form-grid" style={{ marginTop: '0.75rem' }}>
        <Field label="Contraseña actual">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </Field>
        <Field label="PIN de firma (6 a 12 dígitos)">
          <input type="password" inputMode="numeric" pattern="[0-9]{6,12}" value={pin} onChange={(e) => setPin(e.target.value)} required autoComplete="new-password" />
        </Field>
        <Field label="Confirmar PIN">
          <input type="password" inputMode="numeric" pattern="[0-9]{6,12}" value={pin2} onChange={(e) => setPin2(e.target.value)} required autoComplete="new-password" />
        </Field>
        <div className="field" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-primary">{me.tiene_firma ? 'Regenerar llave' : 'Crear llave'}</button>
        </div>
      </form>
    </section>
  );
}

function Cuenta() {
  const me = useMe();
  const params = useSearchParams();
  return (
    <>
      <Encabezado titulo="Mi cuenta" sub={`${me.email} · ${me.roles.join(', ')}`} />
      {params.get('mfa') && me.mfaRequerido && !me.mfaSesion && (
        <Alert tipo="warn">El prestador exige autenticación en dos pasos. Actívela para continuar.</Alert>
      )}
      <div className="grid-2">
        <Mfa />
        <LlaveFirma />
      </div>
    </>
  );
}

export default function CuentaPage() {
  return (
    <Suspense>
      <Cuenta />
    </Suspense>
  );
}
