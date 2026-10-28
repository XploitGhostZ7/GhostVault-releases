# HCE Cloud · By Kompilador

API multi-tenant de historia clínica electrónica para prestadores de servicios de salud en Colombia (IPS, consultorios y profesionales independientes).

**Alcance del MVP**

1. Agenda y admisión del paciente.
2. Historia clínica: consulta general y plantillas de pediatría, ginecología y psicología, con firma electrónica, notas aclaratorias e impresión en PDF.
3. Fórmula médica y órdenes de procedimientos, laboratorio, imágenes e interconsulta.
4. RIPS JSON (Res. 2275/2023) y facturación electrónica a través de un proveedor tecnológico.
5. Auditoría encadenada por hash y exportación HL7 FHIR R4.

## Stack

Node.js 22 · TypeScript · Fastify 5 · PostgreSQL 16 (RLS, triggers, pgcrypto, btree_gist) · Zod · jose (JWT) · PDFKit · Vitest.

## Arquitectura de seguridad

| Control | Implementación |
|---|---|
| Aislamiento multi-tenant | `tenant_id` + **Row-Level Security con `FORCE`** en todas las tablas. La API se conecta como `hce_app` (sin `BYPASSRLS`) y fija `app.tenant_id` con `SET LOCAL` por transacción. Sin tenant fijado, la base no devuelve filas. |
| Integridad de la historia (Res. 1995/1999) | Un registro firmado no admite `UPDATE` ni `DELETE`, bloqueado por trigger. Las correcciones se hacen con notas aclaratorias firmadas, de solo inserción. |
| Firma electrónica (Ley 527/1999, Dec. 2364/2012) | Llave **Ed25519** por profesional. La llave privada se cifra con AES-256-GCM usando una clave derivada del PIN con scrypt, y luego otra vez con la llave maestra (`APP_ENCRYPTION_KEY`). Se firma el SHA-256 del JSON canónico del registro. Endpoint de verificación independiente. |
| Auditoría | `audit_log` encadenado por SHA-256 por tenant, escrito solo mediante la función `audit_append` (SECURITY DEFINER, con lock por tenant). Es inmutable por trigger y por permisos. `audit_verify()` recalcula la cadena y devuelve el `hash_cabeza` para anclarlo externamente. Se registran también las **lecturas** de la historia, los PDF y las exportaciones. |
| Autenticación | Contraseñas con scrypt (N=2^15) y política mínima de 12 caracteres. Bloqueo de 15 minutos tras 5 intentos fallidos. Respuesta uniforme ante usuario o tenant inexistente. JWT HS256 de 30 minutos. Roles y estado del usuario se consultan en cada request. |
| MFA | TOTP (RFC 6238) con secreto cifrado en reposo. Con `MFA_REQUIRED=true`, ningún endpoint de negocio responde hasta activarlo. |
| Mínimo privilegio | Roles `admin`, `medico`, `recepcion`, `facturacion` y `auditor`. Administración y recepción **no leen contenido clínico**. |
| Datos sensibles (Ley 1581/2012) | No se admite a un paciente sin autorización de tratamiento de datos registrada (`consentimiento_datos_at`). |
| HTTP | Helmet con CSP `default-src 'none'`, CORS por lista blanca, rate limit global y estricto en login y firma, `Cache-Control: no-store`, y redacción de password, PIN y TOTP en los logs. |

## Flujo funcional

```
Paciente (consentimiento) → Horario → Cita → Admisión (datos RIPS)
  → Historia (borrador → firma con PIN) → Notas aclaratorias
  → Fórmula / Órdenes (firma) → PDF
  → Factura (borrador → emisión FEV → RIPS → validación → CUV)
  → FHIR $everything · Auditoría
```

## Endpoints

