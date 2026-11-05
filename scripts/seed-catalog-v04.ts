// I.9.09.40 — Сид каталога v0.4 (workflow + педагогическая компетенция + anchor'ы).
// Запуск: pnpm tsx scripts/seed-catalog-v04.ts
//
// Идемпотентно:
//   1. 0055 (Передать понимание...) — если нет, через proposal → approve → merge
//      с P24M. Если есть и to_calibrate → UPDATE до P24M.
//   2. 9 anchor'ов (0001/0009/0031 × 3 уровня 2/5/7) — через API,
//      идемпотентно по title.
//
// Запуск перед тестами (test-catalog-v04.ts) и в CI (после smoke: passport-v7).

import 'dotenv/config';

import { query, queryOne } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import {
  BASE,
  createAnchor,
  createCalibrationSession,   // не нужен, но импорт проверяет
  login,
  request,
} from './lib/passport-fixtures.js';

const ARCHITECT_PHONE = process.env['TEST_ARCHITECT_PHONE'] ?? '+79001234567';
const ARCHITECT_PASS = process.env['TEST_ARCHITECT_PASS'] ?? 'ChangeMe123456';

const TARGET_ATOM_ID = 'CYB.ATOM.0055';

// ─────────────────────────────────────────────────────────────────────
// Payload 0055 — «Передать понимание предметной области неспециалисту»
// A79–A83: ID = 0055, кластер requirements, все 5 измерений применимы,
// P24M (slow), version '0.1.0', status 'candidate' после merge.
// ─────────────────────────────────────────────────────────────────────

const ATOM_0055_PAYLOAD = {
  cluster: 'requirements_and_computational_thinking',
  name: 'Передать понимание предметной области неспециалисту',
  definition:
    'Способность объяснить ключевые понятия предметной области человеку ' +
    'без специальной подготовки так, чтобы он мог воспроизвести основную ' +
    'мысль и применить её в простом случае.',
  boundary_includes: [
    'Выбор уровня объяснения под слушателя',
    'Выбор аналогий и примеров',
    'Проверка понимания через обратную связь',
  ],
  boundary_excludes: [
    'Оценка знаний слушателя по 5 измерениям (это его паспорт)',
    'Педагогическое проектирование курса (отдельная компетенция D14)',
    'Замена предметной компетенции (учитель должен владеть атомом)',
  ],
  context:
    'Объяснение неспециалисту (другой домен, другой уровень). Слушатель ' +
    'может переспрашивать; проверяется, воспроизвёл ли он ключевую мысль.',
  input: 'Тема, слушатель (уровень), время, доступные примеры.',
  outcome:
    'Слушатель воспроизводит ключевую мысль своими словами и применяет ' +
    'её в простом случае.',
  assessment_criteria: {
    status: 'draft',
    U: 'Понимает, что значит «слушатель понял» (не «согласился»); различает понимание, запоминание и принятие.',
    X: 'Объясняет без жаргона; подбирает аналогии под опыт слушателя; проверяет, что его поняли, а не «кивнули».',
    D: 'Планирует объяснение: с чего начать, какие 2–3 идеи главные, какие примеры, где проверить понимание.',
    P: 'Проводит объяснение; адаптируется по ходу; отвечает на вопросы без раздражения.',
    E: 'Проверяет, что слушатель воспроизвёл мысль и применил её в простом случае; различает «не понял» и «не согласен».',
  },
  assessment_methods: [
    'Практическое объяснение неспециалисту (не из домена)',
    'Проверка воспроизведения слушателем',
    'Видео-анализ с разбором',
    'Обратная связь от слушателя',
  ],
  dimension_applicability: {
    U: { applicable: true, name: 'Понимание' },
    X: { applicable: true, name: 'Объяснение' },
    D: { applicable: true, name: 'Проектирование' },
    P: { applicable: true, name: 'Практика' },
    E: { applicable: true, name: 'Оценка' },
  },
  freshness_policy: {
    content_change_rate: 'slow',
    practice_review_policy: 'P24M',
  },
  version: '0.1.0',
} as const;

// ─────────────────────────────────────────────────────────────────────
// 1. ensure 0055
// ─────────────────────────────────────────────────────────────────────

