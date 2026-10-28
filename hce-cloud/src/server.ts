// By Kompilador
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { crearProveedorFEV, crearValidadorRips } from './modules/billing/providers.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const app = await buildApp(
  { config, pool, fev: crearProveedorFEV(config.FEV_PROVIDER), ripsValidator: crearValidadorRips(config.RIPS_VALIDATOR) },
  { logger: true },
);

const cerrar = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', cerrar);
process.on('SIGINT', cerrar);

await app.listen({ host: '0.0.0.0', port: config.PORT });
