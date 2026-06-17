import 'dotenv/config';
import { ConfigService } from './config/config.service';
import { getLogger } from './logger/logger.service';
import { buildApp } from './server';
import { disconnectPrisma } from './db/db.service';

async function main(): Promise<void> {
  const cfg = ConfigService.load();
  const log = getLogger();
  const app = buildApp();

  const server = app.listen(cfg.PORT, () => {
    log.info({ port: cfg.PORT, env: cfg.NODE_ENV }, 'server_listening');
  });

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'shutdown_starting');
    server.close(async (err) => {
      if (err) log.error({ err: err.message }, 'http_close_error');
      await disconnectPrisma();
      log.info({}, 'shutdown_complete');
      process.exit(0);
    });
    setTimeout(() => {
      log.error({}, 'shutdown_force_exit');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal:', err);
  process.exit(1);
});
