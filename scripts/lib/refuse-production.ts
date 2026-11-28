// Защита скриптов, которые меняют каталог и паспорта, от запуска не там
// (Фаза 1, §7.1 и §8.6 п.7 плана xartia-core-implementation).
//
// Две независимые проверки:
//   1. NODE_ENV=production: отказ безусловный, обойти нельзя;
//   2. DATABASE_URL указывает на «удалённый» хост (полное доменное имя или
//      публичный IP): отказ, если не задано явное ALLOW_REMOTE_TEST_DB=1.
//      Локальными считаются localhost, 127.*, ::1, частные сети RFC1918,
//      *.local / *.localhost, *.docker.internal (host.docker.internal в
//      WSL/Docker Desktop) и «голые» имена без точки (docker-compose).
//      Вторая проверка нужна на случай, когда production-окружение не
//      выставляет NODE_ENV. Это страховка, а не гарантия: «голое» имя сервиса
//      в Kubernetes она не отличит от docker-compose.
//
// Нераспознаваемый или отсутствующий DATABASE_URL вторую проверку не
// блокирует (скрипт упадёт на подключении сам).

export type GuardVerdict =
  | { allowed: true }
  | { allowed: false; code: 'node_env_production' | 'remote_database'; reason: string };

const PRIVATE_V4 = /^(127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|0\.0\.0\.0)$/;

export function databaseHost(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) {
    return null;
  }
  try {
    const host = new URL(databaseUrl).hostname.replace(/^\[|\]$/g, '');
    return host === '' ? null : host.toLowerCase();
  } catch {
    return null;
  }
}

export function isLocalLookingHost(host: string): boolean {
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost') || host.endsWith('.local')
      || host.endsWith('.docker.internal')) {
    return true;
  }
  if (PRIVATE_V4.test(host)) {
    return true;
  }
  // Голое имя без точки (docker-compose service) и не IPv4-адрес.
  return !host.includes('.') && !host.includes(':');
}

export function checkDestructiveScriptAllowed(env: NodeJS.ProcessEnv = process.env): GuardVerdict {
  if (env['NODE_ENV'] === 'production') {
    return {
      allowed: false,
      code: 'node_env_production',
      reason: 'NODE_ENV=production: скрипт меняет каталог и паспорта и не может выполняться на production (обойти нельзя).',
    };
  }
  const host = databaseHost(env['DATABASE_URL']);
  if (host !== null && !isLocalLookingHost(host) && env['ALLOW_REMOTE_TEST_DB'] !== '1') {
    return {
      allowed: false,
      code: 'remote_database',
      reason: `DATABASE_URL указывает на удалённый хост «${host}». Скрипт предназначен для одноразовой dev/test БД. `
        + 'Если это действительно тестовая БД, задайте ALLOW_REMOTE_TEST_DB=1.',
    };
  }
  return { allowed: true };
}

/** Вызывать первой строкой точки входа, до любых обращений к БД и API. */
export function refuseProduction(scriptName: string, env: NodeJS.ProcessEnv = process.env): void {
  const verdict = checkDestructiveScriptAllowed(env);
  if (!verdict.allowed) {
    throw new Error(`${scriptName}: отказ. ${verdict.reason}`);
  }
}
