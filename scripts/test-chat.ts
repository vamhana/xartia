// scripts/test-chat.ts
// Ручной интеграционный тест Chat (A.1.36.01 + C.0.36.02).
//
// Покрытие:
//   - auth guards (401 без токена)
//   - GET /chat/channels — список моих каналов (rich)
//   - POST /chat/channels/direct — создание + идемпотентность
//   - GET /chat/channels/by-string/:channel_id
//   - GET /chat/channels/:id — по внутреннему UUID
//   - GET /chat/channels/:id/members — участники
//   - POST /chat/channels/:id/messages — отправка
//   - GET /chat/channels/:id/messages — история + rich-поля
//   - PATCH /chat/messages/:id — редактирование (автор / не автор)
//   - DELETE /chat/messages/:id — удаление (автор / не автор)
//   - reply_to_id — ответ на сообщение + разворот в истории
//   - Валидации 422 (пустой content, >10000, кривой reply_to_id)
//   - Direct-guards: нельзя выйти, нельзя архивировать, нельзя вступить
//   - Scope-канал (direction) — создание, join/leave, archive
//   - B1–B5: worker не член чужого канала → 403 на GET/:id, members,
//     join, messages/:id, archive.
//
// Preflight (SQL): удаляет сообщения в direct-канале Архитектор ↔ worker
// и записи chat_channel_members. Сам канал оставляет — используется повторно.
// НЕ использовать на prod-БД.
//
// Запуск:  pnpm tsx scripts/test-chat.ts [+79…] [пароль] [worker-phone] [worker-pass]
// Дефолты: из env ARCHITECT_PHONE / ARCHITECT_PASSWORD, worker — обязателен.

import 'dotenv/config';

import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface Client {
  token: string;
  participantId: string;
  directionId: string;
  name: string;
  phone: string;
}

interface RawResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

interface ChannelRich {
  id: string;
  channelId: string;
  channelType: 'direct' | 'direction' | 'cell' | 'council' | 'project';
  scopeId: string | null;
  name: string | null;
  displayName: string;
  peerId: string | null;
  peerName: string | null;
  peerExternalId: string | null;
  archivedAt: string | null;
  createdAt: string;
  lastMessage: { id: string; senderId: string; content: string; createdAt: string } | null;
}

interface MessageRich {
  id: string;
  channelId: string;
  senderId: string;
  content: string;
  mentions: string[];
  attachments: Array<{ key: string; name: string; size: number; mime: string }>;
  replyToId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  senderName: string | null;
  senderExternalId: string | null;
  replyTo: { id: string; senderId: string; content: string } | null;
}

// ─────────────────────────────────────────────────────────────────
// Client / fetch
// ─────────────────────────────────────────────────────────────────

