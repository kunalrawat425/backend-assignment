import { ConfigService } from '../../src/config/config.service';
import { getLogger, resetLogger } from '../../src/logger/logger.service';
import { Writable } from 'stream';

beforeAll(() => {
  ConfigService.load({
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    API_KEY: 'a'.repeat(32),
    ADMIN_API_KEY: 'b'.repeat(32),
    LOG_LEVEL: 'debug',
  } as NodeJS.ProcessEnv);
});

describe('LoggerService — PII redaction', () => {
  beforeEach(() => resetLogger());

  it('redacts PII keys at any nesting depth', async () => {
    const captured: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        captured.push(chunk.toString());
        cb();
      },
    });
    const log = getLogger();
    // swap console transport silently
    log.underlying.clear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const winstonStream = require('winston');
    log.underlying.add(new winstonStream.transports.Stream({ stream }));
    log.info({
      email: 'kunal@example.com',
      nested: { card: '4242424242424242', name: 'ok' },
      arr: [{ phone: '+1-555-0100', ok: 'visible' }],
    }, 'event');
    
    // Wait for winston to write to the stream asynchronously
    await new Promise((resolve) => setTimeout(resolve, 20));

    const out = captured.join('');
    expect(out).not.toContain('kunal@example.com');
    expect(out).not.toContain('4242424242424242');
    expect(out).not.toContain('+1-555-0100');
    expect(out).toContain('[REDACTED]');
    expect(out).toContain('visible');
    expect(out).toContain('ok');
  });

  it('passes through non-PII fields untouched', async () => {
    const captured: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        captured.push(chunk.toString());
        cb();
      },
    });
    const log = getLogger();
    log.underlying.clear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const winstonStream = require('winston');
    log.underlying.add(new winstonStream.transports.Stream({ stream }));
    log.info({ source: 'stripe', count: 42 }, 'event');
    
    // Wait for winston to write to the stream asynchronously
    await new Promise((resolve) => setTimeout(resolve, 20));

    const out = captured.join('');
    expect(out).toContain('"source":"stripe"');
    expect(out).toContain('"count":42');
  });
});


