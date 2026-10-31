#!/usr/bin/env python3
"""
Фиксатор каталога атомов кибернетики (v2, с поддержкой replace_all).
Запускать из каталога, где лежат паспорт.md и каталог_атомов_кибернетики.md.
"""
import shutil
import sys
from pathlib import Path

PASSPORT = Path("паспорт.md")
CATALOG = Path("каталог_атомов_кибернетики.md")
DRY_RUN = "--dry-run" in sys.argv
NO_BACKUP = "--no-backup" in sys.argv


FIXES_PASSPORT = [
    {
        "id": "P0.1",
        "description": "шапка: 0.3.2 → 0.3.3",
        "search": "**Версия документа:** 0.3.2",
        "replace": "**Версия документа:** 0.3.3",
    },
    {
        "id": "P0.2",
        "description": "история: запись v0.3.3",
        "search": (
            "| 0.3.2 | 31.10.2026 | Согласованы поля карточки атома между 5.1 и 15.1 "
            "(`dimension_applicability`, `freshness_policy`); 15.1 помечен как "
            "сокращённый пример; введены статусы `Claim.status`; из раздела 22 удалено "
            "упоминание `confidence`; добавлен статус `rejected` для `Assessment.status`; "
            "в открытые вопросы добавлены сравнение доказательной основы и структура "
            "`practice_review_policy`; в 7.3 уточнено различие между `context` карточки "
            "атома и контекстом доказательства; в 18.1 зафиксировано, что приоритет "
            "апелляции может быть скорректирован по итогам первичной проверки. |"
        ),
        "replace": (
            "| 0.3.2 | 31.10.2026 | Согласованы поля карточки атома между 5.1 и 15.1 "
            "(`dimension_applicability`, `freshness_policy`); 15.1 помечен как "
            "сокращённый пример; введены статусы `Claim.status`; из раздела 22 удалено "
            "упоминание `confidence`; добавлен статус `rejected` для `Assessment.status`; "
            "в открытые вопросы добавлены сравнение доказательной основы и структура "
            "`practice_review_policy`; в 7.3 уточнено различие между `context` карточки "
            "атома и контекстом доказательства; в 18.1 зафиксировано, что приоритет "
            "апелляции может быть скорректирован по итогам первичной проверки. |\n"
            "| 0.3.3 | 31.10.2026 | В 4.4 добавлена оговорка: префикс `CYB` обозначает "
            "домашнюю точку сопровождения карточки, а не эксклюзивное владение смыслом "
            "атома. В 5.1 для `translations` указано, что для `candidate` допускается "
            "отсутствие перевода с пометкой `pending_translation`; поле обязательно при "
            "переводе в `in_review`. |"
        ),
    },
    {
        "id": "P1-A3",
        "description": "4.4: оговорка про значение префикса CYB",
        "search": (
            "Сокращения наподобие `A01`, `B01`, `D01` допустимы только в черновых "
            "таблицах, если они однозначны внутри конкретного документа. Они не "
            "являются постоянными ID: в предыдущих рабочих таблицах обнаруживались "
            "повторения и переиспользование одинаковых коротких кодов для разных смыслов."
        ),
        "replace": (
            "Сокращения наподобие `A01`, `B01`, `D01` допустимы только в черновых "
            "таблицах, если они однозначны внутри конкретного документа. Они не "
            "являются постоянными ID: в предыдущих рабочих таблицах обнаруживались "
            "повторения и переиспользование одинаковых коротких кодов для разных смыслов.\n"
            "\n"
            "Префикс `CYB` в `CYB.ATOM.NNNN` обозначает **домашнюю точку сопровождения** "
            "карточки (направление, которое ведёт запись и отвечает за её "
            "версионирование), а не эксклюзивное владение смыслом атома. Атом может "
            "применяться в любых направлениях; ограничение на принадлежность по "
            "префиксу не вводится."
        ),
    },
    {
        "id": "P2-B6",
        "description": "5.1: translations для candidate опционально",
        "search": (
            "| `translations` | Переводы определения и критериев на локальные языки, "
            "привязанные к `atom_id` и версии; канонический текст — на стержневом "
            "языке (Хартия, Книга VII, Часть 1) |"
        ),
        "replace": (
            "| `translations` | Переводы определения и критериев на локальные языки, "
            "привязанные к `atom_id` и версии; канонический текст — на стержневом "
            "языке (Хартия, Книга VII, Часть 1). Для `candidate` допускается отсутствие "
            "перевода с пометкой `pending_translation`; поле обязательно при переводе "
            "в `in_review` |"
        ),
    },
]