async function ensureAtom0055(adminToken: string): Promise<void> {
  // Проверяем, существует ли 0055.
  const existing = await queryOne<{ atom_id: string; freshness_policy: { practice_review_policy?: string } }>(
    `SELECT atom_id, freshness_policy FROM competency_atoms WHERE atom_id = $1`,
    [TARGET_ATOM_ID],
  );

  if (existing) {
    // 0055 существует. Проверяем freshness_policy: если to_calibrate — UPDATE
    // до P24M (актуальный payload). Это dev-fix для смоук-запусков.
    if (existing.freshness_policy?.practice_review_policy === 'to_calibrate') {
      await query(
        `UPDATE competency_atoms
            SET freshness_policy = $2::jsonb, updated_at = now()
          WHERE atom_id = $1`,
        [TARGET_ATOM_ID, JSON.stringify(ATOM_0055_PAYLOAD.freshness_policy)],
      );
      console.log(`FIX  ${TARGET_ATOM_ID}: freshness_policy to_calibrate → P24M`);
    } else {
      console.log(`SKIP ${TARGET_ATOM_ID}: already exists (freshness ok)`);
    }
    return;
  }

  // Создаём через workflow: proposal → submit → in_review → approve → merge.
  const create = await request<{ id?: string }>(
    'POST', '/passport/catalog/proposals',
    {
      proposalType: 'new_atom',
      payload: ATOM_0055_PAYLOAD,
    },
    adminToken,
  );
  if (create.status !== 201 || !create.data.id) {
    throw new Error(
      `create proposal → ${create.status} ${JSON.stringify(create.data).slice(0, 200)}`,
    );
  }
  const proposalId = create.data.id;

  for (const status of ['submitted', 'in_review', 'approved'] as const) {
    const r = await request(
      'PATCH', `/passport/catalog/proposals/${proposalId}`,
      { status, reviewNote: 'seed-catalog-v04' },
      adminToken,
    );
    if (r.status !== 200) {
      throw new Error(`PATCH ${status} → ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    }
  }

  const merge = await request<{ atomId?: string; status?: string }>(
    'POST', `/passport/catalog/proposals/${proposalId}/merge`,
    undefined,
    adminToken,
  );
  if (merge.status !== 200 || merge.data.atomId !== TARGET_ATOM_ID) {
    throw new Error(
      `merge → ${merge.status} ${JSON.stringify(merge.data).slice(0, 200)}`,
    );
  }
  console.log(`OK   ${TARGET_ATOM_ID}: created via workflow (proposal ${proposalId})`);
}

// ─────────────────────────────────────────────────────────────────────
// 2. ensure 9 anchor'ов
// ─────────────────────────────────────────────────────────────────────

interface AnchorSpec {
  atomId: string;
  dimension: 'U' | 'X' | 'D' | 'P' | 'E';
  level: number;
  title: string;
  description: string;
  content: Record<string, unknown>;
}

const ANCHOR_SPECS: AnchorSpec[] = [
  // CYB.ATOM.0001 — Преобразовать описание задачи в проверяемые требования
  { atomId: 'CYB.ATOM.0001', dimension: 'P', level: 2, title: 'anchor:0001:P:2',
    description: 'Черновой эталон уровня 2 (требует ревью)',
    content: { text: 'Из описания «сделать удобный поиск» выделен 1–2 требования с критериями; ключевое свойство «удобство» не операционализировано.' } },
  { atomId: 'CYB.ATOM.0001', dimension: 'P', level: 5, title: 'anchor:0001:P:5',
    description: 'Черновой эталон уровня 5 (требует ревью)',
    content: { text: 'Спецификация с 5–7 требованиями, каждый критерий приёмки проверяем, есть связь требование→критерий; остались 1–2 неоднозначности, зафиксированные в вопросах.' } },
  { atomId: 'CYB.ATOM.0001', dimension: 'P', level: 7, title: 'anchor:0001:P:7',
    description: 'Черновой эталон уровня 7 (требует ревью)',
    content: { text: 'Спецификация с полной трассировкой; все неоднозначности выявлены и превращены в вопросы к заказчику с указанием последствий; критерии проверяемы независимо; есть проверка на противоречия.' } },
  // CYB.ATOM.0009 — Реализовать функцию по заданному контракту
  { atomId: 'CYB.ATOM.0009', dimension: 'P', level: 2, title: 'anchor:0009:P:2',
    description: 'Черновой эталон уровня 2 (требует ревью)',
    content: { text: 'Реализация работает на примере из контракта; граничные случаи (null, пустая строка) падают.' } },
  { atomId: 'CYB.ATOM.0009', dimension: 'P', level: 5, title: 'anchor:0009:P:5',
    description: 'Черновой эталон уровня 5 (требует ревью)',
    content: { text: 'Реализация проходит все видимые тесты; 1–2 скрытых граничных случая (переполнение, отрицательные) — на грани, но не ломают; обработка ошибок по контракту.' } },
  { atomId: 'CYB.ATOM.0009', dimension: 'P', level: 7, title: 'anchor:0009:P:7',
    description: 'Черновой эталон уровня 7 (требует ревью)',
    content: { text: 'Реализация проходит видимые и скрытые тесты; самостоятельно добавлены проверки на граничные и ошибочные входы, соответствующие контракту; объясняет, почему выбрана такая структура; известные ограничения зафиксированы.' } },
  // CYB.ATOM.0031 — Реализовать автоматический модульный тест
  { atomId: 'CYB.ATOM.0031', dimension: 'P', level: 2, title: 'anchor:0031:P:2',
    description: 'Черновой эталон уровня 2 (требует ревью)',
    content: { text: 'Один тест на happy path; нет проверки граничных случаев; падает при малейшем изменении.' } },
  { atomId: 'CYB.ATOM.0031', dimension: 'P', level: 5, title: 'anchor:0031:P:5',
    description: 'Черновой эталон уровня 5 (требует ревью)',
    content: { text: 'Несколько тестов: happy + 1–2 граничных; детерминирован; изолирован (без реальных зависимостей); при внесении контролируемого дефекта в функцию тест падает.' } },
  { atomId: 'CYB.ATOM.0031', dimension: 'P', level: 7, title: 'anchor:0031:P:7',
    description: 'Черновой эталон уровня 7 (требует ревью)',
    content: { text: 'Покрыты happy, граничные, ошибочные; тесты независимы; при мутации (несколько контролируемых дефектов) — падают, а не «зеленеют случайно»; объясняет, что тест НЕ проверяет.' } },
];

async function ensureAnchors(adminToken: string): Promise<void> {
  for (const spec of ANCHOR_SPECS) {
    // Проверяем по title.
    const qs = new URLSearchParams({
      atomId: spec.atomId,
      dimension: spec.dimension,
    });
    const list = await request<{ data: Array<{ title: string }> }>(
      'GET', `/passport/calibration/anchors?${qs.toString()}`,
      undefined,
      adminToken,
    );
    const exists = list.data.data?.some((a) => a.title === spec.title);
    if (exists) {
      console.log(`SKIP ${spec.title}: already exists`);
      continue;
    }
    const r = await createAnchor(adminToken, {
      atomId: spec.atomId,
      dimension: spec.dimension,
      level: spec.level,
      title: spec.title,
      description: spec.description,
      content: spec.content,
    });
    if (r.status !== 201) {
      throw new Error(`create anchor ${spec.title} → ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    }
    console.log(`OK   ${spec.title}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`BASE=${BASE}`);
  const admin = await login(ARCHITECT_PHONE, ARCHITECT_PASS);
  console.log(`admin: ${admin.id}`);

  await ensureAtom0055(admin.token);
  await ensureAnchors(admin.token);

  // Итог.
  const atoms = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM competency_atoms`,
  );
  const anchors = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM anchor_examples`,
  );
  const tc = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM competency_atoms
      WHERE freshness_policy->>'practice_review_policy' = 'to_calibrate'`,
  );

  console.log('\n─── seed-catalog-v04: OK ───');
  console.log(`competency_atoms:      total=${atoms?.n}  to_calibrate=${tc?.n}`);
  console.log(`anchor_examples:       total=${anchors?.n}`);

  await gracefulShutdown();
}

main().catch(async (e) => {
  console.error('FATAL:', e instanceof Error ? e.stack ?? e.message : e);
  try { await gracefulShutdown(); } catch { /* ignore */ }
  process.exit(1);
});