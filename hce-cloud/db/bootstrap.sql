-- By Kompilador
-- Se ejecuta una sola vez por entorno con un usuario con CREATEROLE.
-- hce_owner es dueño del esquema y ejecuta migraciones; hce_app es el rol de la API (sin BYPASSRLS).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'hce_owner') then
    create role hce_owner login password 'cambiar-owner' nosuperuser nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'hce_app') then
    create role hce_app login password 'cambiar-app' nosuperuser nobypassrls;
  end if;
end $$;