FIXES_CATALOG = [
    {
        "id": "C0.1",
        "description": "шапка каталога: 0.2.0 → 0.3.0",
        "search": "**Версия:** 0.2.0",
        "replace": "**Версия:** 0.3.0",
    },
    {
        "id": "C0.2",
        "description": "история каталога: запись v0.3.0",
        "search": (
            "| 0.2.0 | 31.10.2026 | Проведена глубокая ревизия первых 10 кандидатов; "
            "сужен состав 0002; уточнены границы 0001–0010, измерения и способы "
            "проверки; добавлены варианты заданий и сводка решений. Все записи остаются "
            "кандидатами. |"
        ),
        "replace": (
            "| 0.2.0 | 31.10.2026 | Проведена глубокая ревизия первых 10 кандидатов; "
            "сужен состав 0002; уточнены границы 0001–0010, измерения и способы "
            "проверки; добавлены варианты заданий и сводка решений. Все записи остаются "
            "кандидатами. |\n"
            "| 0.3.0 | 31.10.2026 | Нормализованы типы связей по 4.2 паспорта: "
            "`supports` → `prerequisite_for`, `uses` → `requires`, "
            "`applies_to` → `related_to`. Имена атомов в проекциях приведены к v0.2.0. "
            "Префикс `CYB` определён как домашняя точка сопровождения. XSK-теги "
            "заменены на `overlaps` / `contextualizes` из 4.1. В раздел 6 добавлены "
            "`0008` (кросс-доменный) и `0053` (составной). `**Фокус пяти измерений:**` "
            "переименован в `**assessment_criteria:**`. В раздел 7 добавлена оговорка "
            "о пониженных уровнях `0025`/`0027` для QA. В разделе 8 отмечено, что "
            "критерии `0011–0054` — черновые. В `0052` добавлена связь с `0014`. |"
        ),
    },
    {
        "id": "C1-A3",
        "description": "4: префикс CYB — домашняя точка сопровождения",
        "search": (
            "- `CYB.ATOM.NNNN` — глобальный кандидатный ID. При принятии атома ID "
            "сохраняется; при отказе не используется повторно."
        ),
        "replace": (
            "- `CYB.ATOM.NNNN` — глобальный кандидатный ID. При принятии атома ID "
            "сохраняется; при отказе не используется повторно. Префикс `CYB` "
            "обозначает домашнюю точку сопровождения (D09 ведёт карточку и "
            "версионирует её), а не эксклюзивное владение. Атом может применяться в "
            "любых направлениях; см. паспорт 4.4."
        ),
    },

    # --- Связи 0011–0053 (все уже применились, оставлены для идемпотентности) ---
    {"id": "C-L0011", "description": "связи 0011", "search": "**Связи:** supports 0010, 0018, 0024.", "replace": "**Связи:** prerequisite_for 0010, prerequisite_for 0018, prerequisite_for 0024."},
    {"id": "C-L0013", "description": "связи 0013", "search": "**Связи:** uses 0002 and 0012.", "replace": "**Связи:** requires 0002, requires 0012."},
    {"id": "C-L0015", "description": "связи 0015", "search": "**Связи:** uses 0009 and 0031.", "replace": "**Связи:** requires 0009, requires 0031."},
    {"id": "C-L0016", "description": "связи 0016", "search": "**Связи:** supports team workflows and 0045.", "replace": "**Связи:** prerequisite_for 0045."},
    {"id": "C-L0018", "description": "связи 0018", "search": "**Связи:** uses 0010 and 0017.", "replace": "**Связи:** requires 0010, requires 0017."},
    {"id": "C-L0019", "description": "связи 0019", "search": "**Связи:** requires 0020 in some tasks; supports 0023.", "replace": "**Связи:** requires 0020; prerequisite_for 0023."},
    {"id": "C-L0020", "description": "связи 0020", "search": "**Связи:** uses 0019; related_to 0021.", "replace": "**Связи:** requires 0019; related_to 0021."},
    {"id": "C-L0022", "description": "связи 0022", "search": "**Связи:** uses 0019, 0024.", "replace": "**Связи:** requires 0019, requires 0024."},
    {"id": "C-L0023", "description": "связи 0023", "search": "**Связи:** uses 0019, 0022.", "replace": "**Связи:** requires 0019, requires 0022."},
    {"id": "C-L0025", "description": "связи 0025", "search": "**Связи:** uses 0001 and 0010; requires for 0026 and 0033.", "replace": "**Связи:** requires 0001, requires 0010, requires 0026, requires 0033."},
    {"id": "C-L0027", "description": "связи 0027", "search": "**Связи:** related_to 0039; uses 0002.", "replace": "**Связи:** related_to 0039; requires 0002."},
    {"id": "C-L0028", "description": "связи 0028", "search": "**Связи:** uses 0013, 0025.", "replace": "**Связи:** requires 0013, requires 0025."},
    {"id": "C-L0029", "description": "связи 0029", "search": "**Связи:** requires 0001; supports 0030.", "replace": "**Связи:** requires 0001; prerequisite_for 0030."},
    {"id": "C-L0030", "description": "связи 0030", "search": "**Связи:** uses 0029; supports 0031–0033.", "replace": "**Связи:** requires 0029; prerequisite_for 0031, 0032, 0033."},
    {"id": "C-L0031", "description": "связи 0031", "search": "**Связи:** uses 0030, 0034.", "replace": "**Связи:** requires 0030, requires 0034."},
    {"id": "C-L0032", "description": "связи 0032", "search": "**Связи:** uses 0030, 0034; related_to 0045.", "replace": "**Связи:** requires 0030, requires 0034; related_to 0045."},
    {"id": "C-L0033", "description": "связи 0033", "search": "**Связи:** requires 0025; applies_to 0026.", "replace": "**Связи:** requires 0025; related_to 0026."},
    {"id": "C-L0034", "description": "связи 0034", "search": "**Связи:** supports 0031–0033.", "replace": "**Связи:** prerequisite_for 0031, 0032, 0033."},
    {"id": "C-L0035", "description": "связи 0035", "search": "**Связи:** uses 0029–0034.", "replace": "**Связи:** requires 0029, 0030, 0031, 0032, 0033, 0034."},
    {"id": "C-L0037", "description": "связи 0037", "search": "**Связи:** supports 0038–0044.", "replace": "**Связи:** prerequisite_for 0038, 0039, 0040, 0041, 0042, 0043, 0044."},
    {"id": "C-L0038", "description": "связи 0038", "search": "**Связи:** uses 0027; requires context from 0037.", "replace": "**Связи:** requires 0027, requires 0037."},
    {"id": "C-L0039", "description": "связи 0039", "search": "**Связи:** supports 0045–0048.", "replace": "**Связи:** prerequisite_for 0045, 0046, 0047, 0048."},
    {"id": "C-L0040", "description": "связи 0040", "search": "**Связи:** uses 0037, 0039.", "replace": "**Связи:** requires 0037, requires 0039."},
    {"id": "C-L0041", "description": "связи 0041", "search": "**Связи:** uses 0017; supports 0045.", "replace": "**Связи:** requires 0017; prerequisite_for 0045."},
    {"id": "C-L0044", "description": "связи 0044", "search": "**Связи:** supports 0050 and 0052.", "replace": "**Связи:** prerequisite_for 0050, 0052."},
    {"id": "C-L0045", "description": "связи 0045", "search": "**Связи:** uses 0017; supports 0046–0048.", "replace": "**Связи:** requires 0017; prerequisite_for 0046, 0047, 0048."},
    {"id": "C-L0046", "description": "связи 0046", "search": "**Связи:** uses 0045 and 0041.", "replace": "**Связи:** requires 0045, requires 0041."},
    {"id": "C-L0047", "description": "связи 0047", "search": "**Связи:** uses 0016, 0017, 0031, 0032, 0041.", "replace": "**Связи:** requires 0016, 0017, 0031, 0032, 0041."},
    {"id": "C-L0048", "description": "связи 0048", "search": "**Связи:** uses 0045; supports 0047 and 0049.", "replace": "**Связи:** requires 0045; prerequisite_for 0047, 0049."},
    {"id": "C-L0049", "description": "связи 0049", "search": "**Связи:** uses 0045, 0048; related_to 0052.", "replace": "**Связи:** requires 0045, 0048; related_to 0052."},
    {"id": "C-L0050", "description": "связи 0050", "search": "**Связи:** supports 0014, 0051, 0052.", "replace": "**Связи:** prerequisite_for 0014, 0051, 0052."},
    {"id": "C-L0051", "description": "связи 0051", "search": "**Связи:** supports 0052.", "replace": "**Связи:** prerequisite_for 0052."},
    {"id": "C-L0052", "description": "связи 0052", "search": "**Связи:** uses 0024, 0049, 0050, 0051.", "replace": "**Связи:** requires 0024, 0049, 0050, 0051; related_to 0014."},
    {"id": "C-L0053", "description": "связи 0053", "search": "**Связи:** uses 0045; supports 0049 and 0052.", "replace": "**Связи:** requires 0045; prerequisite_for 0049, 0052."},

    # --- C-P-0007 (уже применён) ---
    {
        "id": "C-P-0007",
        "description": "проекции: 0007 имя приведено к v0.2.0",
        "search": "`CYB.ATOM.0007` — Оценить временную и пространственную сложность алгоритма",
        "replace": "`CYB.ATOM.0007` — Определить и обосновать асимптотическую временную и пространственную сложность алгоритма",
    },

    # ============================================================
    # ИСПРАВЛЕНИЯ: эти 6 правок — replace_all (встречаются несколько раз)
    # ============================================================
    {
        "id": "C-P-0002",
        "description": "проекции: 0002 имя приведено к v0.2.0 (все 3 вхождения)",
        "search": "`CYB.ATOM.0002` — Определить допущения, ограничения и инварианты задачи",
        "replace": "`CYB.ATOM.0002` — Выявить и зафиксировать допущения и ограничения задачи",
        "replace_all": True,
    },
    {
        "id": "C-P-0004",
        "description": "проекции: 0004 имя приведено к v0.2.0 (все 2 вхождения)",
        "search": "`CYB.ATOM.0004` — Построить модель состояний и переходов программы",
        "replace": "`CYB.ATOM.0004` — Построить модель состояний и переходов объекта или процесса",
        "replace_all": True,
    },
    {
        "id": "C-B4a",
        "description": "XSK: (смысловое пересечение) → (overlaps) — все вхождения",
        "search": "(смысловое пересечение)",
        "replace": "(overlaps)",
        "replace_all": True,
    },
    {
        "id": "C-B4e",
        "description": "XSK: (частичное пересечение) → (overlaps) — все вхождения",
        "search": "(частичное пересечение)",
        "replace": "(overlaps)",
        "replace_all": True,
    },
    {
        "id": "C-B4f",
        "description": "XSK: (частичные связи) → (overlaps) — все вхождения",
        "search": "(частичные связи)",
        "replace": "(overlaps)",
        "replace_all": True,
    },
    {
        "id": "C-B7",
        "description": "**Фокус пяти измерений:** → **assessment_criteria:** — все 55 вхождений",
        "search": "**Фокус пяти измерений:**",
        "replace": "**assessment_criteria:**",
        "replace_all": True,
    },

    # --- C-B4b/l (уже применены) ---
    {"id": "C-B4b", "description": "XSK: (контекст применения) → (contextualizes)", "search": "(контекст применения)", "replace": "(contextualizes)"},
    {"id": "C-B4c", "description": "XSK: (контекст языка) → (contextualizes)", "search": "(контекст языка)", "replace": "(contextualizes)"},
    {"id": "C-B4d", "description": "XSK: (контекст развёртывания) → (contextualizes)", "search": "(контекст развёртывания)", "replace": "(contextualizes)"},
    {"id": "C-B4g", "description": "XSK: (смежно) → (overlaps)", "search": "(смежно)", "replace": "(overlaps)"},
    {"id": "C-B4h", "description": "XSK: (смежные) → (overlaps)", "search": "(смежные)", "replace": "(overlaps)"},
    {"id": "C-B4i", "description": "XSK: (частичная связь) → (overlaps)", "search": "(частичная связь)", "replace": "(overlaps)"},
    {"id": "C-B4j", "description": "XSK: (смежный инфраструктурный контекст) → (contextualizes)", "search": "(смежный инфраструктурный контекст)", "replace": "(contextualizes)"},
    {"id": "C-B4k", "description": "XSK: (диагностика — смежно) → (overlaps)", "search": "(диагностика — смежно)", "replace": "(overlaps)"},
    {
        "id": "C-B4l",
        "description": "4.1: правило для связей без тегов",
        "search": "| `no_direct_match` | В старом каталоге не найден прямой навык-источник |",
        "replace": (
            "| `no_direct_match` | В старом каталоге не найден прямой навык-источник |\n"
            "\n"
            "Если у связи XSK тег не указан или указан в виде прозы, это означает, "
            "что связь остаётся кандидатной и должна получить один из четырёх тегов "
            "при переводе в `in_review`."
        ),
    },
    {
        "id": "C-B5-D11-D13",
        "description": "раздел 6: уточнены 0052 и 0053, добавлен 0008",
        "search": (
            "- `CYB.ATOM.0052` — первичная диагностика инцидента, восстановление и "
            "подтверждение восстановления могут быть разными атомами.\n"
            "\n"
            "Наличие этих замечаний не означает, что разделение уже принято. Это "
            "контрольные точки предметной проверки, чтобы минимальная единица не стала "
            "скрытой компетентностью."
        ),
        "replace": (
            "- `CYB.ATOM.0052` — первичная диагностика инцидента, восстановление и "
            "подтверждение восстановления могут быть разными атомами. Диагностика "
            "пересекается с `0014` и `0051`; уточнить, какая способность уникальна "
            "для `0052`.\n"
            "- `CYB.ATOM.0053` — управление процессами (разовый запуск) и службами ОС "
            "(постоянные демоны с зависимостями) могут требовать разных заданий; "
            "проверить отдельно.\n"
            "\n"
            "Отдельно от составных: `CYB.ATOM.0008` — кросс-доменный кандидат. До "
            "согласования должен считаться общей инженерной способностью, а не "
            "исключительной компетенцией D09. При `in_review` решить, сохранять ли "
            "`CYB` как домашнюю точку (см. раздел 4) или ввести отдельный префикс.\n"
            "\n"
            "Наличие этих замечаний не означает, что разделение уже принято. Это "
            "контрольные точки предметной проверки, чтобы минимальная единица не стала "
            "скрытой компетентностью."
        ),
    },
    {
        "id": "C-C8",
        "description": "раздел 7: оговорка про пониженные уровни 0025/0027 для QA",
        "search": (
            "### Общие зоны пересечения\n"
            "\n"
            "Кандидаты на повторное использование между несколькими профилями включают "
            "формализацию требований (0001), декомпозицию (0003), контроль версий "
            "(0016), воспроизводимые среды (0017), анализ дефектов (0014), "
            "безопасность и работу с зависимостями (0037–0044), CI и наблюдаемость "
            "(0047, 0050). Но общность ID не означает одинаковый минимальный уровень "
            "или одинаковое задание: контекст и доказательство проверяются отдельно."
        ),
        "replace": (
            "### Общие зоны пересечения\n"
            "\n"
            "Кандидаты на повторное использование между несколькими профилями включают "
            "формализацию требований (0001), декомпозицию (0003), контроль версий "
            "(0016), воспроизводимые среды (0017), анализ дефектов (0014), "
            "безопасность и работу с зависимостями (0037–0044), CI и наблюдаемость "
            "(0047, 0050). Но общность ID не означает одинаковый минимальный уровень "
            "или одинаковое задание: контекст и доказательство проверяются отдельно.\n"
            "\n"
            "### Разные уровни одного атома в разных профилях\n"
            "\n"
            "Присутствие атома в профиле не означает одинаковый требуемый уровень. "
            "Например, QA использует `CYB.ATOM.0025` (определение контракта HTTP API) "
            "и `CYB.ATOM.0027` (валидация запроса) на уровне понимания и проверки, а "
            "не создания; соответствующие уровни по U/X/D/P/E в `ProfessionProfile` "
            "должны быть понижены относительно Backend. То же для `0025` и `0033`: "
            "QA читает контракт и проверяет соответствие, Backend создаёт и контракт, "
            "и обработчик."
        ),
    },
    {
        "id": "C-C9",
        "description": "раздел 8: оговорка про черновые критерии 0011–0054",
        "search": "Для перевода в `approved` дополнительно необходимы:",
        "replace": (
            "В карточках `0011–0054` критерии пяти измерений — черновые и не проходили "
            "ревизию уровня `0001–0010`. До `in_review` их требуется расширить до "
            "полноценных `assessment_criteria` по образцу `0001`: с якорями, "
            "примерами и границами, пригодными для калибровки.\n"
            "\n"
            "Для перевода в `approved` дополнительно необходимы:"
        ),
    },
]


