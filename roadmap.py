#!/usr/bin/env python3
# roadmap.py
"""
Снимок состояния проекта по реестру id_2.md — для docs/roadmap.md.

Что считает:
  - блоки реестра и состояние их файлов: filled / empty / missing;
  - готовность по книгам (A, C, D, F, W, L, S, N, M, T, X, I);
  - фронт работ: блоки, чьи зависимости закрыты, а файл пуст или отсутствует;
  - транзитивный вес: сколько блоков разблокирует каждый файл;
  - активность из git log: какие блоки упоминались в сообщениях коммитов.

Использование:
  python roadmap.py                     # отчёт в консоль
  python roadmap.py --out docs/roadmap-state.md
  python roadmap.py --limit 30          # сколько строк фронта печатать
  python roadmap.py --json temp/roadmap.json

Блоки со статусом Deprecated/Reserved в фронт не попадают: это объявленный
отказ, а не долг.
"""

import argparse
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SPEC = ROOT / 'id_2.md'

BLOCK_START_RE = re.compile(r'^\|([A-Z](?:\.\d+){2,4})\|')
ID_RE = re.compile(r'\b([A-Z]\.\d+(?:\.\d+){1,3})\b')

BOOK_TITLES = {
    'A': 'API (Fastify-роуты)',
    'C': 'Core (доменная логика)',
    'D': 'DB (миграции, схема)',
    'F': 'Frontend (React)',
    'W': 'WS (WebSocket-каналы)',
    'L': 'Lib (общие библиотеки)',
    'S': 'Security (права, аудит)',
    'N': 'AI (наставник, страж, перевод)',
    'M': 'Mobile (React Native)',
    'T': 'Tests',
    'X': 'Docs',
    'I': 'Infra (k8s, helm, terraform, CI)',
}

SKIP_STATUS = {'Deprecated', 'Reserved'}


def load_blocks():
    """Разбирает id_2.md: заголовок блока — строка |ID|категория|имя|язык|путь|..."""
    lines = SPEC.read_text(encoding='utf-8-sig').splitlines()
    starts = [(i, m.group(1)) for i, line in enumerate(lines)
              for m in [BLOCK_START_RE.match(line)] if m]
    blocks, order = {}, []
    for j, (i, bid) in enumerate(starts):
        end = starts[j + 1][0] if j + 1 < len(starts) else len(lines)
        parts = [p.strip() for p in lines[i].split('|')]
        if parts and parts[0] == '':
            parts = parts[1:]
        if parts and parts[-1] == '':
            parts = parts[:-1]
        deps_raw = parts[5] if len(parts) > 5 else ''
        deps = ID_RE.findall(deps_raw) if deps_raw not in ('—', '-', '') else []
        blocks[bid] = {
            'id': bid,
            'book': bid.split('.')[0],
            'category': parts[1] if len(parts) > 1 else '',
            'name': parts[2] if len(parts) > 2 else '',
            'lang': parts[3] if len(parts) > 3 else '',
            'path': parts[4] if len(parts) > 4 else '',
            'deps': deps,
            'version': parts[6] if len(parts) > 6 else '',
            'status': parts[7] if len(parts) > 7 else '',
            'spec_lines': end - i,
        }
        order.append(bid)
    return blocks, order


def file_state(path):
    """('filled'|'empty'|'missing'|'n/a', строк в файле)."""
    if not path or path in ('—', '-', 'null', 'None'):
        return 'n/a', 0
    full = ROOT / path
    try:
        if not full.exists():
            return 'missing', 0
        if full.stat().st_size == 0:
            return 'empty', 0
        with full.open('r', encoding='utf-8', errors='ignore') as f:
            return 'filled', sum(1 for _ in f)
    except OSError:
        return 'missing', 0


