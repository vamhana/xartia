# Privacy Policy — XartIA

**Version:** 1.0 (draft)
**Effective date:** 2026-10-26 (draft — not yet in force)
**Last updated:** 2026-10-26
**Status:** Draft. Требует review юриста.

---

## 1. Введение

Эта Privacy Policy описывает, какие данные собирает XartIA (dApp, backend,
инфраструктура), как они используются, какие у пользователя права (GDPR, CCPA
и аналогичные режимы).

**Важно:** XartIA — **некастодиальный** протокол. Смарт-контракты не собирают
персональные данные. Все данные, которые могут быть собраны, относятся к
**инфраструктуре dApp** (frontend, RPC, аналитика) — не к on-chain логике.

---

## 2. Кто собирает данные

**Оператор:** `<юридическое лицо>` (TBD, см. `legal/opinion/jurisdiction.pdf`).

**Контакты:**
- **Общие вопросы:** `privacy@xartia.example`
- **Data Protection Officer (DPO):** `<DPO email>` (TBD)

**Хостинг:**
- Frontend: `<hosting provider>` (TBD)
- RPC: `<RPC provider>` (TBD)
- Analytics: `<analytics provider>` (TBD)

---

## 3. Какие данные мы собираем

### 3.1. On-chain данные

**Смарт-контракты не собирают персональные данные.** Все транзакции — публичны
в блокчейне Polygon PoS. Мы **не контролируем** эти данные; они хранятся в
публичном реестре.

**Публично в блокчейне:**

- Адрес кошелька (pseudonymous, но может быть связан с реальным лицом);
- Суммы транзакций (buyFromCurve, sellToPool, redeemFromCurve, ...);
- Timestamp;
- Gas usage.

Эти данные неизменяемы. Мы не можем их удалить (per GDPR Article 17 — «right to
erasure» имеет ограничения для блокчейна; см. §6).

### 3.2. dApp frontend

При использовании `web/dapp/` мы можем собирать:

| Тип данных | Цель | Правовая основа (GDPR) |
|---|---|---|
| Wallet address (public) | Показать баланс, историю | Contract performance |
| IP-адрес | Анти-DDoS, rate limiting | Legitimate interest |
| User-Agent | Совместимость браузера | Legitimate interest |
| Транзакции (hash, статус) | Показать статус | Contract performance |
| Cookies (аналитика) | Улучшение UI | Consent (см. `cookies.md`) |
| Error logs | Debug, безопасность | Legitimate interest |

**Мы НЕ собираем:**

- Private keys / seed phrases (никогда, ни при каких обстоятельствах);
- Паспортные данные, SSN, ИНН, номера карт;
- Биометрию;
- Точную геолокацию (только IP → страна, если нужно для комплаенса).

### 3.3. RPC и backend

При использовании RPC:

- IP-адрес (rate limiting);
- Метод + параметры вызова (проверка на malicious traffic).

**Не сохраняем** тела транзакций дольше 30 дней (если сохраняем для
debug).

### 3.4. Аналитика

Если используется (например, Plausible, Simple Analytics, Matomo):

- Page views;
- Referrer;
- Device type (desktop/mobile);
- Country (по IP).

**Не собираем** Personally Identifiable Information (PII).

См. `legal/cookies.md` (L.2.01.04).

---

## 4. Как мы используем данные

| Цель | Данные | Правовая основа |
|---|---|---|
| Показать баланс / историю | Wallet address | Contract |
| Anti-DDoS, rate limiting | IP, User-Agent | Legitimate interest |
| Debug, безопасность | Error logs, tx hash | Legitimate interest |
| Analytics (если consent) | Page views, country | Consent |
| Compliance (KYC/AML — если применимо) | <данные по запросу регулятора> | Legal obligation |

**Мы НЕ используем данные для:**

- Рекламы (никаких Ads);
- Продажи третьим лицам (никогда);
- Обучения моделей без явного consent;
- Профилирования.

---

## 5. Кому мы передаём данные

- **RPC provider** — обрабатывает запросы к блокчейну.
- **Hosting provider** — хранит frontend.
- **Analytics provider** (если consent) — собирает page views.
- **Cloudflare / аналоги** — DDoS protection.
- **Правоохранительные органы** — только по законному запросу (subpoena,
  court order). Уведомляем пользователя, если разрешено законом.

