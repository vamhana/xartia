Склейка блоков ID (клей_id.md)
==================================================

|A.1.36.01|API|REST|TypeScript|src/api/chat/controller.ts|C.0.36.02, L.0.01.03, A.1.99.01, A.1.99.06|v.0.0.01|Draft|—|
|Описание: Контроллер Chat. 17 из 17 заявленных. Полное соответствие по составу. requireRight НЕ используется осознанно (rights_matrix не покрывает чат-ресурс). Доступ через canAccessChannel внутри C.0.36.02. Внутренний комментарий шапки файла говорит `A.1.99.09 (неявный)` — вероятно, ошибка нумерации, канонический ID A.1.36.01.
|Публичный API:
- GET /chat/channels — preHandler authMiddleware. listMyChannels(me) → 200 { data, audit_id }.
- POST /chat/channels/direct — preHandler [authMiddleware, validateBody]. Body: { participant_id }. → 201 ChatChannel + audit_id. Всегда 201, даже если канал существовал (нормализация пары min/max UUID).
- POST /chat/channels/direction/:id — preHandler [authMiddleware, validateParams, validateBody(scopeBody)]. Body: { name?: 1..255 }. → 201 ChatChannel + audit_id.
- POST /chat/channels/cell/:id — аналогично direction.
- POST /chat/channels/council/:id — аналогично direction.
- POST /chat/channels/project/:id — аналогично direction.
- GET /chat/channels/:id — preHandler [authMiddleware, validateParams]. → 200 ChatChannel + audit_id. Без access-check (метаданные открыты).
- GET /chat/channels/:id/members — preHandler [authMiddleware, validateParams]. → 200 { data, audit_id }.
- POST /chat/channels/:id/join — preHandler [authMiddleware, validateParams]. → 201 ChatChannelMember + audit_id. Direct → 409.
- POST /chat/channels/:id/leave — preHandler [authMiddleware, validateParams]. → 204. Direct → 409.
- POST /chat/channels/:id/archive — preHandler [authMiddleware, validateParams, validateBody]. Body: { reason: 1..2000 }. → 200 ChatChannel + audit_id. Direct → 409.
- GET /chat/channels/:id/messages — preHandler [authMiddleware, validateParams, validateQuery(historyQuery)]. Query: { limit: 1..200 (default 50), before?: ISO8601 }. → 200 { data, audit_id }. Двухшаговый: getChannelById(UUID) → getChannelHistory(ch.channelId, ...).
- POST /chat/channels/:id/messages — preHandler [authMiddleware, validateParams, validateBody(sendBody)]. Body: { content: 1..10000, mentions?: uuid[] (≤50), attachments?: [{ key, name, size: 0..100MB, mime }] (≤10), reply_to_id?: uuid }. → 201 ChatMessage + audit_id. Двухшаговый.
- PATCH /chat/messages/:id — preHandler [authMiddleware, validateParams(msgParams), validateBody(editBody)]. Body: { content: 1..10000 }. → 200 ChatMessage + audit_id. Non-author → 409.
- DELETE /chat/messages/:id — preHandler [authMiddleware, validateParams(msgParams)]. → 204. Soft-delete. Non-author → 409.
- GET /chat/messages/:id — preHandler [authMiddleware, validateParams(msgParams)]. → 200 ChatMessage + audit_id.
- GET /chat/channels/by-string/:channel_id — preHandler authMiddleware. Params: { channel_id: string (URI-encoded, decodeURIComponent) }. → 200 ChatChannel + audit_id ИЛИ 403 { code: 'FORBIDDEN', message, audit_id }. Использует canAccessChannel.
|↙ ПОТРЕБЛЯЕТ: C.0.36.02 (getOrCreateDirectChannel, getOrCreateScopeChannel, getChannelById, getChannelByStringId, listMyChannels, joinChannel, leaveChannel, listChannelMembers, sendMessage, getChannelHistory, getMessageById, editMessageService, deleteMessageService, archiveChannel, canAccessChannel), L.0.01.03 (uuidSchema), A.1.99.01 (authMiddleware, getAuthContext), A.1.99.06 (validateBody, validateParams, validateQuery). Внешние: fastify, zod.
- C.0.36.02 chat (getOrCreateDirectChannel, getOrCreateScopeChannel, getChannelById, getChannelByStringId, listMyChannels, joinChannel, leaveChannel, listChannelMembers, sendMessage, getChannelHistory, getMessageById, editMessageService, deleteMessageService, archiveChannel, canAccessChannel)
- L.0.01.03 validators (uuidSchema)
- A.1.99.01 auth middleware (authMiddleware, getAuthContext)
- A.1.99.06 validation middleware (validateBody, validateParams, validateQuery)
- Внешние: fastify, zod
|↘ ПРЕДОСТАВЛЯЕТ: registerChatRoutes. F.4.99.07 Chat.tsx (пусто), M.4.02.10 (пусто). channelId используется WS-каналом `chat:${channelId}` (W.2.12.01). GET /by-string — мост между UUID-каналом и строковым ID для WS. Проверено в I.9.04.04 test-chat.ts.
- registerChatRoutes(app: FastifyInstance): Promise<void> — регистрируется в A.1.00.01
- Все /chat/* эндпоинты для F.4.99.07 Chat.tsx (пусто), M.4.02.10 Chat.tsx mobile (пусто)
- Строковый ID канала (channelId) — используется WS-каналом chat:${channelId} (W.2.12.01)
- GET /chat/channels/by-string/:channel_id — мост между UUID-каналом и строковым ID для WS-клиента
- Проверено в I.9.04.04 test-chat.ts: direct-канал → сообщение → edit → 409 (не автор) → direction-канал → список моих каналов → soft-delete → проверка исчезновения из истории
|Реализация: 8 Zod-схем. ПОРЯДОК: /channels → /direct → /direction/:id → /cell/:id → /council/:id → /project/:id → /:id → /:id/members → /:id/join → /:id/leave → /:id/archive → /:id/messages → /messages/:id (PATCH) → /messages/:id (DELETE) → /messages/:id (GET) → /by-string/:channel_id. Специфичные роуты до /:id.
- Схемы Zod: idParams ({ id: uuid }), msgParams ({ id: uuid }), directBody ({ participant_id }), scopeBody ({ name?: 1..255 }), sendBody ({ content: 1..10000, mentions?: uuid[] max 50, attachments?: array of { key, name, size: 0..100MB, mime } max 10, reply_to_id? }), editBody ({ content: 1..10000 }), historyQuery ({ limit: 1..200 default 50, before? ISO8601 }), archiveBody ({ reason: 1..2000 }).
- ПОРЯДОК РЕГИСТРАЦИИ: /chat/channels → /channels/direct → /channels/direction/:id → /channels/cell/:id → /channels/council/:id → /channels/project/:id → /channels/:id → /channels/:id/members → /:id/join → /:id/leave → /:id/archive → /:id/messages → /messages/:id (PATCH) → /messages/:id (DELETE) → /messages/:id (GET) → /channels/by-string/:channel_id. Специфичные роуты (/direct, /direction/:id, ...) зарегистрированы ДО /channels/:id. by-string зарегистрирован в конце — но это не конфликтует, потому что у него 4 сегмента пути, а у /channels/:id — 3.
- GET /chat/channels: listMyChannels(auth.participantId) → { data, audit_id }.
- POST /chat/channels/direct: getOrCreateDirectChannel(auth.participantId, b.participant_id). Всегда 201 — нормализация пары (min/max) гарантирует один канал для пары. См. I.9.04.04 test-chat.ts шаг 2.
- POST /chat/channels/{type}/:id: getOrCreateScopeChannel(type, p.id, auth.participantId, b.name). type из пути ('direction'|'cell'|'council'|'project').
- GET /chat/channels/:id: getChannelById(p.id) → спред + audit_id. Без access-check на этом уровне.
- GET /chat/channels/:id/members: listChannelMembers(p.id) → { data, audit_id }.
- POST /chat/channels/:id/join: joinChannel(p.id, auth.participantId, auth.participantId). Дважды auth.participantId — паттерн self-service, где второй аргумент = requestedBy. Direct → 409.
- POST /chat/channels/:id/leave: leaveChannel(p.id, auth.participantId, auth.participantId) → 204. Direct → 409.
- POST /chat/channels/:id/archive: archiveChannel(p.id, b.reason, auth.participantId). Direct → 409.
- GET /chat/channels/:id/messages: two-step: getChannelById(p.id) → ch.channelId → getChannelHistory(ch.channelId, auth.participantId, q.limit, q.before). Access-check внутри getChannelHistory через canAccessChannel.
- POST /chat/channels/:id/messages: two-step: getChannelById(p.id) → ch.channelId → sendMessage({ channelStringId: ch.channelId, senderId: auth.participantId, content, mentions?, attachments?, replyToId? }). Access-check внутри sendMessage.
- PATCH /chat/messages/:id: editMessageService(p.id, b.content, auth.participantId). Non-author → ConflictError → 409.
- DELETE /chat/messages/:id: deleteMessageService(p.id, auth.participantId) → 204. Non-author → ConflictError → 409. Soft-delete через deleted_at в chat_messages (D.2.01.12).
- GET /chat/messages/:id: getMessageById(p.id) → спред + audit_id.
- GET /chat/channels/by-string/:channel_id: decodeURIComponent(p.channel_id) → getChannelByStringId() → canAccessChannel(auth.participantId, ch). Если !allowed → 403 { code: 'FORBIDDEN', message: access.reason, audit_id }. Иначе — спред + audit_id.
- Формат ответов: { data, audit_id } для списков; спред + audit_id для одиночных. Ошибки через A.1.99.07.
|Примечания:
РЕАЛИЗОВАНО: 17/17, осознанно без requireRight.
ЗАЯВЛЕНО И НЕ РЕАЛИЗОВАНО: C.0.01.06, A.1.99.02, A.1.99.03 не импортируются. A.1.99.02 даже не заявлен в первой строке блока — это осознанное архитектурное решение (Chat не требует requireRight).
СВЕРХ СТАРОЙ СПЕКИ: declarations в шапке файла про «A.1.99.09 (неявный)»; двухшаговый паттерн getChannelById → getChannelHistory/sendMessage; decodeURIComponent для by-string.
ИЗМЕНЕНИЯ относительно предыдущей ревизии:
- Импорт listChannelMembers → listChannelMembersRich. Роут GET /chat/channels/:id/members
  теперь возвращает rich-форму (id, participantId, name, externalId, pseudonym).
- Удалены мёртвые импорты listMyChannels, getChannelHistory.
- Оговорка: POST /chat/channels/:id/messages возвращает сырой ChatMessage (без
  senderName/replyTo); rich-форма доступна только через GET-историю.
ТЕСТОВОЕ ПОКРЫТИЕ: I.9.04.04 test-chat.ts — direct → message → edit → 409 (не автор) → direction-канал → список → soft-delete.

|C.0.36.01|Core|Domain|TypeScript|src/core/chat/entity.ts|C.0.01.02, C.0.01.04|v.0.0.01|Draft|—|
|Описание: Доменная сущность Chat. 9 функций. Нормализация direct через сортировку UUID. Валидация сообщений и вложений. Комментарий шапки: `C.0.36.01 (неявный)` — вероятно, ошибка нумерации.
|Публичный API:
- type ChatChannelType = 'direct'|'direction'|'cell'|'council'|'project'
- interface ChatChannel (10 полей), ChatChannelMember (5), ChatAttachment (4), ChatMessage (11)
- function normalizeDirectChannelId(a, b): string
- function formatScopeChannelId(type, scopeId): string
- function parseChannelId(channelId): { channelType; parts }
- function validateMessageContent(content): void
- function validateAttachments(attachments): void
- function createChannel(input): ChatChannel
- function createMessage(input): ChatMessage
- function editMessage(m, newContent): ChatMessage
- function canEditMessage(m, userId): boolean
|↙ ПОТРЕБЛЯЕТ: C.0.01.02 (ValidationError, ConflictError), C.0.01.04 (UUID, ISODateTime).
- C.0.01.02 Errors (ValidationError, ConflictError)
- C.0.01.04 Types (UUID, ISODateTime)
|↘ ПРЕДОСТАВЛЯЕТ: C.0.36.02 (chat service).
- ChatChannel / ChatMessage / ChatChannelMember / ChatAttachment для C.0.36.02 (Chat service)
- normalizeDirectChannelId для сервиса при создании direct-канала
- formatScopeChannelId для сервиса при создании групповых каналов
- canEditMessage для проверки прав редактирования
|Реализация:
- normalizeDirectChannelId: a ≠ b, сортировка лексикографически, возвращает `direct:<min>:<max>`.
- formatScopeChannelId: `<type>:<scopeId>`.
- parseChannelId: split(':'); проверка type ∈ enum.
- validateMessageContent: trim ≠ пусто, ≤ 10000.
- validateAttachments: ≤ 10, каждый { key, name, mime } + size 0..100MB.
- createMessage: валидация + trim + дефолты (mentions=[], attachments=[]).
- editMessage: проверка deletedAt. Content trim. editedAt.
- canEditMessage: senderId === userId && !deletedAt.
|Примечания:
РЕАЛИЗОВАНО: 9 функций.
ЗАЯВЛЕНО И НЕ РЕАЛИЗОВАНО: —.
СВЕРХ СТАРОЙ СПЕКИ: validateAttachments с проверкой размера.
ИЗМЕНЕНИЯ: —.
ТЕХДОЛГ: комментарий шапки — `C.0.36.01 (неявный)`, канонический ID C.0.36.01.
ТЕСТОВОЕ ПОКРЫТИЕ: I.9.04.04 test-chat.ts.

|C.0.36.02|Core|Domain|TypeScript|src/core/chat/service.ts|C.0.01.02, C.0.01.04, C.0.01.05, C.0.36.01, L.0.01.01, L.0.01.08, L.0.01.09, W.2.12.01|v.0.0.01|Draft|—|
|Описание: Сервис Chat. 16 функций. Redis-кэш (100 последних, TTL 7 дней). Доступ через canAccessChannel. Аудит только для не-direct каналов (приватность).
|Публичный API:
- function canAccessChannel(participantId, channel): Promise<{ allowed; reason? }>
- function getOrCreateChannel(input): Promise<ChatChannel>
- function getOrCreateDirectChannel(userA, userB): Promise<ChatChannel>
- function getOrCreateScopeChannel(type, scopeId, by, name?): Promise<ChatChannel>
- function getChannelById(id): Promise<ChatChannel>
- function getChannelByStringId(channelId): Promise<ChatChannel>
- function listMyChannels(userId): Promise<ChatChannel[]>
- function joinChannel(channelDbId, participantId, by): Promise<ChatChannelMember>
- function leaveChannel(channelDbId, participantId, by): Promise<void>
- function listChannelMembers(channelDbId): Promise<ChatChannelMember[]>
- function sendMessage(input): Promise<ChatMessage>
- function getMessageById(id): Promise<ChatMessage>
- function getChannelHistory(channelStringId, requesterId, limit?, before?): Promise<ChatMessage[]>
- function editMessageService(messageId, newContent, userId): Promise<ChatMessage>
- function deleteMessageService(messageId, userId): Promise<void>
- function archiveChannel(channelDbId, reason, by): Promise<ChatChannel>
|↙ ПОТРЕБЛЯЕТ: L.0.01.09 (query, queryOne), L.0.01.08 (redis), L.0.01.01 (newUUID), C.0.01.05 (logAction), C.0.01.02 (NotFoundError, ConflictError), C.0.36.01 (createMessage, editMessage, normalizeDirectChannelId, formatScopeChannelId, canEditMessage, типы), W.2.12.01 (7 эмиссий), C.0.01.04 (UUID).
- C.0.36.01 Chat entity (все фабрики и валидаторы)
- C.0.01.05 Audit (logAction — только для официальных каналов)
- C.0.01.02 Errors (NotFoundError, ConflictError)
- C.0.01.04 Types (UUID)
- L.0.01.08 redis (кэш chat:<channelId>:recent, TTL 7 дней, 100 последних)
- L.0.01.09 db (query, queryOne)
- L.0.01.01 id (newUUID)
- W.2.12.01 ws/chat (emitChatMessage, emitChatMention, emitChatJoined, emitChatLeft, emitChatMessageEdited, emitChatMessageDeleted, emitChatChannelArchived)
- Таблицы chat_channels / chat_channel_members / chat_messages (D.2.01.12)
|↘ ПРЕДОСТАВЛЯЕТ: A.1.36.01 chat controller.
- Все функции для A.1.36.01 (Chat controller)
- canAccessChannel для контроллера при /chat/channels/by-string/:id
- listMyChannels для UI (боковая панель каналов)
- sendMessage / getChannelHistory для клиентских сценариев
- getOrCreateDirectChannel для F.4.99.07 (Chat UI) при клике на участника
|Реализация:
- canAccessChannel: switch по 5 типам каналов. direct — по channelId; direction — participants.direction_id; cell — cell_members; council — council_members; project — lead_direction_id плана или assignee задачи.
- getOrCreateChannel: SELECT → INSERT. logAction.
- listMyChannels: EXISTS-подзапросы + LIKE для direct.
- joinChannel: только не-direct. Проверка отсутствия активного membership. INSERT + logAction + emitChatJoined.
- leaveChannel: UPDATE valid_to=now(). logAction + emitChatLeft.
- sendMessage: canAccessChannel → createMessage → INSERT → Redis lpush+ltrim+expire (best-effort) → аудит только если не-direct → emitChatMessage + персональные emitChatMention.
- getChannelHistory: если before не задан — пробует Redis (если ≥ 20 → возврат), иначе БД. Если before — только БД.
- editMessageService / deleteMessageService: canEditMessage (только автор, не deleted) → UPDATE + logAction (только не-direct) + WS.
- archiveChannel: только не-direct. UPDATE archived_at + logAction + emitChatChannelArchived.
|Примечания:
РЕАЛИЗОВАНО: 16 функций.
ЗАЯВЛЕНО И НЕ РЕАЛИЗОВАНО: — (полная реализация).
СВЕРХ СТАРОЙ СПЕКИ: canAccessChannel с 5 типами, Redis-кэш (100 последних, TTL 7 дней), WS-эмиссии (7 типов), аудит только не-direct.
ИЗМЕНЕНИЯ относительно предыдущей ревизии:
- Удалена getChannelHistory (не-Rich) — не имела потребителей после
  перехода контроллера на getChannelHistoryRich.
- Добавлена listChannelMembersRich — обогащает участников name/externalId/pseudonym
  для автокомплита упоминаний в Composer (F.4.05.05).
- deleteMessageService: раздельные проверки автора и deletedAt. Раньше
  повторное удаление давало «Удалить может только автор» вместо «Уже удалено»
  (canEditMessage совмещает оба условия).
ТЕХДОЛГ: комментарий шапки — `C.0.36.02 (неявный)`.
ТЕСТОВОЕ ПОКРЫТИЕ: I.9.04.04 test-chat.ts.

|I.9.04.04|Infra|Tools|TypeScript|scripts/test-chat.ts|A.1.36.01, C.0.36.02, L.0.01.09, L.0.01.12|v.0.0.01|Draft|A.1.36.01|
|Описание: Ручной интеграционный тест Chat (A.1.36.01 + C.0.36.02).
Покрытие: auth guards, GET /chat/channels (rich), POST /chat/channels/direct
(создание + идемпотентность + обратный вызов worker→arch), by-string,
get by UUID, POST/GET /chat/channels/:id/messages, reply_to_id, edit/delete
(автор / не автор), members (rich), валидации 422, 404, direct-guards
(join/leave/archive — 409), scope-канал направления (создание + архивация).
Preflight чистит: direct-messages arch↔worker, scope-каналы, созданные
Архитектором (direction/cell/council/project), Redis-кэш recent, ratelimit:auth.*.
Не покрывает: WS-события (отдельный скрипт I.9.05.02 test-ws-chat.ts).|
|Публичный API:
- CLI-скрипт: `pnpm tsx scripts/test-chat.ts [archPhone] [archPassword] [workerPhone] [workerPassword]`.
- Интерфейс `Client`.
- Функции: `login(phone, password)`, `req<T>(c, method, path, body?)`, `log`, `ok`, `cleanup()`.
- `main()`.
- Константы: `BASE`, `MARKER = 'CHAT-TEST:'`.
- Коды выхода: `0` — успех, `1` — ошибка.
|↙ ПОТРЕБЛЯЕТ:
- A.1.36.01 chat controller — `POST /chat/channels/direct`, `POST /chat/channels/direction/:id`, `GET /chat/channels`, `POST /chat/channels/:id/messages`, `GET /chat/channels/:id/messages`, `PATCH /chat/messages/:id`, `DELETE /chat/messages/:id`.
- C.0.36.02 chat service — под контроллером.
- L.0.01.09 db.ts — `query` для cleanup.
- L.0.01.12 shutdown.ts — `gracefulShutdown`.
- Внешние: `dotenv/config`, `fetch`.
|↘ ПРЕДОСТАВЛЯЕТ:
- Cleanup: `chat_messages`, `chat_channel_members`, `chat_channels` по маркеру `CHAT-TEST:`.
- Проверку нормализации direct-каналов (повторный вызов возвращает тот же `channelId`).
- Проверку soft-delete (сообщение исчезает из истории).
- Косвенное покрытие A.1.36.01, C.0.36.02.
|Реализация:
- `login` — POST `/auth/login`, извлекает `token`, `participantId`, `directionId`.
- Шаги:
  1. `POST /chat/channels/direct { participant_id: c2.participantId }` — ожидание 201 + `channelType === 'direct'`.
  2. Повторный `POST /chat/channels/direct { participant_id: c1.participantId }` от c2 — проверка `direct2.channelId === direct.channelId`.
  3. `POST /chat/channels/:id/messages { content }` — отправка сообщения.
  4. `GET /chat/channels/:id/messages` — история.
  5. `PATCH /chat/messages/:id { content }` — edit, проверка `editedAt`.
  6. `PATCH /chat/messages/:id` от c2 — ожидание 409.
  7. `POST /chat/channels/direction/:dirId { name }` — direction-канал.
  8. `GET /chat/channels` — список.
  9. `DELETE /chat/messages/:id` — soft-delete, ожидание 204.
  10. `GET /chat/channels/:id/messages` — проверка, что удалённого сообщения нет.
- `cleanup()` в начале и после.
|Примечания:
РЕАЛИЗОВАНО: 10 шагов, ~180 строк.
ЗАЯВЛЕНО И НЕ РЕАЛИЗОВАНО (из старой спеки):
- (полная реализация).
СВЕРХ СТАРОЙ СПЕКИ:
- (нет).
ИЗМЕНЕНИЯ:
- (нет).
ТЕХДОЛГ:
- `cleanup()` удаляет по `name LIKE 'CHAT-TEST:%'` — если пользователь вручную назвал канал так, он будет удалён.
- `chat_messages` в cleanup — по `content LIKE 'CHAT-TEST:%'`; при удалении через soft-delete они остаются в таблице и попадают под cleanup.
- Шаг 6 (чужое редактирование) — ожидание 409; но если ACL настроен иначе (403), тест «упадёт».
- `hist.data.data?.length >= 1` — не проверяет, что в истории именно нужное сообщение.
- `hist2.data.data.some(m => m.id === msg.data.id)` — предполагает, что поле `id` в сообщении совпадает с `msg.data.id`.
- `direction`-канал создаётся с `c1.directionId`, но нет проверки, что `dirCh` не `null` перед доступом.
- `JSON.stringify(...).slice(0, 500)` — обрезка логов на 500 символов может скрыть ошибки.
- Не проверяется, что после soft-delete `chat_messages.deleted_at` не `NULL` (проверка только по API).
- `makeClient`/`login` не различает ошибки сети и 401.
- Дефолтные телефоны/пароли захардкожены.
ТЕСТОВОЕ ПОКРЫТИЕ:
- Прямой тест не указан.
- Косвенно — покрывает A.1.36.01, C.0.36.02.

==================================================
Отчёт:
  Всего выбрано ID: 4
  Перечень:
    - A.1.36.01
    - C.0.36.01
    - C.0.36.02
    - I.9.04.04