def apply_to_file(path: Path, fixes: list) -> tuple:
    if not path.exists():
        return [], [("file", str(path), "файл не найден")], []

    original = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    text = original

    applied = []
    skipped = []
    already_done = []

    for fix in fixes:
        tag = fix["id"]
        desc = fix["description"]
        search = fix["search"]
        replace = fix["replace"]
        replace_all = fix.get("replace_all", False)

        if replace_all:
            if search not in text:
                if replace in text:
                    already_done.append((tag, desc))
                else:
                    skipped.append((tag, desc, "search не найден"))
                continue
            n = text.count(search)
            text = text.replace(search, replace)
            applied.append((tag, f"{desc} [заменено {n} вхождений]"))
        else:
            n = text.count(search)
            if n == 0:
                if text.count(replace) > 0:
                    already_done.append((tag, desc))
                else:
                    skipped.append((tag, desc, "search не найден"))
                continue
            if n > 1:
                skipped.append((tag, desc, f"search не уникален ({n} раз) — пометить как replace_all"))
                continue
            text = text.replace(search, replace, 1)
            applied.append((tag, desc))

    if text != original and not DRY_RUN:
        if not NO_BACKUP:
            backup = path.with_suffix(path.suffix + ".bak")
            shutil.copy2(path, backup)
            print(f"  Резервная копия: {backup.resolve()}")
        path.write_text(text, encoding="utf-8")
        print(f"  Записан: {path.resolve()}")

    return applied, skipped, already_done


def main() -> int:
    total_applied = 0
    total_skipped = 0
    total_already = 0

    for path, fixes in ((PASSPORT, FIXES_PASSPORT), (CATALOG, FIXES_CATALOG)):
        print(f"\n=== {path.name} ===")
        if not path.exists():
            print(f"  ОШИБКА: не найден {path.resolve()}")
            return 1

        applied, skipped, already_done = apply_to_file(path, fixes)

        print(f"  Применено: {len(applied)} / уже было: {len(already_done)} / пропущено: {len(skipped)}")

        if applied:
            print("  ✓ Применено:")
            for tag, desc in applied:
                print(f"     [{tag}] {desc}")

        if skipped:
            print("  ✗ Пропущено:")
            for tag, desc, reason in skipped:
                print(f"     [{tag}] {desc} — {reason}")

        total_applied += len(applied)
        total_skipped += len(skipped)
        total_already += len(already_done)

    print(f"\n=== ИТОГ: применено {total_applied}, уже было {total_already}, пропущено {total_skipped} ===")
    if DRY_RUN:
        print("[dry-run] Ничего не записано.")
    return 0 if total_skipped == 0 else 1


if __name__ == "__main__":
    sys.exit(main())