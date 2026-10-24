// |W.0.01.02|WS|Core|TypeScript|src/ws/_helpers.ts
// Общие хелперы для emit-функций W.2.*.
// Разрывает дублирование кода между каналами.

import { redisPub } from '../lib/redis.js';

export async function publish(channel: string, envelope: unknown): Promise<number> {
  return redisPub.publish(channel, JSON.stringify(envelope));
}

export async function sendToParticipant(
  participantId: string,
  event: string,
  payload: unknown,
): Promise<number> {
  return redisPub.publish(
    `ws:participant:${participantId}`,
    JSON.stringify({ event, payload }),
  );
}

export async function sendToDirection(
  directionId: string,
  event: string,
  payload: unknown,
): Promise<number> {
  return redisPub.publish(
    `ws:direction:${directionId}`,
    JSON.stringify({ event, payload }),
  );
}