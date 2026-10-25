#!/usr/bin/env python3
# check_files.py
"""
Сравнение спецификации id_2.md с реальными файлами проекта.

Извлекает из каждого блока 5-ю колонку (путь) и проверяет:
  - существует ли файл
  - есть ли у файла свой блок
  - есть ли у блока свой файл

Использование:
  python check_files.py
  python check_files.py --sections A,C,D
  python check_files.py --section D
  python check_files.py --only-missing-files
  python check_files.py --only-missing-blocks
  python check_files.py --only-filled-files
  python check_files.py --only-empty-files

Если скрипт запущен без аргументов (например, двойным кликом),
рядом со спецификацией создаётся отчёт check_files.md.
"""

import argparse
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

BLOCK_START_RE = re.compile(r'^\|([A-Z](?:\.\d+){2,4})\|')
SPEC_FILE = 'id_2.md'

# Расширения, которые не проверяем как «файлы проекта»
IGNORE_EXT = {'.txt', '.log'}

# Папки, которые не сканируем
EXCLUDE_DIRS = {
    '.git', 'node_modules', '__pycache__', '.venv', 'venv',
    '.idea', '.vscode', 'dist', 'build', 'coverage', 'ИСТОРИЯ',
    # Локальные артефакты и черновики — не файлы проекта.
    'temp', 'backups',
    # Временная папка для анализа чужой спецификации (XartIA 4.2) — не проект.
    'XartIA 4.2',
}

# Файлы-заглушки систем контроля версий и исходные тексты Хартии:
# это не «файлы проекта», у них не должно быть блоков реестра.
IGNORE_SUFFIXES = ('.gitkeep',)
IGNORE_PREFIXES = ('docs/charter-specs/',)


def load_lines(path: Path):
    with open(path, 'r', encoding='utf-8-sig') as f:
        return f.read().splitlines(keepends=True)


def find_blocks(lines):
    starts = []
    for i, line in enumerate(lines):
        m = BLOCK_START_RE.match(line)
        if m:
            starts.append((i, m.group(1)))
    blocks = []
    for j, (start_idx, block_id) in enumerate(starts):
        end_idx = starts[j + 1][0] if j + 1 < len(starts) else len(lines)
        blocks.append((start_idx, end_idx, block_id))
    return blocks


def parse_header(header_line: str):
    """
    Разбирает строку вида:
      |A.1.01.01|API|REST|TypeScript|src/api/auth/controller.ts|deps|v|st|refs|
    Возвращает dict с полями или None, если не распарсилось.
    """
    line = header_line.lstrip('\ufeff').rstrip('\r\n')
    if not line.startswith('|'):
        return None
    parts = [p.strip() for p in line.split('|')]
    if parts and parts[0] == '':
        parts = parts[1:]
    if parts and parts[-1] == '':
        parts = parts[:-1]
    if len(parts) < 5:
        return None
    return {
        'id': parts[0],
        'category': parts[1] if len(parts) > 1 else '',
        'subcat': parts[2] if len(parts) > 2 else '',
        'lang': parts[3] if len(parts) > 3 else '',
        'path': parts[4] if len(parts) > 4 else '',
    }


def scan_project_files(root: Path):
    """Возвращает set относительных путей (posix) всех файлов проекта."""
    files = set()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [
            d for d in dirnames
            if d not in EXCLUDE_DIRS and not d.startswith('.')
        ]
        for name in filenames:
            full = Path(dirpath) / name
            try:
                rel = full.relative_to(root)
            except ValueError:
                continue
            files.add(rel.as_posix())
    return files


