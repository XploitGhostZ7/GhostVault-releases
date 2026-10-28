// By Kompilador
import { redirect } from 'next/navigation';
import { inicioPara } from '@/lib/nav';
import { getMe } from '@/lib/session';

export default async function Inicio() {
  const me = await getMe();
  if (!me) redirect('/login');
  redirect(me.mfaRequerido && !me.mfaSesion ? '/cuenta?mfa=1' : inicioPara(me));
}
