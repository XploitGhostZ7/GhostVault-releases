// By Kompilador
// Prueba de punta a punta del flujo clínico con MFA obligatorio.
// Requiere la API (MFA_REQUIRED=true) y el frontend en marcha, y un tenant recién creado:
//   slug ips-demo · admin@demo.co · ADMIN_PASSWORD (por defecto Admin-Segura-2026),
// y los catálogos de test/fixtures cargados con npm run catalogo.
const { chromium } = require('playwright');
const crypto = require('crypto');

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const OUT = process.env.E2E_SHOTS;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin-Segura-2026';
if (OUT) require('fs').mkdirSync(OUT, { recursive: true });
const PASS = 'Clave-Segura-2026';
const PIN = '482915';
const secrets = {};
const errores = [];

function b32(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, v = 0; const out = [];
  for (const c of s) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function totp(secret) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = crypto.createHmac('sha1', b32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

let n = 0;
async function shot(page, nombre) {
  if (!OUT) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${nombre}.png`, fullPage: true });
}

async function login(page, email, password) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Prestador').fill('ips-demo');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  if (secrets[email]) {
    await page.getByLabel(/Código de autenticación/).fill(totp(secrets[email]));
    await page.getByRole('button', { name: 'Ingresar' }).click();
  }
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  if (page.url().includes('/cuenta?mfa=1')) {
    await page.getByRole('button', { name: 'Configurar' }).click();
    const txt = await page.locator('.mono', { hasText: 'Clave manual' }).innerText();
    secrets[email] = txt.split(':')[1].trim();
    await page.getByLabel('Código', { exact: true }).fill(totp(secrets[email]));
    await page.getByRole('button', { name: 'Activar' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/cuenta'));
  }
}

async function logout(page) {
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.waitForURL('**/login');
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errores.push(`console: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());

  // Admin
  await page.goto(`${BASE}/login`);
  await shot(page, 'login');
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Prestador').fill('ips-demo');
  await page.getByLabel('Correo').fill('admin@demo.co');
  await page.getByLabel('Contraseña').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForURL('**/cuenta?mfa=1');
  await page.getByRole('button', { name: 'Configurar' }).click();
  await page.locator('img.qr').waitFor();
  await shot(page, 'mfa-enrolamiento');
  secrets['admin@demo.co'] = (await page.locator('.mono', { hasText: 'Clave manual' }).innerText()).split(':')[1].trim();
  await page.getByLabel('Código', { exact: true }).fill(totp(secrets['admin@demo.co']));
  await page.getByRole('button', { name: 'Activar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/cuenta'));

  await page.goto(`${BASE}/usuarios`);
  const usuarios = [
    ['Carlos Pérez', 'medico@demo.co', '80123456', 'medico', 'RM-12345', 'Medicina general'],
    ['Sofía Recepción', 'recepcion@demo.co', '52111222', 'recepcion'],
    ['Andrés Facturación', 'factura@demo.co', '79333444', 'facturacion'],
  ];
  for (const [nombre, email, doc, rol, reg, esp] of usuarios) {
    await page.getByRole('button', { name: 'Nuevo usuario' }).click();
    const m = page.locator('dialog[open]');
    await m.getByLabel('Nombre completo').fill(nombre);
    await m.getByLabel('Correo').fill(email);
    await m.getByLabel('Número de documento').fill(doc);
    if (reg) await m.getByLabel(/Registro profesional/).fill(reg);
    if (esp) await m.getByLabel('Especialidad').fill(esp);
    await m.getByLabel(/Contraseña inicial/).fill(PASS);
    await m.getByLabel('Recepción').uncheck();
    await m.getByLabel({ medico: 'Profesional de salud', recepcion: 'Recepción', facturacion: 'Facturación' }[rol]).check();
    await m.getByRole('button', { name: 'Guardar' }).click();
    await page.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
    await page.getByRole('cell', { name: email }).waitFor();
  }
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
  const dow = new Date(`${hoy}T12:00:00Z`).getUTCDay() || 7;
  await page.getByLabel('Día').selectOption(String(dow));
  await page.getByLabel('Desde').fill('00:00');
  await page.getByLabel('Hasta').fill('23:40');
  await page.getByRole('button', { name: 'Agregar' }).click();
  await page.locator('.item-list li').first().waitFor();
  await shot(page, 'usuarios-horarios');
  await logout(page);

  // Recepción
  await login(page, 'recepcion@demo.co', PASS);
  await page.goto(`${BASE}/pacientes`);
  await page.getByRole('button', { name: 'Nuevo paciente' }).click();
  const f = page.locator('dialog[open]');
  await f.getByLabel('Número').fill('52123456');
  await f.getByLabel('Primer nombre').fill('Ana');
  await f.getByLabel('Segundo nombre').fill('María');
  await f.getByLabel('Primer apellido').fill('Gómez');
  await f.getByLabel('Segundo apellido').fill('Rojas');
  await f.getByLabel('Fecha de nacimiento').fill('1990-05-14');
  await f.getByLabel(/Municipio/).fill('11001');
  await f.getByLabel('Teléfono').fill('3001234567');
  await f.getByLabel('Código EPS').fill('EPS037');
  await f.getByLabel('EPS / asegurador').fill('EPS Prueba');
  await f.getByLabel(/autorizó el tratamiento/).check();
  await shot(page, 'paciente-nuevo');
  await f.getByRole('button', { name: 'Guardar paciente' }).click();
  await page.waitForURL('**/pacientes/*');
  await page.getByText('Ley 1581').waitFor();
  await shot(page, 'paciente-detalle-recepcion');

  await page.goto(`${BASE}/agenda`);
  await page.locator('select').first().selectOption({ label: 'Carlos Pérez · Medicina general' });
  await page.locator('.slot').first().click();
  const d = page.locator('dialog[open]');
  await d.getByLabel('Buscar paciente').fill('52123456');
  await d.getByRole('button', { name: 'Buscar' }).click();
  await d.getByRole('button', { name: 'Seleccionar' }).click();
  await d.getByLabel(/Motivo/).fill('Dolor de garganta');
  await d.getByRole('button', { name: 'Confirmar cita' }).click();
  await page.getByText('Cita asignada').waitFor();
  await shot(page, 'agenda');
  await page.getByRole('button', { name: 'Admitir' }).click();
  const a = page.locator('dialog[open]');
  await a.getByLabel('N.º de autorización').fill('AUT-001');
  await a.getByLabel('Valor del servicio (COP)').fill('60000');
  await a.getByLabel('Concepto de recaudo').selectOption('02');
  await a.getByLabel('Valor pagado por el usuario').fill('4500');
  await shot(page, 'admision');
  await a.getByRole('button', { name: 'Admitir' }).click();
  await page.getByText('admitido').waitFor();
  await logout(page);

  // Médico
  await login(page, 'medico@demo.co', PASS);
  await page.goto(`${BASE}/cuenta`);
  await page.getByLabel('Contraseña actual').fill(PASS);
  await page.getByLabel(/PIN de firma/).fill(PIN);
  await page.getByLabel('Confirmar PIN').fill(PIN);
  await page.getByRole('button', { name: 'Crear llave' }).click();
  await page.getByText('Llave creada').waitFor();
  await shot(page, 'cuenta-medico');
  await page.goto(`${BASE}/atencion`);
  await page.getByRole('button', { name: 'Iniciar atención' }).click();
  await page.waitForURL('**/atencion/*');
  await page.getByLabel('Motivo de consulta *').fill('Dolor de garganta');
  await page.getByLabel('Enfermedad actual *').fill('Cuadro de 3 días de odinofagia y fiebre no cuantificada.');
  await page.getByLabel('Alergias *').fill('Niega');
  await page.getByLabel('TA sistólica (mm[Hg])').fill('128');
  await page.getByLabel('TA diastólica (mm[Hg])').fill('82');
  await page.getByLabel('Frecuencia cardiaca (/min)').fill('88');
  await page.getByLabel('Temperatura (Cel)').fill('38.2');
  await page.getByLabel('Estado general *').fill('Alerta, hidratado');
  await page.getByLabel('Hallazgos por sistemas *').fill('Faringe eritematosa con exudado amigdalino');
  await page.getByLabel('Análisis *').fill('Faringoamigdalitis aguda probablemente bacteriana');
  await page.getByLabel('Plan de manejo *').fill('Antibiótico, analgésico y control en 72 horas');
  await page.getByLabel(/Diagnóstico principal/).fill('amigdalitis');
  await page.getByRole('option', { name: /J039/ }).click();
  await page.getByText('Amigdalitis aguda, no especificada').waitFor();
  await page.getByRole('combobox', { name: 'Diagnóstico relacionado' }).fill('hipertension');
  await page.getByRole('option', { name: /I10X/ }).click();
  await page.locator('.chip', { hasText: 'I10X' }).waitFor();
  await page.getByLabel(/Tipo de diagnóstico/).selectOption('01');
  await page.getByLabel(/Finalidad/).fill('15');
  await page.getByLabel(/Causa/).fill('38');
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await page.getByText('Borrador guardado').waitFor();
  await shot(page, 'historia-borrador');

  await page.getByRole('button', { name: '+ Nueva' }).click();
  const o = page.locator('dialog[open]');
  await o.getByLabel(/Buscar en catálogo CUM/).fill('amoxicilina');
  await o.getByRole('option', { name: /19943231-1/ }).click();
  if ((await o.getByLabel('Nombre (DCI) *').inputValue()) !== 'AMOXICILINA') throw new Error('CUM no completó el nombre');
  if ((await o.getByLabel('Concentración *').inputValue()) !== '500 mg') throw new Error('CUM no completó la concentración');
  await o.getByLabel('Dosis *').fill('1 cápsula');
  await o.getByLabel('Cada *').fill('8 horas');
  await o.getByLabel('Días *').fill('7');
  await o.getByLabel('Cantidad total *').fill('21');
  await o.getByLabel('Unidad').fill('cápsulas');
  await shot(page, 'orden-formula');
  await o.getByRole('button', { name: 'Guardar borrador' }).click();
  await page.locator('.item-list li').first().waitFor();

  await page.locator('header').getByRole('button', { name: 'Firmar historia' }).click();
  const s = page.locator('dialog[open]');
  await s.getByLabel('PIN de firma').fill('000000');
  await s.getByRole('button', { name: 'Firmar historia' }).click();
  await s.getByText('PIN de firma incorrecto').waitFor();
  await s.getByLabel('PIN de firma').fill(PIN);
  await s.getByRole('button', { name: 'Firmar historia' }).click();
  await page.getByText('Historia clínica firmada').waitFor();

  await page.locator('.item-list li').getByRole('button', { name: 'Firmar' }).click();
  await page.locator('dialog[open]').getByLabel('PIN de firma').fill(PIN);
  await page.locator('dialog[open]').getByRole('button', { name: /Firmar orden/ }).click();
  await page.locator('.item-list li .badge', { hasText: 'firmado' }).waitFor();

  await page.getByRole('button', { name: '+ Nota aclaratoria' }).click();
  const nt = page.locator('dialog[open]');
  await nt.getByLabel('Motivo').fill('Precisión de signos vitales');
  await nt.getByLabel('Texto de la nota').fill('La temperatura registrada fue tomada en axila.');
  await nt.getByLabel('PIN de firma').fill(PIN);
  await nt.getByRole('button', { name: 'Firmar nota' }).click();
  await page.getByText('Nota aclaratoria firmada').waitFor();
  await page.getByRole('button', { name: 'Verificar' }).click();
  await page.getByText('Íntegra').waitFor();
  await shot(page, 'historia-firmada');

  const pdf = await page.request.get(`${BASE}/api/encounters/${page.url().split('/').pop()}/pdf`);
  if (pdf.status() !== 200 || !(await pdf.body()).subarray(0, 5).toString().startsWith('%PDF')) throw new Error('PDF historia');

  await page.getByRole('link', { name: 'Ver paciente' }).click();
  await page.waitForURL('**/pacientes/*');
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar FHIR R4' }).click()]);
  const bundle = JSON.parse(require('fs').readFileSync(await descarga.path(), 'utf8'));
  if (bundle.resourceType !== 'Bundle' || bundle.entry.length < 10) throw new Error('FHIR');
  await shot(page, 'paciente-detalle-medico');
  await logout(page);

  // Facturación
  await login(page, 'factura@demo.co', PASS);
  await page.goto(`${BASE}/facturacion`);
  await page.locator('tbody input[type=checkbox]').first().check();
  await page.getByLabel('Número').fill('800123456');
  await page.getByLabel('Nombre o razón social').fill('EPS Prueba S.A.');
  await page.getByRole('button', { name: 'Prevalidar RIPS' }).click();
  await page.getByText('RIPS sin hallazgos').waitFor();
  await page.getByRole('button', { name: 'Crear factura' }).click();
  await page.getByText('Factura en borrador').waitFor();
  await page.getByRole('button', { name: 'Emitir' }).click();
  await page.getByText('RIPS validados').waitFor();
  await shot(page, 'facturacion');
  const [rips] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'RIPS JSON' }).click()]);
  const r = JSON.parse(require('fs').readFileSync(await rips.path(), 'utf8'));
  if (r.usuarios[0].servicios.consultas[0].codDiagnosticoPrincipal !== 'J039') throw new Error('RIPS');
  await logout(page);

  // Auditoría (admin)
  await login(page, 'admin@demo.co', ADMIN_PASSWORD);
  await page.goto(`${BASE}/auditoria`);
  await page.getByRole('button', { name: 'Verificar integridad' }).click();
  await page.getByText('Cadena íntegra').waitFor();
  await shot(page, 'auditoria');

  // Control de acceso: el admin no lee contenido clínico
  const enc = await page.request.get(`${BASE}/api/patients?q=52123456`);
  const pid = (await enc.json())[0].id;
  const hist = await page.request.get(`${BASE}/api/patients/${pid}/encounters`);
  if (hist.status() !== 403) throw new Error(`admin leyó historia: ${hist.status()}`);
  const csrf = await page.request.post(`${BASE}/api/patients`, { data: {} });
  if (csrf.status() !== 403) throw new Error(`CSRF no bloqueado: ${csrf.status()}`);

  await browser.close();
  console.log('E2E OK');
  if (errores.length) console.log('Errores de navegador:\n' + errores.join('\n'));
})().catch(async (e) => {
  console.error('E2E FALLÓ:', e.message);
  if (errores.length) console.log('Errores de navegador:\n' + errores.join('\n'));
  process.exit(1);
});
