// Фаза 1 — тесты защиты скриптов от запуска на production.
// Запуск: pnpm exec vitest run --root . scripts/refuse-production.test.ts

import { describe, expect, it } from 'vitest';

import {
  checkDestructiveScriptAllowed,
  databaseHost,
  isLocalLookingHost,
  refuseProduction,
} from './lib/refuse-production.js';

const env = (o: Record<string, string | undefined>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv;
const url = (host: string): string => `postgresql://charter:charter@${host}:5432/charter`;

describe('NODE_ENV=production', () => {
  it('is refused unconditionally, including with the remote-database override', () => {
    for (const e of [
      { NODE_ENV: 'production' },
      { NODE_ENV: 'production', DATABASE_URL: url('localhost') },
      { NODE_ENV: 'production', DATABASE_URL: url('db.example.com'), ALLOW_REMOTE_TEST_DB: '1' },
    ]) {
      const v = checkDestructiveScriptAllowed(env(e));
      expect(v.allowed).toBe(false);
      if (!v.allowed) {expect(v.code).toBe('node_env_production');}
    }
  });

  it('allows development, test and an unset NODE_ENV on a local database', () => {
    for (const NODE_ENV of ['development', 'test', '']) {
      expect(checkDestructiveScriptAllowed(env({ NODE_ENV, DATABASE_URL: url('localhost') })).allowed).toBe(true);
    }
    expect(checkDestructiveScriptAllowed(env({ DATABASE_URL: url('127.0.0.1') })).allowed).toBe(true);
  });
});

describe('remote database host', () => {
  it.each([
    'localhost', '127.0.0.1', '127.1.2.3', '[::1]', '10.0.0.5', '192.168.1.20', '172.16.0.1', '172.31.255.1',
    'postgres', 'db', 'db.local', 'pg.localhost', 'host.docker.internal', 'gateway.docker.internal',
  ])('treats %s as local', (host) => {
    expect(checkDestructiveScriptAllowed(env({ DATABASE_URL: url(host) })).allowed, host).toBe(true);
  });

  it.each([
    'db.example.com', 'xyz.rds.amazonaws.com', 'prod-db.internal.company.io', 'docker.internal.example.com', 'notdocker.internal.com', '8.8.8.8', '172.32.0.1', '172.15.0.1', '203.0.113.7',
  ])('refuses %s without an explicit override', (host) => {
    const v = checkDestructiveScriptAllowed(env({ DATABASE_URL: url(host) }));
    expect(v.allowed, host).toBe(false);
    if (!v.allowed) {
      expect(v.code).toBe('remote_database');
      expect(v.reason).toContain('ALLOW_REMOTE_TEST_DB=1');
    }
  });

  it('lets an explicit ALLOW_REMOTE_TEST_DB=1 permit a remote test database', () => {
    const e = env({ DATABASE_URL: url('ci-db.example.com'), ALLOW_REMOTE_TEST_DB: '1' });
    expect(checkDestructiveScriptAllowed(e).allowed).toBe(true);
    // Любое другое значение не считается согласием.
    expect(checkDestructiveScriptAllowed(env({ DATABASE_URL: url('ci-db.example.com'), ALLOW_REMOTE_TEST_DB: 'true' })).allowed).toBe(false);
  });

  it('does not block on a missing or unparseable DATABASE_URL (the script fails on connect itself)', () => {
    expect(checkDestructiveScriptAllowed(env({})).allowed).toBe(true);
    expect(checkDestructiveScriptAllowed(env({ DATABASE_URL: 'not a url' })).allowed).toBe(true);
    expect(databaseHost('not a url')).toBeNull();
    expect(databaseHost(undefined)).toBeNull();
    expect(databaseHost('postgres:///charter?host=/var/run/postgresql')).toBeNull();
  });

  it('classifies hosts case-insensitively and distinguishes IPv4 from bare names', () => {
    expect(databaseHost(url('DB.Example.COM'))).toBe('db.example.com');
    expect(isLocalLookingHost('203.0.113.7')).toBe(false);
    expect(isLocalLookingHost('postgres')).toBe(true);
  });
});

describe('refuseProduction', () => {
  it('throws an error naming the script and the reason', () => {
    expect(() => refuseProduction('prepare-passport-test-fixtures.ts', env({ NODE_ENV: 'production' })))
      .toThrowError(/prepare-passport-test-fixtures\.ts: отказ\. NODE_ENV=production/);
    expect(() => refuseProduction('x.ts', env({ DATABASE_URL: url('db.example.com') })))
      .toThrowError(/удалённый хост «db\.example\.com»/);
  });

  it('does nothing when allowed', () => {
    expect(() => refuseProduction('x.ts', env({ NODE_ENV: 'test', DATABASE_URL: url('localhost') }))).not.toThrow();
  });
});
