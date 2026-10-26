# Cookie Policy — XartIA

**Version:** 1.0 (draft)
**Effective date:** 2026-10-26 (draft — not yet in force)
**Status:** Draft. Требует review юриста.

---

## 1. Что такое cookies

Cookies — небольшие текстовые файлы, которые сайт сохраняет в браузере
пользователя. Они используются для запоминания состояния (например, выбранной
сети), аналитики, безопасности.

XartIA использует cookies **минимально**. Основная логика — в смарт-контрактах
и кошельке; backend не хранит сессии.

---

## 2. Категории cookies

### 2.1. Strictly necessary (обязательные)

Без них dApp не работает. Согласие не требуется (по GDPR — «strictly
necessary»).

| Cookie | Назначение | Срок | Тип |
|---|---|---|---|
| `xartia.chain` | Выбранная сеть (amoy/polygon) | 1 год | localStorage |
| `xartia.wallet_connected` | Флаг «кошелёк подключён» | сессия | sessionStorage |
| `xartia.csrf` | CSRF-защита (если есть формы) | сессия | cookie (HttpOnly) |

**Хранение:** `localStorage` / `sessionStorage` в браузере. Не отправляются на
сервер автоматически.

### 2.2. Analytics (аналитика)

Опционально. Требуется **явное согласие** (GDPR Art. 6(1)(a)).

| Cookie | Провайдер | Назначение | Срок |
|---|---|---|---|
| `plausible_*` | Plausible | Page views, referrer, device type | 14 месяцев |
| `_pk_id.*` | Matomo (если) | Уникальный visitor ID | 13 месяцев |
| `_pk_ses.*` | Matomo (если) | Активная сессия | 30 минут |

**По умолчанию отключены.** Включаются через consent banner.

**Мы не используем** Google Analytics, Facebook Pixel, Yandex.Metrika — только
privacy-friendly (Plausible / Matomo, self-hosted).

### 2.3. Third-party (третьи стороны)

Если dApp подключает внешние сервисы (RPC, WalletConnect, Snapshot):

| Cookie | Провайдер | Назначение | Срок |
|---|---|---|---|
| `walletconnect.*` | WalletConnect | Сессия подключения | 7 дней |
| `snapshot.*` | Snapshot.org | Если голосуете через dApp | 1 день |

Управляются **третьими сторонами**. Ознакомьтесь с их Privacy Policy.

### 2.4. Security (безопасность)

| Cookie | Провайдер | Назначение | Срок |
|---|---|---|---|
| `cf_*` | Cloudflare | Anti-DDoS, bot protection | до 1 года |
| `__cf_bm` | Cloudflare | Bot management | 30 минут |

**Strictly necessary** для защиты от атак.

---

## 3. Как отключить cookies

### 3.1. В браузере

Большинство браузеров позволяют блокировать cookies:

- **Chrome:** Settings → Privacy and security → Cookies and other site data
- **Firefox:** Preferences → Privacy & Security → Cookies and Site Data
- **Safari:** Preferences → Privacy → Manage Website Data
- **Edge:** Settings → Cookies and site permissions

**Важно:** блокировка strictly necessary cookies может сломать dApp.

### 3.2. Через consent banner

При первом визите показывается banner:

- [x] **Strictly necessary** — всегда включены.
- [ ] **Analytics** — по умолчанию **выключены**.
- [ ] **Third-party** — по умолчанию **выключены** (кроме WalletConnect,
      если подключаете кошелёк).

Настройки сохраняются в `localStorage` (`xartia.consent`).

### 3.3. Do Not Track (DNT)

Мы **уважаем** DNT. Если включён — analytics отключена автоматически.

### 3.4. Global Privacy Control (GPC)

Мы **уважаем** GPC (для CCPA). Если включён — analytics отключена.

---

## 4. Third-party cookies

Если dApp подключает третьи стороны (WalletConnect, Snapshot), они могут
устанавливать свои cookies. Мы **не контролируем** их. Ознакомьтесь:

- WalletConnect: `<link>`
- Snapshot: `<link>`
- Cloudflare: `<link>`

**Мы не продаём данные третьим лицам.**

---

## 5. Изменения

Cookie Policy может обновляться. Новая версия публикуется на GitHub.
Материальные изменения анонсируются через banner при следующем визите.

**Последнее обновление:** 2026-10-26.

---

## 6. Контакты

- **Общие вопросы:** `privacy@xartia.example`
- **DPO:** `<DPO email>` (TBD)

---

## 7. Ссылки

- `legal/privacy.md` (L.2.01.02)
- `legal/terms.md` (L.2.01.01)
- `legal/disclaimer.md` (L.2.01.03)

---

**ОТКАЗ ОТ ОТВЕТСТВЕННОСТИ:** этот документ — draft. Требует review юриста.