| Módulo | Endpoints |
|---|---|
| Auth | `POST /auth/login` · `POST /auth/refresh` · `GET /auth/me` · `POST /auth/mfa/enroll` · `POST /auth/mfa/confirm` |
| Usuarios | `GET/POST /users` · `PATCH /users/:id` · `POST /users/:id/reset-mfa` · `POST /users/me/signing-key` · `GET /users/:id/signing-keys` |
| Pacientes | `GET /patients?q=` · `POST /patients` · `GET/PATCH /patients/:id` |
| Agenda | `POST/GET /schedules` · `DELETE /schedules/:id` · `GET /agenda/slots` · `POST/GET /appointments` · `POST /appointments/:id/{confirm,cancel,no-show}` |
| Admisión | `POST/GET /admissions` · `GET /admissions/:id` · `POST /admissions/:id/anular` |
| Historia clínica | `GET /templates[/:code]` · `POST /encounters` · `PATCH /encounters/:id` · `POST /encounters/:id/sign` · `GET /encounters/:id` · `GET /patients/:id/encounters` · `POST /encounters/:id/addenda` · `GET /encounters/:id/verify` · `GET /encounters/:id/pdf` |
| Órdenes | `POST/GET /encounters/:id/orders` · `PATCH /orders/:id` · `POST /orders/:id/sign` · `GET /orders/:id` · `GET /orders/:id/pdf` |
| Facturación | `POST /billing/rips/preview` · `POST/GET /billing/invoices` · `GET /billing/invoices/:id` · `POST /billing/invoices/:id/emitir` · `GET /billing/invoices/:id/rips` |
| Auditoría | `GET /audit` · `GET /audit/verify` |
| FHIR R4 | `GET /fhir/metadata` · `GET /fhir/Patient/:id` · `GET /fhir/Patient/:id/$everything` |

## Puesta en marcha

```bash
docker compose up -d db
cp .env.example .env   # generar JWT_SECRET y APP_ENCRYPTION_KEY con openssl rand -base64
npm ci
MIGRATION_DATABASE_URL=postgres://hce_owner:cambiar-owner@localhost:5432/hce npm run migrate
MIGRATION_DATABASE_URL=... ADMIN_PASSWORD='...' npm run tenant -- \
  --slug ips-demo --razon "IPS Demo S.A.S." --nit 900123456 --dv 7 \
  --prestador 110010000001 --admin-email admin@demo.co --admin-nombre "Admin" --admin-cc 1010
npm run dev
```

Pruebas, que crean y destruyen la base `hce_test`:

```bash
TEST_PG_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
```

La suite cubre el flujo completo de punta a punta, el aislamiento entre tenants, la inmutabilidad a nivel de base, la detección de manipulación (en auditoría y en historia firmada), MFA, bloqueo de cuenta, tokens manipulados, RBAC y los vectores del RFC 6238.

## Integraciones pendientes de contrato

- **Proveedor tecnológico FEV**: implementar `ProveedorFEV` (`src/modules/billing/providers.ts`). Hoy opera `SandboxFEV`, con prefijo `SETT` y CUFE simulado.
- **Mecanismo Único de Validación (MUV) de MinSalud**: implementar `ValidadorRips`. Hoy `SandboxValidadorRips` corre la prevalidación local y genera un CUV simulado.

## Pendiente antes de producción

- Frontend web: agenda, editor de plantillas y bandeja del médico.
- Catálogos oficiales: CIE-10, CUPS, CUM, DIVIPOLA y tablas de referencia RIPS de SISPRO. Hoy solo se valida el **formato**; los códigos sugeridos por plantilla (`codServicio`, CUPS) y los valores de finalidad y causa deben confirmarse contra las tablas vigentes.
- RIPS de procedimientos, medicamentos y otros servicios. El MVP genera solo **consultas**.
- Perfiles de la guía IHCE de MinSalud: los sistemas de identificadores están centralizados en `SYS` (`src/modules/fhir/mapper.ts`).
- `APP_ENCRYPTION_KEY` en KMS, cifrado de disco, backups con retención de 15 años (Res. 839/2017) y Object Lock.
- Anclaje periódico del `hash_cabeza` de auditoría fuera de la base, por ejemplo en un bucket WORM o con sello de tiempo.
- Revocación de sesiones, y firma digital con certificado de una ECD como opción adicional.