def size_marker(full_path: Path) -> str:
    """Возвращает строку-маркер размера: '[пусто]' или '[N б]'."""
    try:
        size = full_path.stat().st_size
    except OSError:
        return ''
    return ' [пусто]' if size == 0 else f' [{size} б]'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', default=SPEC_FILE)
    ap.add_argument('--sections', help='Список секций через запятую: A,C,D')
    ap.add_argument('--section', help='Одна секция')
    ap.add_argument('--only-missing-files', action='store_true',
                    help='Только блоки без файлов')
    ap.add_argument('--only-missing-blocks', action='store_true',
                    help='Только файлы без блоков')
    ap.add_argument('--only-filled-files', action='store_true',
                    help='Только непустые файлы, у которых есть блок')
    ap.add_argument('--only-empty-files', action='store_true',
                    help='Только пустые файлы (0 байт), у которых есть блок')
    args = ap.parse_args()

    spec = Path(args.file)
    if not spec.exists():
        print(f"ERROR: {spec} не найден", file=sys.stderr)
        return 1

    root = spec.resolve().parent
    lines = load_lines(spec)
    blocks = find_blocks(lines)

    # --- Собираем: ID -> {path, start, end, header} ----------------------
    block_info = {}
    for start, end, bid in blocks:
        parsed = parse_header(lines[start])
        if parsed is None:
            continue
        block_info[bid] = {
            'path': parsed['path'],
            'category': parsed['category'],
            'lang': parsed['lang'],
            'start': start,
            'end': end,
            'header': lines[start].rstrip('\r\n'),
        }

    # --- Реальные файлы проекта -----------------------------------------
    project_files = scan_project_files(root)

    # --- Фильтр по секциям ----------------------------------------------
    sections_filter = None
    if args.section:
        sections_filter = {args.section.upper()}
    elif args.sections:
        sections_filter = {s.strip().upper() for s in args.sections.split(',')}

    def in_filter(bid):
        if not sections_filter:
            return True
        return bid.split('.', 1)[0] in sections_filter

    # --- 1. Блоки, для которых нет файлов -------------------------------
    missing_files = []
    empty_files = []
    filled_files = []
    for bid, info in sorted(block_info.items()):
        if not in_filter(bid):
            continue
        path = info['path'].strip()
        if not path or path in ('—', '-', 'null', 'None'):
            continue
        if Path(path).suffix.lower() in IGNORE_EXT:
            continue
        full = root / path
        if not full.exists():
            missing_files.append((bid, path))
        elif full.stat().st_size == 0:
            empty_files.append((bid, path))
        else:
            filled_files.append((bid, path))

    # --- 2. Файлы, для которых нет блоков -------------------------------
    paths_in_spec = {}
    for bid, info in block_info.items():
        p = info['path'].strip()
        if p:
            paths_in_spec.setdefault(p, []).append(bid)

    missing_blocks = []
    SYSTEM_FILES = {
        'id_2.md', 'reestr.md', 'reestr.py', 'fix_spf.py',
        'analyze_spf.py', 'check_files.py', 'package-lock.json',
        'id_2.md.bak', 'id_2.md.manual_backup', 'spf_list.txt',
        'spf_analysis.txt', 'check_files.md',
        # Пустые/черновые реестры и артефакты склейки, которые ведёт автор
        'id_3.md', 'клей.md', 'клей_id.md', 'клей_файл.md',
        # Корневые meta-документы проекта (не спека — инфраструктура)
        'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md',
        'CODE_OF_CONDUCT.md', 'SECURITY.md', 'LICENSE.md', 'LICENSE',
    }
    for f in sorted(project_files):
        if Path(f).suffix.lower() in IGNORE_EXT:
            continue
        if f.endswith(IGNORE_SUFFIXES) or f.startswith(IGNORE_PREFIXES):
            continue
        if f not in paths_in_spec:
            if f in SYSTEM_FILES:
                continue
            missing_blocks.append((f, None))

    # --- Сбор вывода (в список, чтобы потом записать в .md) -------------
    out = []

    def emit(line=''):
        out.append(line)
        print(line)

    emit("=" * 72)
    emit("СРАВНЕНИЕ СПЕЦИФИКАЦИИ И ФАЙЛОВ")
    emit("=" * 72)
    emit(f"  Файл спецификации:       {spec.name}")
    emit(f"  Блоков в спецификации:   {len(block_info)}")
    emit(f"  Файлов в проекте:        {len(project_files)}")
    emit()

    if not args.only_missing_blocks and not args.only_empty_files \
            and not args.only_filled_files:
        emit("=" * 72)
        emit(f"1. БЛОКИ БЕЗ ФАЙЛОВ: {len(missing_files)}")
        emit("=" * 72)
        if missing_files:
            for bid, path in missing_files:
                emit(f"  {bid:15s}  {path}")
        else:
            emit("  (нет)")

    if not args.only_missing_files and not args.only_empty_files \
            and not args.only_filled_files:
        emit()
        emit("=" * 72)
        emit(f"2. ФАЙЛЫ БЕЗ БЛОКОВ: {len(missing_blocks)}")
        emit("=" * 72)
        if missing_blocks:
            for path, _ in missing_blocks:
                full = root / path
                emit(f"  {path}{size_marker(full)}")
        else:
            emit("  (нет)")

    if not args.only_missing_files and not args.only_missing_blocks \
            and not args.only_empty_files:
        emit()
        emit("=" * 72)
        emit(f"3. ФАЙЛЫ С СОДЕРЖИМЫМ (с блоком в спецификации): "
             f"{len(filled_files)}")
        emit("=" * 72)
        if filled_files:
            for bid, path in filled_files:
                full = root / path
                emit(f"  {bid:15s}  {path}{size_marker(full)}")
        else:
            emit("  (нет)")

    if not args.only_missing_files and not args.only_missing_blocks \
            and not args.only_filled_files:
        emit()
        emit("=" * 72)
        emit(f"4. ПУСТЫЕ ФАЙЛЫ (с блоком в спецификации): "
             f"{len(empty_files)}")
        emit("=" * 72)
        if empty_files:
            for bid, path in empty_files:
                full = root / path
                emit(f"  {bid:15s}  {path}{size_marker(full)}")
        else:
            emit("  (нет)")

    # --- Сводка ----------------------------------------------------------
    emit()
    emit("=" * 72)
    emit("СВОДКА")
    emit("=" * 72)
    emit(f"  Блоков без файлов:    {len(missing_files)}")
    emit(f"  Файлов без блоков:    {len(missing_blocks)}")
    emit(f"  Файлов с содержимым:  {len(filled_files)}")
    emit(f"  Пустых файлов:        {len(empty_files)}")

    # --- Автосохранение отчёта при запуске без аргументов ---------------
    if len(sys.argv) == 1:
        out_path = root / 'check_files.md'
        try:
            out_path.write_text('\n'.join(out) + '\n', encoding='utf-8')
            print(f"\nРезультат сохранён в {out_path}")
        except OSError as e:
            print(f"WARN: не удалось записать {out_path}: {e}",
                  file=sys.stderr)

    return 0


if __name__ == '__main__':
    sys.exit(main())