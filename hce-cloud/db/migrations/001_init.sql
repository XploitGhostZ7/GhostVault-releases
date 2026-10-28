-- By Kompilador
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create function app_tenant() returns uuid
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

create function bloquear_modificacion() returns trigger
language plpgsql as $$
begin
  raise exception 'Registro inmutable: % no admite %', tg_table_name, tg_op using errcode = 'P0001';
end $$;

-- Prestadores (tenants)

create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  razon_social text not null,
  nit text not null check (nit ~ '^[0-9]{5,15}$'),
  dv char(1) check (dv ~ '^[0-9]$'),
  codigo_prestador char(12) not null check (codigo_prestador ~ '^[0-9]{12}$'),
  municipio char(5) check (municipio ~ '^[0-9]{5}$'),
  direccion text,
  telefono text,
  email text,
  created_at timestamptz not null default now()
);

create function tenant_lookup(p_slug text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from tenants where slug = p_slug
$$;

-- Usuarios y llaves de firma

create table users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app_tenant() references tenants(id),
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  nombre text not null,
  tipo_documento text not null,
  numero_documento text not null,
  registro_profesional text,
  especialidad text,
  roles text[] not null check (cardinality(roles) > 0 and roles <@ array['admin','medico','recepcion','facturacion','auditor']),
  password_hash text not null,
  totp_secret text,
  totp_enabled boolean not null default false,
  activo boolean not null default true,
  intentos_fallidos int not null default 0,
  bloqueado_hasta timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, email),
  unique (tenant_id, id)
);

create table signing_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app_tenant() references tenants(id),
  user_id uuid not null,
  public_key text not null,
  fingerprint text not null,
  encrypted_private_key text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (tenant_id, user_id) references users(tenant_id, id)
);
create unique index signing_keys_activa on signing_keys(user_id) where revoked_at is null;

-- Pacientes (codificación RIPS, Res. 2275 de 2023)

create table patients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app_tenant() references tenants(id),
  tipo_documento text not null check (tipo_documento in ('CC','CE','CD','PA','SC','PE','RC','TI','CN','AS','MS','DE','PT','SI')),
  numero_documento text not null check (numero_documento ~ '^[A-Za-z0-9]{3,20}$'),
  primer_nombre text not null,
  segundo_nombre text,
  primer_apellido text not null,
  segundo_apellido text,
  fecha_nacimiento date not null check (fecha_nacimiento <= current_date),
  sexo char(1) not null check (sexo in ('H','M','I')),
  pais_residencia char(3) not null default '170' check (pais_residencia ~ '^[0-9]{3}$'),
  municipio_residencia char(5) check (municipio_residencia ~ '^[0-9]{5}$'),
  zona_residencia char(2) check (zona_residencia in ('01','02')),
  pais_origen char(3) not null default '170' check (pais_origen ~ '^[0-9]{3}$'),
  direccion text,
  telefono text,
  email text,
  tipo_usuario char(2) not null default '01' check (tipo_usuario ~ '^[0-9]{2}$'),
  eps_codigo text,
  eps_nombre text,
  consentimiento_datos_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, tipo_documento, numero_documento),
  unique (tenant_id, id)
);

-- Agenda

create table schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app_tenant() references tenants(id),
  professional_id uuid not null,
  dia_semana smallint not null check (dia_semana between 1 and 7),
  hora_inicio time not null,
  hora_fin time not null,
  duracion_min smallint not null check (duracion_min between 5 and 240),
  check (hora_fin > hora_inicio),
  foreign key (tenant_id, professional_id) references users(tenant_id, id)
);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app_tenant() references tenants(id),
  patient_id uuid not null,
  professional_id uuid not null,
  periodo tstzrange not null check (not isempty(periodo)),
  estado text not null default 'programada'
    check (estado in ('programada','confirmada','admitida','atendida','cancelada','inasistencia')),
  motivo text,
  motivo_cancelacion text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, professional_id) references users(tenant_id, id),
  exclude using gist (tenant_id with =, professional_id with =, periodo with &&)
    where (estado not in ('cancelada','inasistencia'))
);
create index appointments_periodo on appointments using gist (tenant_id, periodo);

-- Admisión: datos administrativos que alimentan RIPS

create table admissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app_tenant() references tenants(id),
  patient_id uuid not null,
  professional_id uuid not null,
  appointment_id uuid unique references appointments(id),
  fecha_ingreso timestamptz not null default now(),
  tipo_usuario char(2) not null check (tipo_usuario ~ '^[0-9]{2}$'),
  modalidad char(2) not null default '01' check (modalidad ~ '^[0-9]{2}$'),
  grupo_servicios char(2) not null default '01' check (grupo_servicios ~ '^[0-9]{2}$'),
  cod_servicio text not null check (cod_servicio ~ '^[0-9]{3,4}$'),
  cod_consulta text not null check (cod_consulta ~ '^[0-9A-Z]{6}$'),
  num_autorizacion text,
  valor_servicio numeric(14,2) not null default 0 check (valor_servicio >= 0),
  concepto_recaudo char(2) not null default '05' check (concepto_recaudo ~ '^[0-9]{2}$'),
  valor_pago_moderador numeric(14,2) not null default 0 check (valor_pago_moderador >= 0),
  estado text not null default 'abierta' check (estado in ('abierta','cerrada','anulada')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, professional_id) references users(tenant_id, id),
  unique (tenant_id, id)
);

