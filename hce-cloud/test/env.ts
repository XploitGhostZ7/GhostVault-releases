// By Kompilador
const admin = new URL(process.env.TEST_PG_ADMIN_URL ?? 'postgres://postgres@localhost:5432/postgres');

function withUser(user: string, password: string, db: string): string {
  const u = new URL(admin.toString());
  u.username = user;
  u.password = password;
  u.pathname = `/${db}`;
  return u.toString();
}

export const TEST_DB = 'hce_test';
export const ADMIN_URL = admin.toString();
export const SUPER_TEST_URL = withUser(admin.username, decodeURIComponent(admin.password), TEST_DB);
export const OWNER_URL = withUser('hce_owner', 'cambiar-owner', TEST_DB);
export const APP_URL = withUser('hce_app', 'cambiar-app', TEST_DB);