**Мы НЕ продаём данные.**

---

## 6. GDPR (ЕС/ЕЭЗ)

Если вы находитесь в ЕС/ЕЭЗ, у вас есть:

### 6.1. Right to access (Art. 15)

Вы можете запросить копию ваших персональных данных, которые мы обрабатываем
(кроме on-chain — они публичны).

### 6.2. Right to rectification (Art. 16)

Вы можете исправить неточные данные (например, email).

### 6.3. Right to erasure (Art. 17)

Вы можете запросить удаление ваших данных. **Ограничения:**

- On-chain данные **не могут быть удалены** (immutable blockchain).
- Данные, которые мы обязаны хранить по закону (AML, tax) — не удаляются до
  истечения срока.
- Данные для legal claims — не удаляются до разрешения спора.

**On-chain данные** — это публичный реестр, не наша база данных. GDPR
применяется к **нашей** обработке; блокчейн — отдельная сущность.

### 6.4. Right to restriction (Art. 18)

Вы можете ограничить обработку (например, пока рассматривается жалоба).

### 6.5. Right to data portability (Art. 20)

Вы можете запросить ваши данные в machine-readable формате (JSON).

### 6.6. Right to object (Art. 21)

Вы можете возразить против обработки на основе legitimate interest.

### 6.7. Right to lodge a complaint (Art. 77)

Вы можете подать жалобу в надзорный орган (например, вашу национальную DPA).

**Как воспользоваться:** `privacy@xartia.example`. Срок ответа — 30 дней.

---

## 7. CCPA (Калифорния)

Если вы в Калифорнии, у вас есть:

- **Right to know** — какие категории данных мы собираем, откуда, кому
  передаём.
- **Right to delete** — удаление (с ограничениями, как в GDPR).
- **Right to opt-out of sale** — мы **не продаём** данные, opt-out не нужен.
- **Right to non-discrimination** — мы не дискриминируем за использование
  прав.

**Как воспользоваться:** `privacy@xartia.example`.

---

## 8. Международные передачи

Если вы в ЕС, ваши данные могут передаваться в США (RPC, hosting). Мы
используем:

- Standard Contractual Clauses (SCC);
- Adequacy decisions (если применимо).

**Список стран:** `<список>` (TBD).

---

## 9. Хранение

| Тип данных | Срок |
|---|---|
| On-chain | вечно (immutable) |
| Wallet address (dApp cache) | 30 дней |
| IP / User-Agent (logs) | 30 дней |
| Analytics (если consent) | 14 месяцев |
| KYC/AML (если применимо) | 5 лет (по закону) |
| Error logs | 90 дней |

---

## 10. Безопасность

Мы принимаем разумные меры:

- HTTPS / TLS 1.3;
- CSP (Content Security Policy);
- Rate limiting;
- No private keys on server (non-custodial);
- Регулярный аудит инфраструктуры.

**Но:** никакая система не является на 100% безопасной. On-chain данные
публичны. Пользователь несёт риск.

---

## 11. Дети

Протокол **не предназначен** для лиц < 18 лет. Мы не собираем данные
несовершеннолетних. Если вы родитель и считаете, что ваш ребёнок
предоставил данные — свяжитесь с нами.

---

## 12. Изменения

Мы можем обновлять Privacy Policy. Новая версия публикуется на GitHub.
Материальные изменения анонсируются.

**Последнее обновление:** 2026-10-26.

---

## 13. Контакты

- **Общие вопросы:** `privacy@xartia.example`
- **DPO:** `<DPO email>` (TBD)
- **Жалобы:** `privacy@xartia.example`

**Надзорный орган:** ваша национальная DPA (в ЕС — список на
[edpb.europa.eu](https://edpb.europa.eu)).

---

## 14. Ссылки

- `legal/terms.md` (L.2.01.01)
- `legal/disclaimer.md` (L.2.01.03)
- `legal/cookies.md` (L.2.01.04)
- `legal/token-classification.md` (L.1.01.03)

---

**ОТКАЗ ОТ ОТВЕТСТВЕННОСТИ:** этот документ — draft. Требует review юриста.