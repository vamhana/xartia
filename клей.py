#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Скрипт для склеивания всех файлов из папок k8s/ и docker/ в один Markdown-файл.
Запускать из корня проекта. Результат: клей.md

Обходит папки из SOURCE_DIRS рекурсивно, собирает все файлы (по умолчанию — с
расширениями из TEXT_EXTENSIONS), сортирует по пути для детерминированного порядка.
"""

import os
import sys
from pathlib import Path

# Папки, которые склеиваем (относительно корня проекта).
# Обходятся по порядку, файлы внутри каждой — сортируются.
SOURCE_DIRS = ["k8s", "docker"]

# Расширения, которые считаем текстовыми и включаем в вывод.
# Всё остальное (бинарники, архивы, изображения) — пропускаем.
TEXT_EXTENSIONS = {
    '.py', '.dart', '.sql', '.yaml', '.yml', '.ini', '.pem', '.txt',
    '.md', '.json', '.sh', '.env', '.conf', '.toml', '.xml', '.tf',
    '.tpl', '.tmpl', '.j2', '.properties', '.cfg', '.crt', '.key',
    '.dockerfile', '.gitignore', '.dockerignore',
}

# Специальные имена без расширения, которые тоже включаем
TEXT_FILENAMES = {
    'Dockerfile', 'Makefile', '.env', '.gitignore', '.dockerignore',
    'kustomization', 'Chart', 'LICENSE', 'README',
    # Docker-специфичные имена без расширения
    'Containerfile', 'docker-compose', 'compose',
}

# Папки, которые не обходим (мусор, кэш, git).
SKIP_DIRS = {
    '.git', '.github', '.idea', '.vscode', 'node_modules',
    '__pycache__', '.pytest_cache', '.mypy_cache', 'dist', 'build',
}

# Словарь для определения языка подсветки по расширению
EXTENSION_LANG = {
    '.py': 'python',
    '.dart': 'dart',
    '.sql': 'sql',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.ini': 'ini',
    '.pem': 'text',
    '.txt': 'text',
    '.md': 'markdown',
    '.json': 'json',
    '.sh': 'bash',
    '.env': 'ini',
    '.conf': 'ini',
    '.toml': 'toml',
    '.xml': 'xml',
    '.tf': 'hcl',
    '.tpl': 'yaml',
    '.tmpl': 'yaml',
    '.j2': 'jinja',
    '.properties': 'ini',
    '.cfg': 'ini',
    '.crt': 'text',
    '.key': 'text',
    '.dockerfile': 'dockerfile',
    '.gitignore': 'text',
    '.dockerignore': 'text',
}


def get_lang_for_file(filepath: str) -> str:
    """Возвращает строку языка для блока кода по расширению/имени файла."""
    path = Path(filepath)
    name = path.name
    ext = path.suffix.lower()

    # Специальные имена без расширения (Docker)
    if name == 'Dockerfile' or name.endswith('.dockerfile') or name == 'Containerfile':
        return 'dockerfile'
    if name in ('docker-compose', 'compose'):
        return 'yaml'

    # Прочие специальные имена
    if name == 'Makefile':
        return 'makefile'
    if name in ('kustomization', 'kustomization.yaml', 'kustomization.yml'):
        return 'yaml'
    if name in ('.gitignore', '.dockerignore'):
        return 'text'
    if name == 'Chart.yaml':
        return 'yaml'
    if name.startswith('LICENSE'):
        return 'text'
    if name.startswith('README'):
        return 'markdown'

    return EXTENSION_LANG.get(ext, '')


def is_text_file(filepath: Path) -> bool:
    """
    Определяет, стоит ли включать файл в вывод.
    По расширению (TEXT_EXTENSIONS) или по имени (TEXT_FILENAMES).
    """
    name = filepath.name
    if name in TEXT_FILENAMES:
        return True
    ext = filepath.suffix.lower()
    if ext in TEXT_EXTENSIONS:
        return True
    # Без расширения — проверяем имя
    if not ext:
        return name in TEXT_FILENAMES
    return False


def collect_files(source_dir: Path) -> list[Path]:
    """
    Рекурсивно обходит source_dir, возвращает отсортированный список
    текстовых файлов (относительно source_dir). Пропускает SKIP_DIRS.
    """
    result: list[Path] = []

    for root, dirs, files in os.walk(source_dir):
        # Исключаем мусорные папки на месте (in-place — os.walk учитывает)
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]

        for fname in files:
            full_path = Path(root) / fname
            if is_text_file(full_path):
                result.append(full_path)

    # Детерминированный порядок: по относительному пути
    result.sort(key=lambda p: str(p.relative_to(source_dir)).lower())
    return result


def main():
    # Определяем корневую директорию (где лежит скрипт)
    script_dir = Path(__file__).parent.absolute()
    output_file = script_dir / "клей.md"

    # Проверяем, что все папки существуют
    source_dirs: list[Path] = []
    for name in SOURCE_DIRS:
        d = script_dir / name
        if not d.exists():
            print(f"❌ Папка не найдена: {d}")
            sys.exit(1)
        if not d.is_dir():
            print(f"❌ Не папка: {d}")
            sys.exit(1)
        source_dirs.append(d)

    # Собираем файлы по всем папкам (порядок папок = порядок в SOURCE_DIRS)
    files: list[Path] = []
    for d in source_dirs:
        files.extend(collect_files(d))

    if not files:
        print(f"⚠ В папках {SOURCE_DIRS} не найдено текстовых файлов")
        sys.exit(1)

    print(f"Найдено файлов: {len(files)}")

    succeeded = 0
    failed = 0

    with open(output_file, 'w', encoding='utf-8') as out:
        out.write("# Собранные файлы проекта\n\n")
        out.write(f"Папки: {', '.join(f'`{n}/`' for n in SOURCE_DIRS)}\n\n")

        for i, full_path in enumerate(files, 1):
            rel_path = full_path.relative_to(script_dir).as_posix()
            out.write(f"## {i}. {rel_path}\n\n")

            try:
                with open(full_path, 'r', encoding='utf-8') as f:
                    content = f.read()
            except UnicodeDecodeError:
                out.write("**Пропущено:** не UTF-8 (возможно, бинарник)\n\n")
                failed += 1
                continue
            except Exception as e:
                out.write(f"**Ошибка чтения файла:** {e}\n\n")
                failed += 1
                continue

            lang = get_lang_for_file(rel_path)
            out.write(f"```{lang}\n")
            out.write(content)
            if not content.endswith('\n'):
                out.write('\n')
            out.write("```\n\n")
            succeeded += 1

        out.write("---\n")
        out.write(f"**Итого:** обработано {succeeded} файлов, ошибок: {failed}\n")

    print(f"Готово. Создан файл: {output_file}")
    print(f"Успешно: {succeeded}, ошибок: {failed}")


if __name__ == "__main__":
    main()