-- Historia clínica (Res. 1995 de 1999): una vez firmada no se modifica

create table encounters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app_tenant() references tenants(id),
  patient_id uuid not null,
  admission_id uuid not null unique,
  professional_id uuid not null,
  plantilla text not null,
  plantilla_version int not null,
  contenido jsonb not null default '{}'::jsonb,
  diagnostico_principal text check (diagnostico_principal ~ '^[A-Z][0-9]{2}[0-9X]?$'),
  diagnosticos_relacionados text[] not null default '{}'
    check (cardinality(diagnosticos_relacionados) <= 3),
  tipo_diagnostico_principal char(2) check (tipo_diagnostico_principal in ('01','02','03')),
  finalidad char(2) check (finalidad ~ '^[0-9]{2}$'),
  causa_externa char(2) check (causa_externa ~ '^[0-9]{2}$'),
  estado text not null default 'borrador' check (estado in ('borrador','firmado')),
  iniciado_at timestamptz not null default now(),
  firmado_at timestamptz,
  content_hash text,
  firma text,
  signing_key_id uuid references signing_keys(id),
  updated_at timestamptz not null default now(),
  check (estado = 'borrador' or (firmado_at is not null and content_hash is not null
         and firma is not null and signing_key_id is not null and diagnostico_principal is not null)),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, admission_id) references admissions(tenant_id, id),
  foreign key (tenant_id, professional_id) references users(tenant_id, id),
  unique (tenant_id, id)
);
create index encounters_patient on encounters(tenant_id, patient_id, iniciado_at desc);

create function encounters_inmutable() returns trigger
language plpgsql as $$
begin
  if old.estado = 'firmado' then
    raise exception 'La historia clínica firmada no se puede % ; use una nota aclaratoria', lower(tg_op)
      using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger encounters_inmutable before update or delete on encounters
for each row execute function encounters_inmutable();

create table encounter_addenda (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app_tenant() references tenants(id),
  encounter_id uuid not null,
  autor_id uuid not null,
  motivo text not null,
  texto text not null,
  created_at timestamptz not null default now(),
  content_hash text not null,
  firma text not null,
  signing_key_id uuid not null references signing_keys(id),
  foreign key (tenant_id, encounter_id) references encounters(tenant_id, id),
  foreign key (tenant_id, autor_id) references users(tenant_id, id)
);

create function addenda_requiere_firmado() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from encounters where id = new.encounter_id and estado = 'firmado') then
    raise exception 'Solo se agregan notas aclaratorias a historias firmadas' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger addenda_requiere_firmado before insert on encounter_addenda
for each row execute function addenda_requiere_firmado();
create trigger addenda_inmutable before update or delete on encounter_addenda
for each row execute function bloquear_modificacion();

-- Fórmula médica y órdenes

create table clinical_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app_tenant() references tenants(id),
  consecutivo bigint generated always as identity,
  encounter_id uuid not null,
  patient_id uuid not null,
  professional_id uuid not null,
  tipo text not null check (tipo in ('formula','procedimiento','laboratorio','imagen','interconsulta')),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  observaciones text,
  estado text not null default 'borrador' check (estado in ('borrador','firmado')),
  created_at timestamptz not null default now(),
  firmado_at timestamptz,
  content_hash text,
  firma text,
  signing_key_id uuid references signing_keys(id),
  check (estado = 'borrador' or (firmado_at is not null and content_hash is not null
         and firma is not null and signing_key_id is not null)),
  foreign key (tenant_id, encounter_id) references encounters(tenant_id, id),
  foreign key (tenant_id, patient_id) references patients(tenant_id, id),
  foreign key (tenant_id, professional_id) references users(tenant_id, id)
);

create function orders_inmutable() returns trigger
language plpgsql as $$
begin
  if old.estado = 'firmado' then
    raise exception 'La orden firmada no se puede %', lower(tg_op) using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

create trigger orders_inmutable before update or delete on clinical_orders
for each row execute function orders_inmutable();

-- Facturación electrónica y RIPS

create table invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app_tenant() references tenants(id),
  estado text not null default 'borrador' check (estado in ('borrador','emitida','validada','rechazada')),
  pagador jsonb not null,
  modalidad_pago char(2),
  numero_contrato text,
  total numeric(14,2) not null default 0,
  prefijo text,
  numero text,
  cufe text,
  fecha_emision timestamptz,
  proveedor text,
  proveedor_ref text,
  rips jsonb,
  cuv text,
  respuesta_validacion jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, prefijo, numero),
  unique (tenant_id, id)
);