def git_commits():
    """Список коммитов с ID блоков, упомянутыми в сообщении."""
    try:
        raw = subprocess.run(
            ['git', 'log', '--format=%H%x1f%ad%x1f%s%x1f%b%x1e', '--date=short'],
            cwd=ROOT, capture_output=True, text=True,
            encoding='utf-8', errors='replace', check=True)
    except (OSError, subprocess.CalledProcessError):
        return []
    result = []
    for chunk in raw.stdout.split('\x1e'):
        chunk = chunk.strip()
        if not chunk:
            continue
        fields = (chunk.split('\x1f') + ['', '', '', ''])[:4]
        commit_hash, date, subject, body = fields
        result.append({
            'hash': commit_hash[:8],
            'date': date,
            'subject': subject,
            'ids': ID_RE.findall(subject + ' ' + body),
        })
    return result


def analyse():
    blocks, order = load_blocks()
    for b in blocks.values():
        b['state'], b['file_lines'] = file_state(b['path'])

    # обратный граф зависимостей: кто ждёт этот блок
    rev = defaultdict(set)
    for b in blocks.values():
        for dep in b['deps']:
            if dep in blocks:
                rev[dep].add(b['id'])

    def dependents(start):
        """Все блоки, которые (транзитивно) ждут start."""
        seen, stack = set(), [start]
        while stack:
            current = stack.pop()
            for nxt in rev.get(current, ()):
                if nxt not in seen and nxt != start:
                    seen.add(nxt)
                    stack.append(nxt)
        return seen

    for b in blocks.values():
        b['unblocks'] = len(dependents(b['id']))

    touched = Counter()
    for commit in git_commits():
        for bid in commit['ids']:
            if bid in blocks:
                touched[bid] += 1

    def deps_ready(b):
        return all(blocks[d]['state'] == 'filled'
                   for d in b['deps'] if d in blocks)

    pending = [b for b in blocks.values() if b['state'] in ('empty', 'missing')]
    skipped = [b for b in pending if b['status'] in SKIP_STATUS]
    pending = [b for b in pending if b['status'] not in SKIP_STATUS]
    front = sorted((b for b in pending if deps_ready(b)),
                   key=lambda x: (-x['unblocks'], x['id']))
    blocked = sorted((b for b in pending if not deps_ready(b)),
                     key=lambda x: x['id'])

    by_book = {}
    for book in sorted({b['book'] for b in blocks.values()}):
        bs = [b for b in blocks.values() if b['book'] == book]
        by_book[book] = {
            'title': BOOK_TITLES.get(book, book),
            'total': len(bs),
            'filled': sum(b['state'] == 'filled' for b in bs),
            'empty': sum(b['state'] == 'empty' for b in bs),
            'missing': sum(b['state'] == 'missing' for b in bs),
            'na': sum(b['state'] == 'n/a' for b in bs),
            'lines': sum(b['file_lines'] for b in bs),
        }

    return {
        'blocks': blocks,
        'by_book': by_book,
        'states': Counter(b['state'] for b in blocks.values()),
        'statuses': Counter(b['status'] for b in blocks.values()),
        'lines': sum(b['file_lines'] for b in blocks.values()),
        'front': front,
        'blocked': blocked,
        'skipped': skipped,
        'touched': len(touched),
        'commits': git_commits(),
    }


