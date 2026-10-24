// W.2.02.01 — Канал WS tasks
// События по задачам: назначение, взятие, сдача, приёмка, возврат.
// Персональные уведомления исполнителю + broadcast Совету направления.
//
// АРХИТЕКТУРНОЕ РЕШЕНИЕ (единый паттерн W.2.*):
// - registerTaskChannel() — только для WS-процесса.
// - emitTaskXxx() — публикация в Redis. Работает из API/worker.

import type { Priority, TaskStatus } from '../core/types.js';
import { logger } from '../lib/logger.js';

import { publish, sendToParticipant, sendToDirection } from './_helpers.js';

// -------- Типы --------

export interface TaskEventPayload {
  id: string;
  externalId: string;
  directionId: string;
  planId: string | null;
  description: string;
  priority: Priority;
  status: TaskStatus;
  assignedTo: string | null;
  deadline: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskReturnedPayload {
  task: TaskEventPayload;
  reason: string;
  returnedAt: string;
}

// -------- Redis-канал --------

const REDIS_CHANNEL = 'ws:broadcast:tasks';

// -------- Регистрация --------

export async function registerTaskChannel(): Promise<void> {
  logger.info({ channel: 'tasks' }, 'ws: tasks channel registered');
}

// -------- Emit --------

export async function emitTaskAssigned(
  task: TaskEventPayload,
  participantId: string,
): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'task.assigned',
      payload: { task, assignedTo: participantId },
    });

    // Персональное уведомление исполнителю — мгновенно.
    await sendToParticipant(participantId, 'task.assigned.personal', {
      taskId: task.id,
      externalId: task.externalId,
      description: task.description,
      priority: task.priority,
      deadline: task.deadline,
      at: new Date().toISOString(),
    });
  } catch (e) {
    logger.warn({ err: e, taskId: task.id }, 'ws: emitTaskAssigned failed');
  }
}

export async function emitTaskStatusChanged(
  task: TaskEventPayload,
  oldStatus: TaskStatus,
): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'task.status_changed',
      payload: { task, oldStatus, newStatus: task.status },
    });

    // Исполнителю персонально — если у него есть assignedTo.
    if (task.assignedTo) {
      await sendToParticipant(task.assignedTo, 'task.status_changed.personal', {
        taskId: task.id,
        oldStatus,
        newStatus: task.status,
        at: new Date().toISOString(),
      });
    }
  } catch (e) {
    logger.warn({ err: e, taskId: task.id }, 'ws: emitTaskStatusChanged failed');
  }
}

export async function emitTaskSubmitted(task: TaskEventPayload): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'task.submitted',
      payload: task,
    });

    // ОТК направления — чтобы очередь пополнилась в реальном времени.
    await sendToDirection(task.directionId, 'task.submitted.for_otc', {
      taskId: task.id,
      externalId: task.externalId,
      assignedTo: task.assignedTo,
      submittedAt: task.updatedAt,
    });
  } catch (e) {
    logger.warn({ err: e, taskId: task.id }, 'ws: emitTaskSubmitted failed');
  }
}

export async function emitTaskAccepted(task: TaskEventPayload): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'task.accepted',
      payload: task,
    });

    // Исполнителю — положительный feedback + уведомление о Потоке +1.
    if (task.assignedTo) {
      await sendToParticipant(task.assignedTo, 'task.accepted.personal', {
        taskId: task.id,
        externalId: task.externalId,
        flowAwarded: 1,
        at: new Date().toISOString(),
      });
    }
  } catch (e) {
    logger.warn({ err: e, taskId: task.id }, 'ws: emitTaskAccepted failed');
  }
}

export async function emitTaskReturned(
  task: TaskEventPayload,
  reason: string,
): Promise<void> {
  try {
    const payload: TaskReturnedPayload = {
      task,
      reason,
      returnedAt: new Date().toISOString(),
    };
    await publish(REDIS_CHANNEL, {
      event: 'task.returned',
      payload,
    });

    // Исполнителю — с причиной (не наказание, а обратная связь, I.1.9.3).
    if (task.assignedTo) {
      await sendToParticipant(task.assignedTo, 'task.returned.personal', {
        taskId: task.id,
        externalId: task.externalId,
        reason,
        at: new Date().toISOString(),
      });
    }
  } catch (e) {
    logger.warn({ err: e, taskId: task.id }, 'ws: emitTaskReturned failed');
  }
}