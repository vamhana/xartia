// C.0.02.03 — Онбординг: welcome-задача при приёме в коллектив.
//
// Зачем: новый участник после приёма не должен видеть пустой экран. В момент
// создания участника ему назначается задача «Первый день», в которой описан
// ровно один следующий шаг. Задача живёт в обычном домене задач (C.0.09),
// поэтому её видно в /tasks, по ней работает отчёт и ОТК — никакой отдельной
// сущности «онбординг» не нужно.
//
// Зависимости: tasks (C.0.09). Циклов нет: onboarding импортирует tasks,
// tasks не знает про onboarding.

import type { Task } from '../tasks/entity.js';
import { assignTaskService, createTaskService } from '../tasks/service.js';
import type { UUID } from '../types.js';

export interface WelcomeTaskInput {
  participantId: UUID;
  participantName: string;
  directionId: UUID;
  /** Внешний ID наставника, если он уже назначен. */
  mentorExternalId?: string | null;
  /** Кто создаёт задачу — Архитектор, принявший заявку. */
  actorId: UUID;
}

/**
 * Текст первой задачи. Сознательно короткий список из четырёх шагов:
 * первый день не должен превращаться в чтение документации на 40 страниц.
 */
export function welcomeTaskDescription(
  participantName: string,
  mentorExternalId?: string | null,
): string {
  const mentor = mentorExternalId
    ? `Наставник: ${mentorExternalId}. Вопросы — ему или в чат направления.`
    : 'Наставник ещё не назначен — вопросы задавай в чате направления.';

  return [
    `Первый день: ${participantName}.`,
    '',
    '1. Прочитай Хартию — 20 минут: docs/charter-specs/xartia.md,',
    '   статьи 1.1–1.11 (ценности, базовые блага, неизменяемое ядро).',
    '2. Подними окружение локально:',
    '   pnpm install → docker compose -f docker/docker-compose.yml up -d',
    '   → pnpm db:migrate → pnpm dev (API :3000, WS :3001, web :5173).',
    '3. Представься в чате направления: кто ты, что умеешь, что хочешь делать.',
    '4. Возьми первую задачу из очереди направления на странице «Задачи»',
    '   и сдай отчёт по ней — с этого начинается Поток.',
    '',
    mentor,
  ].join('\n');
}

/**
 * Создаёт и сразу назначает welcome-задачу новому участнику.
 * Бросает, если домен задач не смог создать задачу — вызывающий код обязан
 * решить, считать ли это критичным (в admin-контроллере — не критично).
 */
export async function createWelcomeTask(input: WelcomeTaskInput): Promise<Task> {
  const task = await createTaskService(
    {
      directionId: input.directionId,
      description: welcomeTaskDescription(
        input.participantName,
        input.mentorExternalId ?? null,
      ),
      priority: 'standard',
      requiredCompetencies: ['онбординг'],
    },
    input.actorId,
  );

  return assignTaskService(task.id, input.participantId, input.actorId);
}