def render(data, limit):
    blocks = data['blocks']
    states = data['states']
    total = len(blocks)
    filled = states['filled']
    lines = []
    add = lines.append

    add('=' * 72)
    add('СНИМОК ПО РЕЕСТРУ id_2.md')
    add('=' * 72)
    add(f'  Блоков:              {total}')
    add(f'  Файл с содержимым:   {filled}  ({filled * 100 // total}%)')
    add(f'  Файл пуст (0 байт):  {states["empty"]}')
    add(f'  Файла нет:           {states["missing"]}')
    add(f'  Путь не применим:    {states["n/a"]}')
    add(f'  Строк в файлах:      {data["lines"]}')
    add(f'  Коммитов:            {len(data["commits"])}')
    if data['commits']:
        add(f'  Период:              {data["commits"][-1]["date"]} — '
            f'{data["commits"][0]["date"]}')
    add(f'  Блоков в коммитах:   {data["touched"]}')
    add('')
    add('  Статусы в реестре:   ' + ', '.join(
        f'{k}={v}' for k, v in data['statuses'].most_common()))

    add('')
    add('=' * 72)
    add('ГОТОВНОСТЬ ПО КНИГАМ')
    add('=' * 72)
    add(f'  {"книга":6s} {"готово":>7s} {"всего":>6s} {"пусто":>6s} '
        f'{"нет":>5s} {"%":>4s}  название')
    for book, info in data['by_book'].items():
        pct = info['filled'] * 100 // info['total'] if info['total'] else 0
        add(f'  {book:6s} {info["filled"]:7d} {info["total"]:6d} '
            f'{info["empty"]:6d} {info["missing"]:5d} {pct:3d}%  {info["title"]}')

    add('')
    add('=' * 72)
    add(f'ФРОНТ РАБОТ: {len(data["front"])} блоков (зависимости закрыты, '
        f'файл пуст/нет)')
    add('=' * 72)
    add(f'  {"блок":11s} {"вес":>4s} {"состояние":10s} путь')
    for b in data['front'][:limit]:
        add(f'  {b["id"]:11s} {b["unblocks"]:4d} {b["state"]:10s} {b["path"]}')
    if len(data['front']) > limit:
        add(f'  … ещё {len(data["front"]) - limit} (см. --limit)')

    add('')
    add('=' * 72)
    add(f'ЗАБЛОКИРОВАНО ЗАВИСИМОСТЯМИ: {len(data["blocked"])}')
    add('=' * 72)
    top = sorted(data['blocked'], key=lambda x: -x['unblocks'])[:10]
    for b in top:
        add(f'  {b["id"]:11s} {b["unblocks"]:4d} {b["path"]}')
    add('  (показаны 10 с наибольшим весом)')

    if data['skipped']:
        add('')
        add('=' * 72)
        add(f'ВНЕ ПЛАНА (Deprecated/Reserved): {len(data["skipped"])}')
        add('=' * 72)
        for b in data['skipped']:
            add(f'  {b["id"]:11s} {b["status"]:11s} {b["path"]}')
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser(description='Снимок состояния по id_2.md')
    ap.add_argument('--out', help='записать отчёт в файл (UTF-8)')
    ap.add_argument('--json', dest='json_path', help='выгрузить данные в JSON')
    ap.add_argument('--limit', type=int, default=40,
                    help='сколько строк фронта печатать (по умолчанию 40)')
    args = ap.parse_args()

    if not SPEC.exists():
        print(f'ERROR: {SPEC.name} не найден', file=sys.stderr)
        return 1

    data = analyse()
    report = render(data, args.limit)
    print(report)

    if args.out:
        Path(args.out).write_text(report + '\n', encoding='utf-8')
        print(f'\nСохранено: {args.out}')
    if args.json_path:
        payload = {
            'blocks': len(data['blocks']),
            'states': dict(data['states']),
            'statuses': dict(data['statuses']),
            'lines': data['lines'],
            'by_book': data['by_book'],
            'commits': len(data['commits']),
            'touched': data['touched'],
            'front': [{'id': b['id'], 'path': b['path'], 'state': b['state'],
                       'unblocks': b['unblocks'], 'status': b['status']}
                      for b in data['front']],
            'blocked': [{'id': b['id'], 'path': b['path'],
                         'unblocks': b['unblocks']} for b in data['blocked']],
            'skipped': [b['id'] for b in data['skipped']],
        }
        Path(args.json_path).write_text(
            json.dumps(payload, ensure_ascii=False, indent=1), encoding='utf-8')
        print(f'JSON: {args.json_path}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
