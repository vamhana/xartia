// Загрузка WS-тестового окружения.C:\Users\TD\Desktop\heart\scripts\lib\ws-env.ts
// Приоритет: переменные окружения → .ws-test-env.json → ошибка.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface WsTestEnv {
  token: string;
  participantId: string;
  directionId: string;
  name?: string;
  externalId?: string;
}

interface EnvFile {
  WS_TEST_TOKEN: string;
  WS_TEST_PID: string;
  WS_TEST_DIR: string;
  WS_TEST_NAME?: string;
  WS_TEST_EXTERNAL_ID?: string;
}

export async function loadWsEnv(): Promise<WsTestEnv> {
  // 1. Свежий файл — приоритетнее env, потому что env в cmd не обновляется
  // автоматически, и старые значения могут перебивать свежие из get-test-token.
  const file = resolve(process.cwd(), '.ws-test-env.json');
  try {
    const raw = await readFile(file, 'utf8');
    const data = JSON.parse(raw) as EnvFile;
    if (data.WS_TEST_TOKEN && data.WS_TEST_PID) {
      const expiresAt = (data as EnvFile & { WS_TEST_EXPIRES_AT?: string }).WS_TEST_EXPIRES_AT;
      const stillFresh =
        expiresAt !== undefined &&
        new Date(expiresAt).getTime() > Date.now() + 60_000;

      if (stillFresh) {
        return {
          token: data.WS_TEST_TOKEN,
          participantId: data.WS_TEST_PID,
          directionId: data.WS_TEST_DIR ?? '',
          ...(data.WS_TEST_NAME ? { name: data.WS_TEST_NAME } : {}),
          ...(data.WS_TEST_EXTERNAL_ID ? { externalId: data.WS_TEST_EXTERNAL_ID } : {}),
        };
      }
    }
  } catch {
    // файла нет / битый — идём дальше
  }

  // 2. Env — fallback, если файл просрочен или отсутствует
  const envToken = process.env['WS_TEST_TOKEN'];
  if (envToken) {
    return {
      token: envToken,
      participantId: process.env['WS_TEST_PID'] ?? '',
      directionId: process.env['WS_TEST_DIR'] ?? '',
      ...(process.env['WS_TEST_NAME'] ? { name: process.env['WS_TEST_NAME'] } : {}),
      ...(process.env['WS_TEST_EXTERNAL_ID'] ? { externalId: process.env['WS_TEST_EXTERNAL_ID'] } : {}),
    };
  }

  throw new Error(
    'Нет свежего .ws-test-env.json и нет WS_TEST_TOKEN в env.\n' +
    'Запусти: pnpm tsx scripts/get-test-token.ts',
  );
}

export async function isTokenExpired(): Promise<boolean> {
  const file = resolve(process.cwd(), '.ws-test-env.json');
  try {
    const raw = await readFile(file, 'utf8');
    const data = JSON.parse(raw) as { WS_TEST_EXPIRES_AT?: string };
    if (!data.WS_TEST_EXPIRES_AT) {return true;}
    return new Date(data.WS_TEST_EXPIRES_AT).getTime() < Date.now() + 60_000; // −60 сек запаса
  } catch {
    return true;
  }
}