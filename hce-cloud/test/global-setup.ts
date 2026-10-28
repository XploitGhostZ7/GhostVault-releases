// By Kompilador
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { migrate } from '../scripts/migrate.js';
import { ADMIN_URL, OWNER_URL, TEST_DB } from './env.js';

export default async function setup() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(await readFile(new URL('../db/bootstrap.sql', import.meta.url), 'utf8'));
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB} owner hce_owner`);
  await admin.end();
  await migrate(OWNER_URL, () => undefined);
}