create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app_tenant() references tenants(id),
  invoice_id uuid not null,
  admission_id uuid not null,
  valor numeric(14,2) not null,
  foreign key (tenant_id, invoice_id) references invoices(tenant_id, id) on delete cascade,
  foreign key (tenant_id, admission_id) references admissions(tenant_id, id),
  unique (admission_id)
);

-- Auditoría encadenada por hash

create table audit_log (
  tenant_id uuid not null references tenants(id),
  seq bigint not null,
  at timestamptz not null,
  actor_id uuid,
  actor_ip text,
  accion text not null,
  entidad text not null,
  entidad_id text,
  paciente_id uuid,
  detalle jsonb not null default '{}'::jsonb,
  prev_hash char(64) not null,
  hash char(64) not null,
  primary key (tenant_id, seq)
);
create index audit_log_paciente on audit_log(tenant_id, paciente_id, at desc);

create trigger audit_log_inmutable before update or delete on audit_log
for each row execute function bloquear_modificacion();

create function audit_hash(
  p_tenant uuid, p_seq bigint, p_at timestamptz, p_actor uuid, p_ip text, p_accion text,
  p_entidad text, p_entidad_id text, p_paciente uuid, p_detalle jsonb, p_prev text
) returns text
language sql immutable set search_path = public, pg_temp as $$
  select encode(digest(concat_ws('|',
    p_tenant::text, p_seq::text,
    to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    coalesce(p_actor::text, ''), coalesce(p_ip, ''), p_accion, p_entidad,
    coalesce(p_entidad_id, ''), coalesce(p_paciente::text, ''), p_detalle::text, p_prev
  ), 'sha256'), 'hex')
$$;

create function audit_append(
  p_actor uuid, p_ip text, p_accion text, p_entidad text,
  p_entidad_id text, p_paciente uuid, p_detalle jsonb
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tenant uuid := app_tenant();
  v_seq bigint;
  v_prev text;
  v_at timestamptz := clock_timestamp();
begin
  if v_tenant is null then
    raise exception 'Tenant no establecido' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('audit:' || v_tenant::text, 0));
  select seq, hash into v_seq, v_prev from audit_log
   where tenant_id = v_tenant order by seq desc limit 1;
  v_seq := coalesce(v_seq, 0) + 1;
  v_prev := coalesce(v_prev, repeat('0', 64));
  insert into audit_log (tenant_id, seq, at, actor_id, actor_ip, accion, entidad, entidad_id, paciente_id, detalle, prev_hash, hash)
  values (v_tenant, v_seq, v_at, p_actor, p_ip, p_accion, p_entidad, p_entidad_id, p_paciente,
          coalesce(p_detalle, '{}'::jsonb), v_prev,
          audit_hash(v_tenant, v_seq, v_at, p_actor, p_ip, p_accion, p_entidad, p_entidad_id, p_paciente,
                     coalesce(p_detalle, '{}'::jsonb), v_prev));
  return v_seq;
end $$;

create function audit_verify()
returns table (valido boolean, registros bigint, primer_error bigint, hash_cabeza text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r audit_log%rowtype;
  v_prev text := repeat('0', 64);
  v_esperado int8 := 1;
begin
  valido := true; registros := 0; primer_error := null;
  for r in select * from audit_log where tenant_id = app_tenant() order by seq loop
    registros := registros + 1;
    if valido and (r.seq <> v_esperado or r.prev_hash <> v_prev or r.hash <> audit_hash(
        r.tenant_id, r.seq, r.at, r.actor_id, r.actor_ip, r.accion, r.entidad,
        r.entidad_id, r.paciente_id, r.detalle, r.prev_hash)) then
      valido := false;
      primer_error := r.seq;
    end if;
    v_prev := r.hash;
    v_esperado := r.seq + 1;
  end loop;
  hash_cabeza := v_prev;
  return next;
end $$;

-- Aislamiento por tenant

do $$
declare t text;
begin
  foreach t in array array['users','signing_keys','patients','schedules','appointments','admissions',
                           'encounters','encounter_addenda','clinical_orders','invoices','invoice_items','audit_log']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy aislamiento_tenant on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())', t);
  end loop;
end $$;

alter table tenants enable row level security;
alter table tenants force row level security;
create policy aislamiento_tenant on tenants using (id = app_tenant());
do $$
begin
  execute format('create policy resolucion_login on tenants for select to %I using (true)', current_user);
end $$;

-- Permisos del rol de aplicación

revoke all on all tables in schema public from public;
grant usage on schema public to hce_app;
grant select on tenants to hce_app;
grant select, insert, update on users, signing_keys, patients, schedules, appointments,
  admissions, encounters, clinical_orders, invoices to hce_app;
grant delete on schedules, invoice_items to hce_app;
grant select, insert on encounter_addenda, invoice_items to hce_app;
grant select on audit_log to hce_app;
grant execute on function app_tenant(), tenant_lookup(text), audit_append(uuid, text, text, text, text, uuid, jsonb), audit_verify() to hce_app;
revoke execute on function audit_hash(uuid, bigint, timestamptz, uuid, text, text, text, text, uuid, jsonb, text) from public;