async function makeClient(phone: string, password: string): Promise<Client> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`login failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json() as {
    access_token: string;
    participant: {
      id: string;
      direction_id: string;
      name: string;
      phone?: string;
    };
  };
  return {
    token: data.access_token,
    participantId: data.participant.id,
    directionId: data.participant.direction_id,
    name: data.participant.name,
    phone: data.participant.phone ?? phone,
  };
}

async function raw(
  c: Client | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<RawResponse> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {headers['Content-Type'] = 'application/json';}
  if (c) {headers['Authorization'] = `Bearer ${c.token}`;}

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {parsed = text ? JSON.parse(text) : null;} catch {parsed = text;}
  return { status: res.status, headers: res.headers, body: parsed };
}

// ─────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────

let failures = 0;

function log(label: string, status: number, data: unknown): void {
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  const trimmed = json && json.length > 300 ? `${json.slice(0, 300)}…` : json;
  console.warn(`[${status}] ${label} → ${trimmed}`);
}

function ok(msg: string): void {console.warn(`  ✓ ${msg}`);}
function fail(msg: string): void {
  console.error(`  ✗ ${msg}`);
  failures++;
}

function expectStatus(label: string, r: RawResponse, expected: number): boolean {
  if (r.status !== expected) {
    fail(`${label}: ожидался ${expected}, получен ${r.status}`);
    return false;
  }
  ok(`${label}: ${expected}`);
  return true;
}

function expectAuditId(label: string, body: unknown): boolean {
  if (!body || typeof body !== 'object' || !('audit_id' in body)) {
    fail(`${label}: нет audit_id в ответе`);
    return false;
  }
  ok(`${label}: audit_id присутствует`);
  return true;
}

// ─────────────────────────────────────────────────────────────────
// Preflight
// ─────────────────────────────────────────────────────────────────

/**
 * Чистит состояние между прогонами:
 *   1. Сообщения в direct-канале Архитектор ↔ worker.
 *   2. Scope-каналы, созданные Архитектором в тестах (direction/cell/council/project),
 *      целиком — вместе с сообщениями и members. Иначе следующий прогон
 *      получает уже архивированный канал (getOrCreateChannel находит его
 *      по channel_id), и sectionScopeChannel падает на «не найден в my channels».
 *   3. Rate-limit auth.* — чтобы при частых прогонах login не получал 429.
 *
 * NB: опасно на prod. Используется только в scripts/test-*.ts.
 */
async function preflight(arch: Client, worker: Client): Promise<void> {
  const { query } = await import('../src/lib/db.js');

  // ── 1. Direct Архитектор ↔ worker ─────────────────────────────
  await query(
    `DELETE FROM chat_messages
      WHERE channel_id IN (
        SELECT id FROM chat_channels
         WHERE channel_id =
               'direct:'
               || LEAST($1::text, $2::text) || ':'
               || GREATEST($1::text, $2::text)
      )`,
    [arch.participantId, worker.participantId],
  );

  const directChannelId =
    `direct:${arch.participantId < worker.participantId ? arch.participantId : worker.participantId}` +
    `:${arch.participantId < worker.participantId ? worker.participantId : arch.participantId}`;
  try {await redis.del(`chat:${directChannelId}:recent`);} catch {/* ignore */}

  // ── 2. Scope-каналы, созданные Архитектором в тестах ─────────
  const scopeRows = await query<{ id: string; channel_id: string }>(
    `SELECT id, channel_id FROM chat_channels
      WHERE created_by = $1
        AND channel_type IN ('direction', 'cell', 'council', 'project')`,
    [arch.participantId],
  );

  if (scopeRows.length > 0) {
    const ids = scopeRows.map((r) => r.id);
    await query(
      `DELETE FROM chat_messages WHERE channel_id = ANY($1::uuid[])`,
      [ids],
    );
    await query(
      `DELETE FROM chat_channel_members WHERE channel_id = ANY($1::uuid[])`,
      [ids],
    );
    await query(
      `DELETE FROM chat_channels WHERE id = ANY($1::uuid[])`,
      [ids],
    );

    for (const r of scopeRows) {
      try {await redis.del(`chat:${r.channel_id}:recent`);} catch {/* ignore */}
    }
  }

  // ── 3. Rate-limit auth.* ─────────────────────────────────────
  for (const pattern of ['ratelimit:auth.login:*', 'ratelimit:auth.register:*']) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) {await redis.del(...keys);}
    } while (cursor !== '0');
  }

  console.warn(
    `→ Preflight: direct-messages + ${scopeRows.length} scope-каналов + ratelimit:auth.* очищены`,
  );
}

// ─────────────────────────────────────────────────────────────────
// Sections
// ─────────────────────────────────────────────────────────────────

async function sectionAuthGuards(): Promise<void> {
  console.warn('\n=== Auth guards ===');

  const r1 = await raw(null, 'GET', '/chat/channels');
  log('GET /chat/channels (no auth)', r1.status, r1.body);
  expectStatus('unauth /chat/channels', r1, 401);

  const r2 = await raw(null, 'POST', '/chat/channels/direct', {
    participant_id: '00000000-0000-0000-0000-000000000000',
  });
  log('POST /chat/channels/direct (no auth)', r2.status, r2.body);
  expectStatus('unauth /chat/channels/direct', r2, 401);
}

async function sectionMyChannels(arch: Client): Promise<void> {
  console.warn('\n=== GET /chat/channels ===');

  const r = await raw(arch, 'GET', '/chat/channels');
  log('GET /chat/channels', r.status, r.body);
  if (!expectStatus('my channels', r, 200)) {return;}
  expectAuditId('my channels', r.body);

  const b = r.body as { data: ChannelRich[] };
  if (!Array.isArray(b.data)) {fail('my channels: data не массив'); return;}

  ok(`my channels.data: ${b.data.length}`);

  // Проверим rich-поля на первом канале, если он есть.
  if (b.data.length > 0) {
    const c = b.data[0]!;
    for (const key of ['id','channelId','channelType','displayName','createdAt'] as const) {
      if (key in c) {ok(`channel.${key}: ${String(c[key]).slice(0, 60)}`);}
      else {fail(`channel: нет поля ${key}`);}
    }
    if ('lastMessage' in c) {
      ok(`channel.lastMessage: ${c.lastMessage ? 'есть' : 'null'}`);
    } else {
      fail('channel: нет поля lastMessage');
    }
  }
}

async function sectionDirectChannel(arch: Client, worker: Client): Promise<{
  channelDbId: string;
  channelStringId: string;
} | null> {
  console.warn('\n=== POST /chat/channels/direct ===');

  // 1. Создать.
  const r1 = await raw(arch, 'POST', '/chat/channels/direct', {
    participant_id: worker.participantId,
  });
  log('POST /chat/channels/direct', r1.status, r1.body);
  if (!expectStatus('create direct', r1, 201)) {return null;}
  expectAuditId('create direct', r1.body);

  const ch = r1.body as ChannelRich;
  if (ch.channelType !== 'direct') {fail(`channelType=${ch.channelType}, ожидался 'direct'`);}
  else {ok('channelType=direct');}

  // POST /chat/channels/direct возвращает сырой ChatChannel: без peerId,
  // peerName, displayName, lastMessage. Rich-форма доступна только через
  // GET /chat/channels. Проверяем rich-поля отдельным запросом.
  const rList = await raw(arch, 'GET', '/chat/channels');
  if (rList.status === 200) {
    const lb = rList.body as { data: ChannelRich[] };
    const found = lb.data.find((x) => x.id === ch.id);
    if (found && found.peerId === worker.participantId) {
      ok(`rich peerId (list): ${found.peerId.slice(0, 8)}…`);
    } else {
      fail(`rich peerId (list): ${found?.peerId}`);
    }
    if (found && found.displayName === worker.name) {
      ok(`rich displayName (list): ${found.displayName}`);
    } else {
      fail(`rich displayName (list): ${found?.displayName}`);
    }
    if (found && found.channelType === 'direct') {
      ok('rich channelType (list): direct');
    } else {
      fail(`rich channelType (list): ${found?.channelType}`);
    }
  } else {
    fail(`GET /chat/channels для проверки rich: ${rList.status}`);
  }

  // 2. Идемпотентность: второй вызов возвращает тот же channel_id.
  const r2 = await raw(arch, 'POST', '/chat/channels/direct', {
    participant_id: worker.participantId,
  });
  log('POST /chat/channels/direct (повтор)', r2.status, r2.body);
  if (!expectStatus('direct (повтор)', r2, 201)) {return null;}
  const ch2 = r2.body as ChannelRich;
  if (ch2.channelId === ch.channelId) {ok(`идемпотентность: channelId=${ch.channelId.slice(0, 40)}…`);}
  else {fail(`channelId разошлись: ${ch.channelId} vs ${ch2.channelId}`);}

  // 3. Обратный вызов от worker — тот же канал.
  const r3 = await raw(worker, 'POST', '/chat/channels/direct', {
    participant_id: arch.participantId,
  });
  log('POST /chat/channels/direct (worker→arch)', r3.status, r3.body);
  if (r3.status === 201) {
    const ch3 = r3.body as ChannelRich;
    if (ch3.channelId === ch.channelId) {ok('обратный вызов: тот же channelId');}
    else {fail(`обратный channelId разошёлся: ${ch3.channelId}`);}
  }

  // 4. by-string.
  const enc = encodeURIComponent(ch.channelId);
  const r4 = await raw(arch, 'GET', `/chat/channels/by-string/${enc}`);
  log(`GET by-string ${ch.channelId.slice(0, 30)}…`, r4.status, r4.body);
  if (expectStatus('by-string', r4, 200)) {
    const ch4 = r4.body as ChannelRich;
    if (ch4.channelId === ch.channelId) {ok('by-string: совпадает');}
    else {fail('by-string: несовпадение');}
  }

  // 5. По внутреннему UUID.
  const r5 = await raw(arch, 'GET', `/chat/channels/${ch.id}`);
  log(`GET /chat/channels/${ch.id.slice(0, 8)}…`, r5.status, r5.body);
  expectStatus('get by UUID', r5, 200);

  // 6. Self-direct запрещён.
  const r6 = await raw(arch, 'POST', '/chat/channels/direct', {
    participant_id: arch.participantId,
  });
  log('POST /chat/channels/direct (self)', r6.status, r6.body);
  expectStatus('direct (self → 4xx)', r6, 422);

  return { channelDbId: ch.id, channelStringId: ch.channelId };
}

async function sectionSendAndRead(
  arch: Client,
  worker: Client,
  ch: { channelDbId: string; channelStringId: string },
): Promise<string | null> {
  console.warn('\n=== POST/GET /chat/channels/:id/messages ===');

  // 1. Отправить сообщение от Архитектора.
  const content = `e2e-chat ${Date.now()}`;
  const r1 = await raw(arch, 'POST', `/chat/channels/${ch.channelDbId}/messages`, {
    content,
  });
  log('POST message (arch)', r1.status, r1.body);
  if (!expectStatus('send message', r1, 201)) {return null;}
  expectAuditId('send message', r1.body);

  const m = r1.body as MessageRich;
  if (m.content === content) {ok('content совпадает');}
  else {fail(`content=${m.content.slice(0, 60)}, ожидалось ${content.slice(0, 60)}`);}

  if (m.senderId === arch.participantId) {ok('senderId=arch');}
  else {fail(`senderId=${m.senderId}`);}

  // 2. Сообщение от worker.
  const r2 = await raw(worker, 'POST', `/chat/channels/${ch.channelDbId}/messages`, {
    content: `e2e-reply ${Date.now()}`,
  });
  log('POST message (worker)', r2.status, r2.body);
  if (!expectStatus('send message (worker)', r2, 201)) {return m.id;}

  // 3. История.
  const r3 = await raw(arch, 'GET', `/chat/channels/${ch.channelDbId}/messages?limit=50`);
  log('GET history', r3.status, r3.body);
  if (!expectStatus('history', r3, 200)) {return m.id;}
  expectAuditId('history', r3.body);

  const h = r3.body as { data: MessageRich[] };
  if (!Array.isArray(h.data)) {fail('history: data не массив'); return m.id;}

  ok(`history.data: ${h.data.length} сообщений`);

  // Rich-поля.
  const sample = h.data[0];
  if (sample) {
    for (const key of ['senderName','senderExternalId','replyTo'] as const) {
      if (key in sample) {ok(`msg.${key}: ${JSON.stringify(sample[key]).slice(0, 60)}`);}
      else {fail(`msg: нет поля ${key}`);}
    }
  }

  // Наше сообщение присутствует.
  const found = h.data.find((x) => x.id === m.id);
  if (found) {ok('отправленное сообщение найдено в истории');}
  else {fail('отправленное сообщение не найдено в истории');}

  return m.id;
}

async function sectionReply(
  worker: Client,
  ch: { channelDbId: string; channelStringId: string },
  parentId: string,
): Promise<void> {
  console.warn('\n=== Reply (reply_to_id) ===');

  const content = `e2e-reply-to ${Date.now()}`;
  const r = await raw(worker, 'POST', `/chat/channels/${ch.channelDbId}/messages`, {
    content,
    reply_to_id: parentId,
  });
  log('POST reply', r.status, r.body);
  if (!expectStatus('send reply', r, 201)) {return;}

  const m = r.body as MessageRich;
  if (m.replyToId === parentId) {ok('replyToId совпадает');}
  else {fail(`replyToId=${m.replyToId}`);}

  // POST /chat/channels/:id/messages возвращает сырой ChatMessage:
  // без senderName, senderExternalId, replyTo. Rich-форма — только в GET.
  // Проверяем replyToId, а развёрнутый replyTo ищем ниже в истории.
  if (m.replyToId === parentId) {
    ok('POST: replyToId установлен (сырой ChatMessage, replyTo отсутствует)');
  } else {
    fail(`POST: replyToId=${m.replyToId}`);
  }

  // В истории replyTo тоже есть.
  const r2 = await raw(worker, 'GET', `/chat/channels/${ch.channelDbId}/messages?limit=10`);
  if (r2.status === 200) {
    const h = r2.body as { data: MessageRich[] };
    const row = h.data.find((x) => x.id === m.id);
    if (row && row.replyTo && row.replyTo.id === parentId) {
      ok('история: replyTo присутствует');
    } else {
      fail('история: replyTo отсутствует в rich-строке');
    }
  }
}

async function sectionEditDelete(
  arch: Client,
  worker: Client,
  ch: { channelDbId: string; channelStringId: string },
): Promise<void> {
  console.warn('\n=== PATCH/DELETE /chat/messages/:id ===');

  // 1. Создаём новое сообщение от Архитектора.
  const r1 = await raw(arch, 'POST', `/chat/channels/${ch.channelDbId}/messages`, {
    content: `e2e-edit ${Date.now()}`,
  });
  if (!expectStatus('create for edit', r1, 201)) {return;}
  const msg = r1.body as MessageRich;

  // 2. Worker пытается редактировать чужое → 409.
  const r2 = await raw(worker, 'PATCH', `/chat/messages/${msg.id}`, {
    content: 'hacked',
  });
  log('PATCH чужого сообщения (worker)', r2.status, r2.body);
  expectStatus('edit not author → 409', r2, 409);

  // 3. Архитектор редактирует своё.
  const newContent = `e2e-edited ${Date.now()}`;
  const r3 = await raw(arch, 'PATCH', `/chat/messages/${msg.id}`, {
    content: newContent,
  });
  log('PATCH своего сообщения (arch)', r3.status, r3.body);
  if (expectStatus('edit own', r3, 200)) {
    const edited = r3.body as MessageRich;
    if (edited.content === newContent) {ok('content обновлён');}
    else {fail(`content=${edited.content.slice(0, 40)}`);}
    if (edited.editedAt) {ok('editedAt заполнен');}
    else {fail('editedAt пуст');}
  }

  // 4. Worker пытается удалить чужое → 409.
  const r4 = await raw(worker, 'DELETE', `/chat/messages/${msg.id}`);
  log('DELETE чужого (worker)', r4.status, r4.body);
  expectStatus('delete not author → 409', r4, 409);

  // 5. Архитектор удаляет своё → 204.
  const r5 = await raw(arch, 'DELETE', `/chat/messages/${msg.id}`);
  log('DELETE своего (arch)', r5.status, r5.body);
  expectStatus('delete own', r5, 204);

  // 6. Повторное удаление → 409 (already deleted).
  const r6 = await raw(arch, 'DELETE', `/chat/messages/${msg.id}`);
  log('DELETE повторно', r6.status, r6.body);
  expectStatus('delete twice → 409', r6, 409);

  // 7. GET /chat/messages/:id — сообщение помечено deletedAt.
  const r7 = await raw(arch, 'GET', `/chat/messages/${msg.id}`);
  log('GET deleted message', r7.status, r7.body);
  if (expectStatus('get deleted', r7, 200)) {
    const g = r7.body as MessageRich;
    if (g.deletedAt) {ok(`deletedAt=${g.deletedAt}`);}
    else {fail('deletedAt пуст');}
  }
}

async function sectionMembers(
  arch: Client,
  ch: { channelDbId: string },
): Promise<void> {
  console.warn('\n=== GET /chat/channels/:id/members ===');

  const r = await raw(arch, 'GET', `/chat/channels/${ch.channelDbId}/members`);
  log('GET members (direct)', r.status, r.body);
  if (expectStatus('members', r, 200)) {
    const b = r.body as { data: unknown[] };
    if (Array.isArray(b.data)) {
      ok(`members.data: ${b.data.length}`);
    } else {
      fail('members: data не массив');
    }
  }
}

async function sectionValidation(arch: Client, ch: { channelDbId: string }): Promise<void> {
  console.warn('\n=== Валидации (422) ===');

  // 1. Пустой content.
  const r1 = await raw(arch, 'POST', `/chat/channels/${ch.channelDbId}/messages`, {
    content: '',
  });
  log('POST пустой content', r1.status, r1.body);
  expectStatus('пустой content → 422', r1, 422);

  // 2. Content > 10000.
  const r2 = await raw(arch, 'POST', `/chat/channels/${ch.channelDbId}/messages`, {
    content: 'x'.repeat(10001),
  });
  log('POST content > 10000', r2.status, r2.body);
  expectStatus('content > 10000 → 422', r2, 422);

  // 3. Невалидный reply_to_id.
  const r3 = await raw(arch, 'POST', `/chat/channels/${ch.channelDbId}/messages`, {
    content: 'ok',
    reply_to_id: 'not-a-uuid',
  });
  log('POST bad reply_to_id', r3.status, r3.body);
  expectStatus('bad reply_to_id → 422', r3, 422);

  // 4. Невалидный participant_id в direct.
  const r4 = await raw(arch, 'POST', '/chat/channels/direct', {
    participant_id: 'nope',
  });
  log('POST bad participant_id', r4.status, r4.body);
  expectStatus('bad participant_id → 422', r4, 422);

  // 5. 404 — несуществующий канал.
  const r5 = await raw(arch, 'GET', '/chat/channels/00000000-0000-0000-0000-000000000000');
  log('GET fake channel', r5.status, r5.body);
  expectStatus('fake channel → 404', r5, 404);

  // 6. 404 — несуществующее сообщение.
  const r6 = await raw(arch, 'GET', '/chat/messages/00000000-0000-0000-0000-000000000000');
  log('GET fake message', r6.status, r6.body);
  expectStatus('fake message → 404', r6, 404);

  // 7. 422 — невалидный UUID в path.
  const r7 = await raw(arch, 'GET', '/chat/channels/not-a-uuid');
  log('GET bad channel id', r7.status, r7.body);
  expectStatus('bad channel id → 422', r7, 422);

  // 8. reply_to_id на несуществующее сообщение → 409 (не 500).
  //    Раньше падало с FK-violation как 500.
  const r8 = await raw(arch, 'POST', `/chat/channels/${ch.channelDbId}/messages`, {
    content: 'reply to ghost',
    reply_to_id: '00000000-0000-0000-0000-000000000000',
  });
  log('POST reply_to non-existent', r8.status, r8.body);
  expectStatus('reply_to ghost → 409', r8, 409);
}

async function sectionDirectGuards(
  arch: Client,
  ch: { channelDbId: string },
): Promise<void> {
  console.warn('\n=== Direct-guards (409) ===');

  // 1. Нельзя вступить в direct.
  const r1 = await raw(arch, 'POST', `/chat/channels/${ch.channelDbId}/join`);
  log('POST join direct', r1.status, r1.body);
  expectStatus('join direct → 409', r1, 409);

  // 2. Нельзя выйти из direct.
  const r2 = await raw(arch, 'POST', `/chat/channels/${ch.channelDbId}/leave`);
  log('POST leave direct', r2.status, r2.body);
  expectStatus('leave direct → 409', r2, 409);

  // 3. Нельзя архивировать direct.
  const r3 = await raw(arch, 'POST', `/chat/channels/${ch.channelDbId}/archive`, {
    reason: 'e2e test',
  });
  log('POST archive direct', r3.status, r3.body);
  expectStatus('archive direct → 409', r3, 409);
}

async function sectionScopeChannel(arch: Client): Promise<void> {
  console.warn('\n=== Scope-канал: direction ===');

  // Создать или получить канал направления Архитектора.
  const r1 = await raw(arch, 'POST', `/chat/channels/direction/${arch.directionId}`, {
    name: `E2E Direction ${Date.now()}`,
  });
  log('POST direction channel', r1.status, r1.body);
  if (!expectStatus('create direction channel', r1, 201)) {return;}
  expectAuditId('create direction channel', r1.body);

  const ch = r1.body as ChannelRich;
  if (ch.channelType === 'direction') {ok('channelType=direction');}
  else {fail(`channelType=${ch.channelType}`);}

  if (ch.scopeId === arch.directionId) {ok('scopeId=directionId');}
  else {fail(`scopeId=${ch.scopeId}`);}

  // Проверим, что в my channels он есть.
  const r2 = await raw(arch, 'GET', '/chat/channels');
  if (r2.status === 200) {
    const b = r2.body as { data: ChannelRich[] };
    const found = b.data.find((x) => x.id === ch.id);
    if (found) {ok('канал присутствует в списке моих');}
    else {fail('канал не найден в списке моих');}
  }

  // Archive (канал направления можно).
  const r3 = await raw(arch, 'POST', `/chat/channels/${ch.id}/archive`, {
    reason: `e2e test ${new Date().toISOString()}`,
  });
  log('POST archive direction channel', r3.status, r3.body);
  if (expectStatus('archive direction', r3, 200)) {
    const arc = r3.body as ChannelRich;
    if (arc.archivedAt) {ok(`archivedAt=${arc.archivedAt}`);}
    else {fail('archivedAt пуст после архивации');}
  }

  // После архивации нельзя отправлять сообщения.
  const r4 = await raw(arch, 'POST', `/chat/channels/${ch.id}/messages`, {
    content: 'after archive',
  });
  log('POST message в архив', r4.status, r4.body);
  // P6 (v0.0.02): canAccessChannel для архивированного → ForbiddenError (403),
  // а не ConflictError (409). Раньше 409 был допустим, но семантически
  // 403 точнее (нет доступа к ресурсу).
  expectStatus('send to archived → 403', r4, 403);
}

/**
 * B1–B5 (v0.0.02): worker не член канала Архитектора → 403 на:
 * GET channels/:id, GET channels/:id/members, POST join, GET messages/:id,
 * POST archive.
 */
async function sectionAccessForbidden(arch: Client, worker: Client): Promise<void> {
  console.warn('\n=== Access-check: чужой канал ===');

  // Архитектор создаёт direction:1 (своё направление).
  const r1 = await raw(arch, 'POST', `/chat/channels/direction/${arch.directionId}`, {});
  log('POST /chat/channels/direction/:id (arch)', r1.status, r1.body);
  if (!expectStatus('create direction for access-test', r1, 201)) {return;}
  const ch = r1.body as ChannelRich;

  // Worker не в направлении Архитектора → GET channels/:id → 403.
  const r2 = await raw(worker, 'GET', `/chat/channels/${ch.id}`);
  log('GET /chat/channels/:id (worker, чужой)', r2.status, r2.body);
  expectStatus('worker чужой channel → 403', r2, 403);

  // Worker → members → 403.
  const r3 = await raw(worker, 'GET', `/chat/channels/${ch.id}/members`);
  log('GET /chat/channels/:id/members (worker)', r3.status, r3.body);
  expectStatus('worker чужой members → 403', r3, 403);

  // Worker → join → 403 (не может вступить в чужой direction).
  const r4 = await raw(worker, 'POST', `/chat/channels/${ch.id}/join`);
  log('POST /chat/channels/:id/join (worker)', r4.status, r4.body);
  expectStatus('worker чужой join → 403', r4, 403);

  // Архитектор пишет в direction:1.
  const msg = await raw(arch, 'POST', `/chat/channels/${ch.id}/messages`, {
    content: 'e2e access-check',
  });
  if (msg.status !== 201) {fail(`msg send: ${msg.status}`); return;}
  const m = msg.body as MessageRich;

  // Worker → GET messages/:id → 403 (сообщение из чужого канала).
  const r5 = await raw(worker, 'GET', `/chat/messages/${m.id}`);
  log('GET /chat/messages/:id (worker)', r5.status, r5.body);
  expectStatus('worker чужое message → 403', r5, 403);

  // Worker → archive → 403 (не создатель).
  const r6 = await raw(worker, 'POST', `/chat/channels/${ch.id}/archive`, { reason: 'hack' });
  log('POST /chat/channels/:id/archive (worker)', r6.status, r6.body);
  expectStatus('worker чужой archive → 403', r6, 403);

  // Sanity: Архитектор (создатель) может архивировать.
  // НО: после архивации sectionScopeChannel пересоздаст его — оставляем
  // только проверку, что worker получил 403. Очистка — в preflight.
}

// ─────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const archPhone = process.argv[2]
    ?? process.env['ARCHITECT_PHONE']
    ?? '+79000000000';
  const archPassword = process.argv[3]
    ?? process.env['ARCHITECT_PASSWORD']
    ?? 'ChangeMe123456';
  const workerPhone = process.argv[4] ?? '';
  const workerPassword = process.argv[5] ?? '';

  console.warn(`→ Base: ${BASE}`);
  console.warn(`→ Arch login: ${archPhone}`);

  const arch = await makeClient(archPhone, archPassword);
  console.warn(`→ Architect: ${arch.name} (${arch.participantId.slice(0, 8)}…)`);

  let worker: Client | null = null;
  if (workerPhone) {
    try {
      worker = await makeClient(workerPhone, workerPassword);
      console.warn(`→ Worker: ${worker.name} (${worker.participantId.slice(0, 8)}…)`);
    } catch (e) {
      console.warn(`   ⚠ Worker (${workerPhone}) недоступен: ${(e as Error).message}`);
      console.warn(`     Секции direct/send/reply/edit/delete/validation будут пропущены.`);
    }
  } else {
    console.warn('   ⚠ Worker не указан — секции chat-логики будут пропущены');
  }

  // Preflight — только если есть worker (иначе нечего чистить).
  if (worker) {
    try {
      await preflight(arch, worker);
    } catch (e) {
      console.warn(`   ⚠ Preflight failed: ${(e as Error).message}`);
    }
  }

  await sectionAuthGuards();
  await sectionMyChannels(arch);

  if (worker) {
    // B1–B5: worker не должен видеть/менять чужие каналы.
    await sectionAccessForbidden(arch, worker);
  }

  await sectionScopeChannel(arch);

  if (worker) {
    const ch = await sectionDirectChannel(arch, worker);
    if (ch) {
      const parentId = await sectionSendAndRead(arch, worker, ch);
      if (parentId) {
        await sectionReply(worker, ch, parentId);
      }
      await sectionEditDelete(arch, worker, ch);
      await sectionMembers(arch, ch);
      await sectionValidation(arch, ch);
      await sectionDirectGuards(arch, ch);
    }
  }

  console.warn('\n═══════════════════════════════════════');
  if (failures === 0) {
    console.warn('✓ Все проверки прошли');
  } else {
    console.error(`✗ Провалов: ${failures}`);
    process.exitCode = 1;
  }
  console.warn('═══════════════════════════════════════\n');
}

main()
  .then(() => gracefulShutdown())
  .catch(async (e) => {
    const err = e as Error & { cause?: unknown };
    console.error('\n❌ Ошибка:', err.message);
    if (err.cause) {
      console.error('   cause:', err.cause);
    }
    try {await gracefulShutdown();} catch {/* ignore */}
    process.exit(1);
  });