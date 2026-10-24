// scripts/_env.ts
// Загрузка .env без зависимости от dotenv. В контейнере переменные уже
// проброшены через env_file — этот путь используется только локально.

import { readFile } from 'node:fs/promises';

export async function loadEnvIfNeeded(path = '.env'): Promise<void> {
  if (process.env.DATABASE_URL) {return;}
  try {
    const raw = await readFile(path, 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) {continue;}
      const m = t.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (!m) {continue;}
      const [, key, val] = m;
      if (!process.env[key]) {
        process.env[key] = val.replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* .env нет — полагаемся на окружение */
  }
}