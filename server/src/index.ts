import { config } from './config.js';
import { openDb } from './db.js';
import { buildApp } from './app.js';

const db = await openDb(config);
const { app } = await buildApp(config, db);

const shutdown = async () => {
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.host, port: config.port });
app.log.info(`Database: ${db.kind}, storage: ${config.storage}`);
