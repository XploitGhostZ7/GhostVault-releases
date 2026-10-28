-- By Kompilador
-- Catálogos de referencia nacionales (globales, no por tenant). Solo el rol dueño los carga;
-- la API los lee. La columna `busqueda` llega normalizada (minúsculas, sin tildes) desde el importador.
create extension if not exists pg_trgm;

create table cat_versiones (
  catalogo text primary key check (catalogo in ('cie10','cups','cum')),
  version text not null,
  fuente text not null,
  registros int not null,
  sha256 char(64) not null,
  cargado_at timestamptz not null default now()
);

create table cat_cie10 (
  codigo text primary key check (codigo ~ '^[A-Z][0-9]{2}[0-9X]?$'),
  descripcion text not null,
  sexo char(1) check (sexo in ('H','M')),
  edad_min smallint check (edad_min between 0 and 150),
  edad_max smallint check (edad_max between 0 and 150),
  habilitado boolean not null default true,
  busqueda text not null
);

create table cat_cups (
  codigo text primary key check (codigo ~ '^[0-9A-Z]{6}$'),
  descripcion text not null,
  sexo char(1) check (sexo in ('H','M')),
  habilitado boolean not null default true,
  busqueda text not null
);

create table cat_cum (
  codigo text primary key check (codigo ~ '^[0-9]{1,12}-[0-9]{1,3}$'),
  producto text not null,
  descripcion_comercial text,
  principio_activo text not null,
  concentracion text,
  forma_farmaceutica text,
  via text,
  atc text,
  registro_sanitario text,
  titular text,
  vigente boolean not null,
  busqueda text not null
);

create index cat_cie10_busqueda on cat_cie10 using gin (busqueda gin_trgm_ops);
create index cat_cups_busqueda on cat_cups using gin (busqueda gin_trgm_ops);
create index cat_cum_busqueda on cat_cum using gin (busqueda gin_trgm_ops);

grant select on cat_versiones, cat_cie10, cat_cups, cat_cum to hce_app;
