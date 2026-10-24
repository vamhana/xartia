#!/usr/bin/env python3
"""id_navigator_2.py — навигатор по реестру id_2.md.

Корень проекта = папка, в которой лежит этот скрипт.
Все файлы проекта создаются/читаются относительно этого корня.

Колонка URI (L.4.00/M.4.01/...) — логический адрес в реестре,
НЕ путь на диске. Реальный путь файла строится из колонок
"имя модуля" и "тип" (см. resolve_path).
"""
from __future__ import annotations
# ============================================================
#  Самоповышение прав до администратора (UAC)
# ============================================================
def _ensure_admin() -> None:
    """Если запущены без прав администратора — перезапускает процесс
    с UAC-запросом и завершает текущий. Работает только на Windows."""
    import sys
    if sys.platform != "win32":
        return
    try:
        import ctypes
        if ctypes.windll.shell32.IsUserAnAdmin():
            return  # уже админ — работаем как есть

        import os
        import subprocess

        # Для .py: перезапускаем python.exe со скриптом в аргументах.
        # Для собранного exe (PyInstaller и т.п.): sys.frozen=True — просто exe.
        if getattr(sys, "frozen", False):
            exe = sys.executable
            params = subprocess.list2cmdline(sys.argv[1:])
        else:
            exe = sys.executable
            params = subprocess.list2cmdline([os.path.abspath(__file__)] + sys.argv[1:])

        cwd = os.getcwd()
        # 1 = SW_SHOWNORMAL, 5 = SW_SHOW (для консольного python тоже работает)
        ret = ctypes.windll.shell32.ShellExecuteW(
            None, "runas", exe, params, cwd, 1
        )
        # ShellExecuteW возвращает >32 при успехе, <=32 — ошибка
        if int(ret) <= 32:
            # Пользователь отказал в UAC или что-то другое — выходим тихо.
            sys.exit(1)
        # Успешно запустили админский экземпляр — выходим из текущего.
        sys.exit(0)
    except Exception:
        # Не смогли повыситься — просто продолжаем как есть,
        # чтобы не убить программу на ровном месте.
        return


_ensure_admin()
# ============================================================

import html
import difflib
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import datetime

from PyQt6.QtCore import (Qt, QTimer, QMetaObject, Q_ARG, Q_RETURN_ARG,
                          pyqtSlot, pyqtSignal)
from PyQt6.QtWidgets import (QApplication, QCheckBox, QWidget, QListWidget,
                             QListWidgetItem, QHBoxLayout, QVBoxLayout,
                             QPushButton, QLineEdit, QPlainTextEdit,
                             QMessageBox, QInputDialog, QDialog, QLabel,
                             QDialogButtonBox, QAbstractItemView)

# ============================================================
#  КОРЕНЬ ПРОЕКТА И ГЛОБАЛЬНЫЕ ПУТИ
# ============================================================
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
ID_FILE      = os.path.join(PROJECT_ROOT, "id_2.md")
HISTORY_DIR  = os.path.join(PROJECT_ROOT, "ИСТОРИЯ")
TEMP_DIR     = os.path.join(PROJECT_ROOT, "temp")

NOTEPAD_PATHS = [
    r"C:\Program Files\Notepad++\notepad++.exe",
    r"C:\Program Files (x86)\Notepad++\notepad++.exe",
]
USE_WHERE = True
COLUMN_WIDTH = 80
# Папки, которые не обходим при поиске в закрытых файлах
SEARCH_SKIP_DIRS = {
    '.git', '.hg', '.svn', '.idea', '.vscode',
    '__pycache__', 'node_modules',
    'venv', '.venv', 'env', '.tox',
    '.mypy_cache', '.pytest_cache',
    'build', 'dist', 'target', 'out', 'bin', 'obj',
    'ИСТОРИЯ', 'temp',
}

# Расширения, которые считаем бинарными и пропускаем
SEARCH_SKIP_EXTS = {
    '.pyc', '.pyo', '.pyd', '.exe', '.dll', '.so', '.dylib',
    '.a', '.o', '.obj', '.lib', '.class', '.jar', '.war',
    '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.mp3', '.mp4', '.avi', '.mov', '.mkv', '.wav', '.flac',
    '.db', '.sqlite', '.sqlite3', '.bin', '.whl', '.egg',
}

SEARCH_MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 МБ — разумный потолок

try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False


# ============================================================
#  INFRA-маппинг и резолвер пути
# ============================================================
INFRA_MAP = {
    "infra.requirements":     "requirements.txt",
    "infra.pyproject":        "pyproject.toml",
    "infra.lock":             "requirements.lock",
    "infra.dockerfile":       "Dockerfile",
    "infra.docker_compose":   "docker-compose.yml",
    "infra.makefile":         "Makefile",
    "infra.alembic_env":      "alembic/env.py",
    "infra.alembic_rev_0001": "alembic/versions/0001_initial.py",
    "infra.alembic_rev_0002": "alembic/versions/0002_next.py",
}


def resolve_path(rec: dict) -> str | None:
    name = rec.get('name', '')
    typ  = rec.get('type', '')
    uri  = (rec.get('uri') or '').strip()

    if typ == 'INFRA':
        return INFRA_MAP.get(name)
    if typ in ('WRAP', 'GROUP'):
        return None

    # в вашем формате реальный путь уже в колонке URI
    if uri and ('/' in uri or uri.endswith(('.py', '.md', '.json', '.txt',
                                             '.toml', '.yml', '.yaml', '.lock'))):
        return uri.rstrip('/')

    # fallback для dotted-имени
    path = name.replace('.', '/')
    if typ == 'PKG':
        return path + '/__init__.py'
    if typ == 'DOC':
        return path + '.md'
    if typ == 'SEED':
        return path + '.json'
    return path + '.py'

# ============================================================
#  Поиск Notepad++
# ============================================================
def find_notepad():
    for path in NOTEPAD_PATHS:
        if os.path.isfile(path):
            return path
    if USE_WHERE:
        try:
            result = subprocess.run(["where", "notepad++"],
                                    capture_output=True, text=True, shell=True)
            if result.returncode == 0:
                path = result.stdout.strip().splitlines()[0]
                if os.path.isfile(path):
                    return path
        except Exception:
            pass
    return None


NOTEPAD_EXE = find_notepad()


def open_in_notepad_general(filepath, line_num=None):
    if NOTEPAD_EXE is None:
        print("Ошибка: Notepad++ не найден.")
        return
    try:
        cmd = [NOTEPAD_EXE]
        if line_num is not None:
            cmd.append(f"-n{line_num}")
        cmd.append(filepath)
        subprocess.Popen(cmd)
    except Exception as e:
        print(f"Не удалось открыть Notepad++: {e}")


# ============================================================
#  Парсинг id_2.md
# ============================================================
def parse_id_file_full(filepath):
    if not os.path.isfile(filepath):
        raise FileNotFoundError(f"Файл не найден: {filepath}")
    records = []
    with open(filepath, 'r', encoding='utf-8-sig') as f:
        for line_num, line in enumerate(f, start=1):
            s = line.strip()
            if not s or not s.startswith('|'):
                continue
            # пропускаем строки секций вида "|Описание: ..."
            if s.startswith(('|Описание', '|Публичный', '|↙', '|↘', '|Реализация', '|Примечания')):
                continue
            parts = [p.strip() for p in s.split('|')]
            while parts and parts[0] == '':
                parts.pop(0)
            while parts and parts[-1] == '':
                parts.pop()
            if len(parts) < 5:
                continue
            rec = {
                'id':       parts[0],
                'domain':   parts[1] if len(parts) > 1 else '',
                'name':     parts[2] if len(parts) > 2 else '',
                'type':     parts[3] if len(parts) > 3 else '',
                'uri':      parts[4] if len(parts) > 4 else '',
                'deps':     parts[5] if len(parts) > 5 else '',
                'version':  parts[6] if len(parts) > 6 else '',
                'status':   parts[7] if len(parts) > 7 else '',
                'desc':     parts[8] if len(parts) > 8 else '',
                'line_num': line_num,      # ← ОБЯЗАТЕЛЬНО
            }
            rec['relpath'] = resolve_path(rec)
            rec['abspath'] = (os.path.normpath(os.path.join(PROJECT_ROOT, rec['relpath']))
                              if rec['relpath'] else None)
            records.append(rec)
    return records


def find_line_by_id(filepath, target_id):
    pattern = re.compile(r'^\|\s*(' + re.escape(target_id) + r')\s*\|')
    with open(filepath, 'r', encoding='utf-8-sig') as f:
        for line_num, line in enumerate(f, start=1):
            if pattern.match(line):
                return line_num
    return None


# Регулярка "начало блока модуля": строка вида |ID|Name...|
# ID может содержать 1..4 заглавных буквы (M, SC, IF, ...).
MODULE_START_PATTERN = re.compile(r'^\s*\|\s*([A-Z]{1,4}\.[0-9]+\.[0-9]+(?:\.[0-9]+)*)\s*\|\s*[A-Za-z]')


# ============================================================
#  Вспомогательные функции сборки
# ============================================================
def assemble_files_content(records, selected_indices, output_path, log_callback):
    selected_recs = [records[i] for i in selected_indices]
    report_lines = []
    file_contents = []
    for rec in selected_recs:
        rel_path = rec['relpath'] or rec['name']
        full_path = rec['abspath']
        file_info = f"--- {rec['id']} : {rel_path} ---"
        file_contents.append(file_info)
        file_contents.append("")
        if full_path is None:
            file_contents.append(f"[ФАЙЛ НЕ СОЗДАЁТСЯ ДЛЯ ТИПА {rec['type']}]")
            report_lines.append(f"  {rec['id']} – {rel_path} – пропущен (тип {rec['type']})")
        elif os.path.isfile(full_path):
            try:
                with open(full_path, 'r', encoding='utf-8-sig') as src:
                    content = src.read()
                file_contents.append(content)
                file_size = os.path.getsize(full_path)
                report_lines.append(f"  {rec['id']} – {rel_path} ({file_size} байт) – OK")
            except Exception as e:
                file_contents.append(f"[ОШИБКА ЧТЕНИЯ: {e}]")
                report_lines.append(f"  {rec['id']} – {rel_path} – ОШИБКА: {e}")
        else:
            file_contents.append(f"[ФАЙЛ НЕ НАЙДЕН: {full_path}]")
            report_lines.append(f"  {rec['id']} – {rel_path} – ФАЙЛ НЕ НАЙДЕН")
        file_contents.append("\n" + "=" * 50 + "\n")
    with open(output_path, 'w', encoding='utf-8-sig') as f:
        f.write("Склейка содержимого файлов (клей_файл.md)\n")
        f.write("=" * 50 + "\n\n")
        f.write("\n".join(file_contents))
        f.write("\n" + "=" * 50 + "\n")
        f.write("Отчёт о файлах:\n")
        f.write(f"  Всего выбрано ID: {len(selected_recs)}\n")
        f.write("\n".join(report_lines))
    log_callback(f"Файл создан: {output_path}\nВыбрано ID: {len(selected_recs)}")


def assemble_id_blocks(records, selected_ids, blocks_by_id, output_path, log_callback):
    selected_recs = [rec for rec in records if rec['id'] in selected_ids]
    selected_recs.sort(key=lambda r: r['line_num'])
    blocks_text = []
    for rec in selected_recs:
        block = blocks_by_id.get(rec['id'], f"Блок для ID {rec['id']} не найден.")
        blocks_text.append(block)
    full_text = '\n\n'.join(blocks_text)
    with open(output_path, 'w', encoding='utf-8-sig') as f:
        f.write("Склейка блоков ID (клей_id.md)\n")
        f.write("=" * 50 + "\n\n")
        f.write(full_text)
        f.write("\n\n" + "=" * 50 + "\n")
        f.write("Отчёт:\n")
        f.write(f"  Всего выбрано ID: {len(selected_recs)}\n")
        f.write("  Перечень:\n")
        for rec in selected_recs:
            f.write(f"    - {rec['id']}\n")
    log_callback(f"Файл создан: {output_path}\nВыбрано ID: {len(selected_recs)}")

class BlockSearchEdit(QPlainTextEdit):
    """Многострочное поле поиска. Ctrl+Enter — поиск.
    Enter — поиск, если в поле ровно одна строка."""

    searchRequested = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setPlaceholderText(
            "Вставьте блок (можно многострочный) и нажмите Ctrl+Enter..."
        )
        self.setMaximumHeight(90)
        self.setTabChangesFocus(True)
        self.setLineWrapMode(QPlainTextEdit.LineWrapMode.NoWrap)

    def keyPressEvent(self, event):
        if event.key() in (Qt.Key.Key_Return, Qt.Key.Key_Enter):
            if event.modifiers() & Qt.KeyboardModifier.ControlModifier:
                self.searchRequested.emit()
                return
            if self.document().blockCount() == 1:
                self.searchRequested.emit()
                return
        super().keyPressEvent(event)
# ============================================================
#  Диалог выбора снимка
# ============================================================
class SnapshotDialog(QDialog):
    def __init__(self, snapshots, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Выберите снимок для отката")
        self.resize(500, 400)
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel("Список сохранённых снимков:"))
        self.listbox = QListWidget()
        self.listbox.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        for snap in snapshots:
            self.listbox.addItem(snap)
        layout.addWidget(self.listbox)
        self.comment_label = QLabel("")
        self.comment_label.setWordWrap(True)
        self.comment_label.setStyleSheet("background-color: #ffffe0; padding: 5px;")
        layout.addWidget(self.comment_label)
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok |
                                   QDialogButtonBox.StandardButton.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)
        self.listbox.itemSelectionChanged.connect(self.show_comment)
        self.snapshots = snapshots

    def show_comment(self):
        current = self.listbox.currentItem()
        if current:
            snap_name = current.text()
            comment_path = os.path.join(HISTORY_DIR, snap_name, "comment.txt")
            if os.path.isfile(comment_path):
                with open(comment_path, "r", encoding="utf-8-sig") as f:
                    comment = f.read().strip()
                self.comment_label.setText(f"Комментарий: {comment}")
            else:
                self.comment_label.setText("")

    def get_selected(self):
        return self.listbox.currentItem().text() if self.listbox.currentItem() else None


# ============================================================
#  Главное окно
# ============================================================
class MainWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("ID модулей")
        self.setGeometry(100, 100, 700, 750)
        self.setWindowFlags(self.windowFlags() | Qt.WindowType.WindowStaysOnTopHint)

        self.log_queue = queue.Queue()
        self.timer = QTimer()
        self.timer.timeout.connect(self.process_log_queue)
        self.timer.start(100)

        try:
            self.records = parse_id_file_full(ID_FILE)
        except Exception as e:
            self.log(f"Ошибка при чтении файла: {e}")
            sys.exit(1)

        if not self.records:
            self.log("В файле не найдено ни одного ID.")
            sys.exit(1)

        self.temp_dir = TEMP_DIR

        with open(ID_FILE, 'r', encoding='utf-8-sig') as f:
            self.lines = f.readlines()
        self.blocks_by_id = self._build_blocks_corrected()

        # Хартия
        self.charter_articles = {}
        self.load_charter()

        self.all_ids = {rec['id'] for rec in self.records}

        # ---- Диагностика в консоль ----
        self.log(f"PROJECT_ROOT = {PROJECT_ROOT}")
        self.log(f"ID_FILE      = {ID_FILE}")
        self.log(f"Записей в реестре: {len(self.records)}")

        main_layout = QVBoxLayout()
        main_layout.setContentsMargins(2, 2, 2, 2)

        columns_layout = QHBoxLayout()
        columns_layout.setSpacing(1)

        # Левая колонка
        left_layout = QVBoxLayout()
        self.left_list = QListWidget()
        self.left_list.setFixedWidth(COLUMN_WIDTH)
        self.left_list.setStyleSheet("background-color: white;")
        self.populate_list_with_checkboxes(self.left_list, self.on_double_left)
        left_layout.addWidget(self.left_list)
        left_widget = QWidget()
        left_widget.setLayout(left_layout)
        columns_layout.addWidget(left_widget)

        # Средняя колонка
        mid_layout = QVBoxLayout()
        self.mid_list = QListWidget()
        self.mid_list.setFixedWidth(COLUMN_WIDTH)
        self.mid_list.setStyleSheet("background-color: #e0e0e0;")
        self.populate_list_with_checkboxes(self.mid_list, self.on_double_mid)
        mid_layout.addWidget(self.mid_list)
        mid_widget = QWidget()
        mid_widget.setLayout(mid_layout)
        columns_layout.addWidget(mid_widget)

        # Третья колонка
        new_layout = QVBoxLayout()
        self.new_list = QListWidget()
        self.new_list.setFixedWidth(COLUMN_WIDTH)
        self.new_list.setStyleSheet("background-color: #f0f0f0;")
        self.populate_list_with_checkboxes(self.new_list, self.on_double_new)
        new_layout.addWidget(self.new_list)
        new_widget = QWidget()
        new_widget.setLayout(new_layout)
        columns_layout.addWidget(new_widget)

        # Колонка "Модули"
        module_layout = QVBoxLayout()
        self.module_list = QListWidget()
        self.module_list.setFixedWidth(COLUMN_WIDTH)
        self.module_list.setStyleSheet("background-color: #d0f0d0;")
        self.populate_module_list()
        self.module_list.itemDoubleClicked.connect(self.on_double_module)
        module_layout.addWidget(self.module_list)
        module_widget = QWidget()
        module_widget.setLayout(module_layout)
        columns_layout.addWidget(module_widget)

        # Правая колонка — пути
        # Правая колонка — пути + блоковый поиск
        right_layout = QVBoxLayout()
        right_layout.setSpacing(2)

        # --- Верхняя часть: поиск по путям ---
        top_widget = QWidget()
        top_layout = QVBoxLayout(top_widget)
        top_layout.setContentsMargins(0, 0, 0, 0)
        top_layout.setSpacing(2)

        self.search_edit = QLineEdit()
        self.search_edit.setPlaceholderText("Поиск по пути...")
        self.search_edit.textChanged.connect(self.filter_paths)
        top_layout.addWidget(self.search_edit)

        self.right_list = QListWidget()
        self.right_list.setStyleSheet("background-color: white;")
        self.all_paths = sorted(set(rec['relpath'] for rec in self.records if rec['relpath']))
        self.populate_paths(self.all_paths)
        self.right_list.itemDoubleClicked.connect(self.on_double_right)
        top_layout.addWidget(self.right_list)

        right_layout.addWidget(top_widget, stretch=1)

        # --- Нижняя часть: поиск блока в открытых файлах Notepad++ ---
        bottom_widget = QWidget()
        bottom_layout = QVBoxLayout(bottom_widget)
        bottom_layout.setContentsMargins(0, 0, 0, 0)
        bottom_layout.setSpacing(2)

        self.block_search_edit = BlockSearchEdit()
        self.block_search_edit.searchRequested.connect(self.search_block_in_open_files)
        bottom_layout.addWidget(self.block_search_edit)

        self.block_results_list = QListWidget()
        self.block_results_list.setStyleSheet("background-color: #fff8e0;")
        self.block_results_list.itemDoubleClicked.connect(self.on_double_block_result)
        bottom_layout.addWidget(self.block_results_list)

        right_layout.addWidget(bottom_widget, stretch=1)

        right_widget = QWidget()
        right_widget.setLayout(right_layout)
        columns_layout.addWidget(right_widget, stretch=1)

        main_layout.addLayout(columns_layout, stretch=3)

        # ---- Ряд кнопок под колонками ----
        button_row = QHBoxLayout()
        button_row.setSpacing(5)

        self.copy_button = QPushButton("ШАПКИ")
        self.copy_button.clicked.connect(self.assemble_blocks_to_file)
        self.copy_button.setToolTip("Собрать блоки выбранных ID в файл клей_id.md")
        button_row.addWidget(self.copy_button)

        self.assemble_button = QPushButton("ФАЙЛЫ")
        self.assemble_button.clicked.connect(self.assemble_files)
        self.assemble_button.setToolTip("Собрать содержимое файлов выбранных ID в файл клей_файл.md")
        button_row.addWidget(self.assemble_button)

        self.btn_placeholder = QPushButton("")
        self.btn_placeholder.setEnabled(False)
        button_row.addWidget(self.btn_placeholder)

        self.btn_insert_id = QPushButton("Вставить")
        self.btn_insert_id.clicked.connect(self.insert_id_into_files)
        self.btn_insert_id.setToolTip("Вставить ID-строку в начало каждого файла (удалив старые комментарии)")
        button_row.addWidget(self.btn_insert_id)

        self.btn_merge = QPushButton("Создать")
        self.btn_merge.clicked.connect(self.merge_to_id_4)
        self.btn_merge.setToolTip("Создать id_4.md на основе id_2.md и подготовленного id_3.md")
        button_row.addWidget(self.btn_merge)

        for btn in (self.copy_button, self.assemble_button, self.btn_placeholder,
                    self.btn_insert_id, self.btn_merge):
            btn.setMinimumWidth(80)

        button_row.addStretch()
        main_layout.addLayout(button_row)

        # ---- Нижняя панель кнопок ----
        button_panel = QHBoxLayout()

        self.btn_save = QPushButton("Сохранить")
        self.btn_save.clicked.connect(self.save_snapshot)
        button_panel.addWidget(self.btn_save)

        self.btn_rollback = QPushButton("Откатить")
        self.btn_rollback.clicked.connect(self.rollback_snapshot)
        button_panel.addWidget(self.btn_rollback)

        self.btn_select_all = QPushButton("Выбор")
        self.btn_select_all.clicked.connect(self.select_all_checkboxes)
        button_panel.addWidget(self.btn_select_all)

        self.btn_reset = QPushButton("Сброс")
        self.btn_reset.clicked.connect(self.reset_all_checkboxes)
        button_panel.addWidget(self.btn_reset)

        self.btn_create = QPushButton("Создать")
        self.btn_create.clicked.connect(self.create_empty_files)
        button_panel.addWidget(self.btn_create)

        self.btn_refresh = QPushButton("Обновить")
        self.btn_refresh.clicked.connect(self.refresh_lists)
        button_panel.addWidget(self.btn_refresh)

        self.btn_replace = QPushButton("Заменить")
        self.btn_replace.clicked.connect(self.replace_id_file)
        self.btn_replace.setToolTip("Заменить id_2.md на id_4.md (с подсчётом строк)")
        button_panel.addWidget(self.btn_replace)

        self.cb_blocks = QCheckBox()
        self.cb_blocks.setToolTip("Вставлять блоки (шапки) зависимостей")
        self.cb_files = QCheckBox()
        self.cb_files.setToolTip("Вставлять содержимое файлов зависимостей")
        self.cb_full_list = QCheckBox()
        self.cb_full_list.setToolTip("В конце добавить полный список всех ID")
        self.cb_charter = QCheckBox("Хартия")
        self.cb_charter.setToolTip("Добавить статьи Хартии, упомянутые в модулях")
        button_panel.addWidget(self.cb_blocks)
        button_panel.addWidget(self.cb_files)
        button_panel.addWidget(self.cb_full_list)
        button_panel.addWidget(self.cb_charter)
        self.cb_full_list.stateChanged.connect(self.toggle_section_checkboxes)
        button_panel.addStretch()
        main_layout.addLayout(button_panel)

        # ---- Секционные чекбоксы ----
        section_panel = QHBoxLayout()
        self.cb_desc = QCheckBox("Описание")
        self.cb_desc.setToolTip("Включать секцию |Описание:")
        self.cb_desc.setEnabled(False)
        self.cb_api = QCheckBox("Публичный API")
        self.cb_api.setToolTip("Включать секцию |Публичный API:")
        self.cb_api.setEnabled(False)
        self.cb_consumes = QCheckBox("Потребляет")
        self.cb_consumes.setToolTip("Включать секцию |↙ ПОТРЕБЛЯЕТ:")
        self.cb_consumes.setEnabled(False)
        self.cb_provides = QCheckBox("Предоставляет")
        self.cb_provides.setToolTip("Включать секцию |↘ ПРЕДОСТАВЛЯЕТ:")
        self.cb_provides.setEnabled(False)
        self.cb_impl = QCheckBox("Реализация")
        self.cb_impl.setToolTip("Включать секцию |Реализация:")
        self.cb_impl.setEnabled(False)
        self.cb_notes = QCheckBox("Примечания")
        self.cb_notes.setToolTip("Включать секцию |Примечания:")
        self.cb_notes.setEnabled(False)
        section_panel.addWidget(self.cb_desc)
        section_panel.addWidget(self.cb_api)
        section_panel.addWidget(self.cb_consumes)
        section_panel.addWidget(self.cb_provides)
        section_panel.addWidget(self.cb_impl)
        section_panel.addWidget(self.cb_notes)
        section_panel.addStretch()
        main_layout.addLayout(section_panel)

        # ---- Консоль ----
        self.console = QPlainTextEdit()
        self.console.setReadOnly(True)
        self.console.setMaximumHeight(150)
        self.console.setStyleSheet(
            "background-color: #1e1e1e; color: #d4d4d4; "
            "font-family: Consolas; font-size: 9pt;"
        )
        self.console.setLineWrapMode(QPlainTextEdit.LineWrapMode.NoWrap)
        main_layout.addWidget(self.console, stretch=1)

        self.setLayout(main_layout)
        self.operation_thread = None
        self.stop_event = threading.Event()

    # ------------------------------------------------------------
    #  Загрузка Хартии
    # ------------------------------------------------------------
    def load_charter(self):
        charter_path = os.path.join(PROJECT_ROOT, "xartia.md")
        if not os.path.isfile(charter_path):
            self.log("Файл xartia.md не найден. Статьи Хартии недоступны.")
            self.charter_articles = {}
            return
        try:
            with open(charter_path, 'r', encoding='utf-8-sig') as f:
                content = f.read()
        except Exception as e:
            self.log(f"Ошибка чтения xartia.md: {e}")
            self.charter_articles = {}
            return

        book_pattern = re.compile(r'(КНИГА\s+([IVX]+)\s*\.)', re.IGNORECASE)
        books = {}
        last_end = 0
        last_book = None
        for match in book_pattern.finditer(content):
            book_num = match.group(2)
            start = match.start()
            if last_end > 0 and last_book is not None:
                books[last_book] = content[last_end:start]
            last_end = start
            last_book = book_num
        if last_book is not None:
            books[last_book] = content[last_end:]

        articles = {}
        for book_num, book_content in books.items():
            article_pattern = re.compile(r'(Статья\s+(\d+(?:\.\d+)+)\s*\.)', re.IGNORECASE)
            positions = []
            for match in article_pattern.finditer(book_content):
                positions.append((match.start(), match.group(2)))
            positions.sort(key=lambda x: x[0])
            for i, (start, number) in enumerate(positions):
                end = len(book_content)
                if i + 1 < len(positions):
                    end = positions[i + 1][0]
                article_text = book_content[start:end].strip()
                key = f"{book_num}.{number}"
                articles[key] = article_text

        self.charter_articles = articles
        self.log(f"Загружено статей Хартии: {len(articles)}")

    # ------------------------------------------------------------
    #  Извлечение ссылок на статьи Хартии
    # ------------------------------------------------------------
    def extract_charter_references(self, text: str) -> set:
        refs = set()
        if not text:
            return refs
        range_pattern = re.compile(r'([IVX]+)\.(\d+)\.(\d+)\s*[–-]\s*\1\.\2\.(\d+)')
        for match in range_pattern.finditer(text):
            book = match.group(1)
            part = match.group(2)
            start = int(match.group(3))
            end = int(match.group(4))
            for num in range(start, end + 1):
                refs.add(f"{book}.{part}.{num}")
        single_pattern = re.compile(r'([IVX]+)\.(\d+)\.(\d+)')
        for match in single_pattern.finditer(text):
            refs.add(f"{match.group(1)}.{match.group(2)}.{match.group(3)}")
        return refs

    def extract_charter_references_from_first_line(self, block: str) -> set:
        if not block:
            return set()
        lines = block.splitlines()
        if not lines:
            return set()
        first_line = lines[0].strip()
        if not first_line.startswith('|'):
            return set()
        parts = first_line.split('|')
        if len(parts) < 2:
            return set()
        last_col = parts[-2].strip() if len(parts) >= 2 else ''
        return self.extract_charter_references(last_col)

    # ------------------------------------------------------------
    #  Извлечение зависимостей
    # ------------------------------------------------------------
    def extract_dependencies_from_block(self, block: str, current_id: str | None = None) -> list:
        if not block:
            return []
        lines = block.splitlines()
        if not lines:
            return []

        first_line = lines[0]
        if first_line.startswith('|'):
            parts = first_line.split('|')
            if len(parts) >= 3:
                parts = parts[:-2]
                first_line = '|'.join(parts)

        modified_block = '\n'.join([first_line] + lines[1:])

        deps = set()
        id_pattern = re.compile(r'[A-Z]\s*\.\s*[\d.]+')
        for line in modified_block.splitlines():
            deps.update(id_pattern.findall(line))

        if current_id:
            deps.discard(current_id)

        clean_deps = set()
        for dep in deps:
            clean = re.sub(r'\s+', '', dep)
            if clean.endswith('.'):
                clean = clean[:-1]
            clean_deps.add(clean)

        valid_deps = [d for d in clean_deps if d in self.all_ids]
        return sorted(valid_deps)

    # ------------------------------------------------------------
    #  Заполнение списков
    # ------------------------------------------------------------
    def populate_module_list(self):
        self.module_list.clear()
        prefixes = set()
        for rec in self.records:
            parts = rec['id'].split('.')
            if len(parts) >= 2:
                prefixes.add(f"{parts[0]}.{parts[1]}")

        def prefix_sort_key(p):
            letter, num = p.split('.')
            return (letter, int(num))

        for pref in sorted(prefixes, key=prefix_sort_key):
            item = QListWidgetItem(pref)
            item.setFlags(item.flags() | Qt.ItemFlag.ItemIsUserCheckable)
            item.setCheckState(Qt.CheckState.Unchecked)
            item.setData(Qt.ItemDataRole.UserRole, pref)
            self.module_list.addItem(item)

    def on_double_module(self, item):
        prefix = item.data(Qt.ItemDataRole.UserRole)
        include_deps = (item.checkState() == Qt.CheckState.Checked)

        group_ids = [rec['id'] for rec in self.records
                     if rec['id'].startswith(prefix + '.')]

        all_ids = set(group_ids)
        dep_ids = set()
        if include_deps:
            for gid in group_ids:
                block = self.blocks_by_id.get(gid, "")
                if block:
                    deps = self.extract_dependencies_from_block(block, current_id=gid)
                    dep_ids.update(deps)
            all_ids.update(dep_ids)

        group_ids_sorted = sorted(group_ids, key=self._id_sort_key)
        dep_ids_sorted = sorted(dep_ids, key=self._id_sort_key) if include_deps else []
        ordered_ids = list(dict.fromkeys(group_ids_sorted + dep_ids_sorted))

        blocks = []
        for uid in ordered_ids:
            block = self.blocks_by_id.get(uid, "")
            if block:
                blocks.append(block)

        if not blocks:
            self.log("Нет блоков для записи.")
            return

        show_full_list = self.cb_full_list.isChecked()
        show_charter = self.cb_charter.isChecked()

        if show_full_list or show_charter:
            msg_parts = []
            if show_full_list:
                msg_parts.append("• «в конце добавить полный список всех ID»")
            if show_charter:
                msg_parts.append("• «Хартия»")
            msg = ("Включены следующие опции:\n" + "\n".join(msg_parts) +
                   "\n\nДобавить соответствующие разделы в конец файла id_3.md?")
            reply = QMessageBox.question(self, "Добавление разделов", msg,
                                         QMessageBox.StandardButton.Yes |
                                         QMessageBox.StandardButton.No)
            if reply != QMessageBox.StandardButton.Yes:
                show_full_list = False
                show_charter = False

        section_map = {
            '|Описание': self.cb_desc.isChecked(),
            '|Публичный API': self.cb_api.isChecked(),
            '|↙ ПОТРЕБЛЯЕТ': self.cb_consumes.isChecked(),
            '|↘ ПРЕДОСТАВЛЯЕТ': self.cb_provides.isChecked(),
            '|Реализация': self.cb_impl.isChecked(),
            '|Примечания': self.cb_notes.isChecked(),
        }

        output_path = os.path.join(PROJECT_ROOT, "id_3.md")
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write("\n\n".join(blocks))

                if show_full_list:
                    f.write("\n\n" + "=" * 60 + "\n")
                    f.write("ПОЛНЫЙ СПИСОК ВСЕХ ID (ШАПКИ МОДУЛЕЙ):\n")
                    f.write("=" * 60 + "\n\n")
                    for rec in self.records:
                        header_line = self.lines[rec['line_num'] - 1].rstrip('\n')
                        header_line = re.sub(r'\s*\|\s*', '|', header_line)
                        f.write(header_line + "\n")
                        block = self.blocks_by_id.get(rec['id'], "")
                        for header, checked in section_map.items():
                            if checked and block:
                                section_text = self.get_section_text(block, header)
                                if section_text:
                                    f.write(header + "\n")
                                    f.write(section_text)
                                    f.write("\n")

                if show_charter:
                    charter_ids = all_ids if include_deps else set(group_ids)
                    charter_refs = set()
                    for uid in charter_ids:
                        block = self.blocks_by_id.get(uid, "")
                        if block:
                            refs = self.extract_charter_references_from_first_line(block)
                            charter_refs.update(refs)

                    if charter_refs:
                        f.write("\n\n" + "=" * 60 + "\n")
                        f.write("СТАТЬИ ХАРТИИ (упоминаемые в модулях):\n")
                        f.write("=" * 60 + "\n\n")
                        roman_map = {'I': 1, 'II': 2, 'III': 3, 'IV': 4,
                                     'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8}

                        def sort_key(ref):
                            parts = ref.split('.')
                            return (roman_map.get(parts[0], 0),
                                    int(parts[1]), int(parts[2]))

                        for ref in sorted(charter_refs, key=sort_key):
                            article_text = self.charter_articles.get(
                                ref, f"[Статья {ref} не найдена в Хартии]")
                            f.write(f"--- Статья {ref} ---\n\n")
                            f.write(article_text)
                            f.write("\n\n")
                    else:
                        f.write("\n\n" + "=" * 60 + "\n")
                        f.write("СТАТЬИ ХАРТИИ: не найдено ссылок.\n")

            self.log(f"Создан id_3.md. Модулей в группе: {len(group_ids)}, "
                     f"зависимостей: {len(all_ids) - len(group_ids)}, итого: {len(all_ids)}")
            open_in_notepad_general(output_path)
        except Exception as e:
            self.log(f"Ошибка при записи id_3.md: {e}")

    def find_reverse_dependencies(self, target_id):
        reverse = []
        for rec in self.records:
            if rec['id'] == target_id:
                continue
            block = self.blocks_by_id.get(rec['id'], "")
            if block:
                deps = self.extract_dependencies_from_block(block, current_id=None)
                if target_id in deps:
                    reverse.append(rec['id'])
        return sorted(reverse)

    def _write_dependency(self, out, dep_id, show_blocks, show_files):
        dep_rec = next((r for r in self.records if r['id'] == dep_id), None)
        if not dep_rec:
            out.write(f"[Модуль {dep_id} не найден в id_2.md]\n\n---\n\n")
            return
        if show_blocks:
            dep_block = self.blocks_by_id.get(dep_id, f"[Блок для {dep_id} не найден]")
            out.write(f"--- Блок зависимости: {dep_id} ---\n\n")
            out.write(dep_block)
            out.write("\n\n")
        if show_files:
            dep_path = dep_rec['relpath'] or dep_rec['name']
            dep_full_path = dep_rec['abspath']
            out.write(f"--- Содержимое файла зависимости: {dep_id} ({dep_path}) ---\n\n")
            if dep_full_path is None:
                out.write(f"[ФАЙЛ НЕ СОЗДАЁТСЯ ДЛЯ ТИПА {dep_rec['type']}]")
            elif os.path.isfile(dep_full_path):
                try:
                    with open(dep_full_path, 'r', encoding='utf-8-sig') as f:
                        out.write(f.read())
                except Exception as e:
                    out.write(f"[ОШИБКА ЧТЕНИЯ: {e}]")
            else:
                out.write(f"[ФАЙЛ НЕ НАЙДЕН: {dep_full_path}]")
            out.write("\n\n")
        out.write("---\n\n")

    def _id_sort_key(self, id_str):
        parts = id_str.split('.')
        letter = parts[0] if parts else ''
        nums = tuple(int(p) if p.isdigit() else 0 for p in parts[1:])
        return (letter, nums)

    def sort_and_save_id_file(self):
        try:
            with open(ID_FILE, 'r', encoding='utf-8-sig') as f:
                lines = f.readlines()
        except Exception as e:
            self.log(f"Ошибка чтения файла для сортировки: {e}")
            return

        id_lines = []
        for idx, line in enumerate(lines):
            if MODULE_START_PATTERN.match(line.strip()):
                parts = line.strip().split('|')
                if len(parts) >= 2:
                    id_val = parts[1].strip()
                    id_lines.append((idx, id_val))

        if not id_lines:
            self.log("В файле не найдено ни одного ID для сортировки.")
            return

        blocks = []
        for i, (start_idx, id_val) in enumerate(id_lines):
            end_idx = len(lines) - 1
            if i + 1 < len(id_lines):
                end_idx = id_lines[i + 1][0] - 1
            block_text = ''.join(lines[start_idx:end_idx + 1]).rstrip('\n')
            blocks.append((id_val, block_text))

        blocks.sort(key=lambda x: self._id_sort_key(x[0]))

        try:
            with open(ID_FILE, 'w', encoding='utf-8-sig') as f:
                for i, (_, block_text) in enumerate(blocks):
                    f.write(block_text)
                    if i < len(blocks) - 1:
                        f.write('\n\n')
            self.log(f"Файл {ID_FILE} отсортирован по ID.")
        except Exception as e:
            self.log(f"Ошибка записи файла при сортировке: {e}")
            raise

    def toggle_section_checkboxes(self, state):
        for cb in (self.cb_desc, self.cb_api, self.cb_consumes,
                   self.cb_provides, self.cb_impl, self.cb_notes):
            cb.setEnabled(True)

    def select_all_checkboxes(self):
        for lst in (self.left_list, self.mid_list, self.new_list):
            for i in range(lst.count()):
                item = lst.item(i)
                if item.flags() & Qt.ItemFlag.ItemIsUserCheckable:
                    item.setCheckState(Qt.CheckState.Checked)
        self.log("Все чекбоксы выбраны.")

    # ------------------------------------------------------------
    #  Создание отсутствующих файлов
    # ------------------------------------------------------------
    def create_empty_files(self):
        self.log(">>> Начинаю создание отсутствующих файлов...")
        reply = QMessageBox.question(
            self, "Создание файлов",
            f"Будут созданы все отсутствующие файлы в:\n{PROJECT_ROOT}\n\n"
            f"Существующие файлы не будут затронуты.\n\nПродолжить?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )
        if reply != QMessageBox.StandardButton.Yes:
            self.log("Создание отменено пользователем.")
            return

        created = skipped = errors = 0
        for rec in self.records:
            full_path = rec['abspath']
            if full_path is None:
                skipped += 1
                continue

            if os.path.exists(full_path):
                skipped += 1
                continue

            try:
                dir_name = os.path.dirname(full_path)
                if dir_name:
                    os.makedirs(dir_name, exist_ok=True)
                with open(full_path, 'w', encoding='utf-8'):
                    pass
                self.log(f"Создан: {os.path.relpath(full_path, PROJECT_ROOT)}")
                created += 1
            except Exception as e:
                self.log(f"Ошибка при создании {full_path}: {e}")
                errors += 1

        self.log(f"Готово: создано {created}, пропущено {skipped}, ошибок {errors}.")
        self.refresh_lists()

    def populate_list_with_checkboxes(self, list_widget, double_click_handler):
        for rec in self.records:
            item = QListWidgetItem(rec['id'])
            item.setFlags(item.flags() | Qt.ItemFlag.ItemIsUserCheckable)
            item.setCheckState(Qt.CheckState.Unchecked)
            item.setData(Qt.ItemDataRole.UserRole, rec)
            list_widget.addItem(item)
        list_widget.itemDoubleClicked.connect(double_click_handler)

    def populate_paths(self, paths):
        self.right_list.clear()
        for path in paths:
            self.right_list.addItem(path)

    def filter_paths(self, text):
        if not text:
            self.populate_paths(self.all_paths)
        else:
            filtered = [p for p in self.all_paths if text.lower() in p.lower()]
            self.populate_paths(filtered)

    def _build_blocks_corrected(self):
        id_by_line = {rec['line_num']: rec['id'] for rec in self.records}
        line_nums = sorted(id_by_line.keys())
        blocks = {}
        for i, line_num in enumerate(line_nums):
            start_idx = line_num - 1
            end_idx = len(self.lines) - 1
            for idx in range(start_idx + 1, len(self.lines)):
                if MODULE_START_PATTERN.match(self.lines[idx].strip()):
                    end_idx = idx - 1
                    break
            block_lines = self.lines[start_idx:end_idx + 1]
            blocks[id_by_line[line_num]] = ''.join(block_lines).rstrip('\n')
        return blocks

    def reset_all_checkboxes(self):
        for lst in (self.left_list, self.mid_list, self.new_list):
            for i in range(lst.count()):
                item = lst.item(i)
                if item.flags() & Qt.ItemFlag.ItemIsUserCheckable:
                    item.setCheckState(Qt.CheckState.Unchecked)
        self.log("Все чекбоксы сброшены.")

    def update_data_from_id_file(self):
        try:
            self.records = parse_id_file_full(ID_FILE)
            with open(ID_FILE, 'r', encoding='utf-8-sig') as f:
                self.lines = f.readlines()
            self.blocks_by_id = self._build_blocks_corrected()
            self.all_paths = sorted(set(rec['relpath'] for rec in self.records if rec['relpath']))
            self.all_ids = {rec['id'] for rec in self.records}
            self.log("Данные из id_2.md обновлены.")
        except Exception as e:
            self.log(f"Ошибка при обновлении данных: {e}")
            raise

    # ------------------------------------------------------------
    #  Обработчики двойного клика
    # ------------------------------------------------------------
    def on_double_left(self, item):
        rec = item.data(Qt.ItemDataRole.UserRole)
        line_num = find_line_by_id(ID_FILE, rec['id'])
        if line_num:
            open_in_notepad_general(ID_FILE, line_num)
        else:
            self.log(f"Не найден ID {rec['id']} в файле.")

    def on_double_mid(self, item):
        rec = item.data(Qt.ItemDataRole.UserRole)
        full_path = rec['abspath']
        if full_path is None:
            self.log(f"Для {rec['id']} (тип {rec['type']}) файл не создаётся.")
            return
        if os.path.isfile(full_path):
            open_in_notepad_general(full_path)
        else:
            self.log(f"Файл не существует: {full_path}")

    def get_section_text(self, block, header):
        lines = block.splitlines()
        in_section = False
        result = []
        section_headers = [
            '|Описание', '|Публичный API',
            '|↙ ПОТРЕБЛЯЕТ', '|↘ ПРЕДОСТАВЛЯЕТ',
            '|Реализация', '|Примечания'
        ]
        for line in lines:
            stripped = line.strip()
            if stripped.startswith(header):
                in_section = True
                if ':' in line:
                    after = line.split(':', 1)[1].strip()
                    if after:
                        result.append(after)
                continue
            if in_section:
                if any(stripped.startswith(sh) for sh in section_headers if sh != header):
                    break
                if MODULE_START_PATTERN.match(stripped):
                    break
                result.append(line)
        return '\n'.join(result)

    def on_double_new(self, item):
        try:
            self.update_data_from_id_file()
        except Exception as e:
            self.log(f"Не удалось обновить данные: {e}")
            return
        old_rec = item.data(Qt.ItemDataRole.UserRole)
        current_id = old_rec['id']
        current_rec = next((r for r in self.records if r['id'] == current_id), None)
        if current_rec:
            include_reverse = (item.checkState() == Qt.CheckState.Checked)
            self.build_dependency_file(current_rec, include_reverse)
        else:
            self.log(f"ID {current_id} не найден после обновления данных.")

    def on_double_right(self, item):
        rel_path = item.text()
        full_path = os.path.normpath(os.path.join(PROJECT_ROOT, rel_path))
        if os.path.isfile(full_path):
            open_in_notepad_general(full_path)
        else:
            self.log(f"Файл не существует: {full_path}")


    # ------------------------------------------------------------
    #  Блоковый поиск в открытых файлах Notepad++
    # ------------------------------------------------------------
    def get_notepadpp_open_files(self):
        """Возвращает список путей файлов, открытых в Notepad++ (из session.xml)."""
        appdata = os.environ.get('APPDATA')
        if not appdata:
            return []
        session_path = os.path.join(appdata, 'Notepad++', 'session.xml')
        if not os.path.isfile(session_path):
            return []
        try:
            with open(session_path, 'r', encoding='utf-8-sig') as f:
                content = f.read()
        except Exception as e:
            self.log(f"Не удалось прочитать session.xml: {e}")
            return []

        files = re.findall(r'filename="([^"]+)"', content)
        result = []
        seen = set()
        for raw in files:
            path = html.unescape(raw)
            if path in seen:
                continue
            seen.add(path)
            if os.path.isfile(path):
                result.append(path)
        return result

    def _extract_name_from_query(self, query):
        """Пытается вытащить имя функции/класса из вставленной строки."""
        patterns = [
            r'\b(?:async\s+def|def)\s+([A-Za-z_][A-Za-z0-9_]*)',
            r'\b(?:async\s+function|function)\s+([A-Za-z_][A-Za-z0-9_]*)',
            r'\bclass\s+([A-Za-z_][A-Za-z0-9_]*)',
            r'\b(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)',
        ]
        for p in patterns:
            m = re.search(p, query)
            if m:
                return m.group(1)
        m = re.match(r'^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[\(\:]', query)
        if m:
            return m.group(1)
        m = re.match(r'^\s*([A-Za-z_][A-Za-z0-9_]*)\b', query)
        if m:
            return m.group(1)
        return None

    def _line_is_block_start(self, line, name):
        esc = re.escape(name)
        patterns = [
            rf'\bdef\s+{esc}\s*\(',
            rf'\bclass\s+{esc}\b',
            rf'\bfunction\s+{esc}\s*\(',
            rf'\bconst\s+{esc}\s*=',
            rf'\blet\s+{esc}\s*=',
            rf'\bvar\s+{esc}\s*=',
            rf'\b{esc}\s*[:=]\s*(?:async\s+)?function\b',
            rf'\b{esc}\s*[:=]\s*\([^)]*\)\s*=>',
            rf'^\s*{esc}\s*\([^)]*\)\s*\{{',
        ]
        for p in patterns:
            if re.search(p, line):
                return True
        return False

    def _find_block_end(self, lines, start_idx):
        """Возвращает 1-based номер последней строки блока."""
        start_line = lines[start_idx]
        indent = len(start_line) - len(start_line.lstrip(' \t'))

        # C-стиль: есть '{', и в этой же строке баланс не закрыт
        if '{' in start_line and start_line.count('{') > start_line.count('}'):
            depth = 0
            for i in range(start_idx, len(lines)):
                depth += lines[i].count('{') - lines[i].count('}')
                if depth <= 0:
                    return i + 1
            return len(lines)

        # Python-стиль: ищем следующую непустую строку с отступом <= indent
        for i in range(start_idx + 1, len(lines)):
            line = lines[i]
            if not line.strip():
                continue
            line_indent = len(line) - len(line.lstrip(' \t'))
            if line_indent <= indent:
                return i
        return len(lines)

    # ------------------------------------------------------------
    #  Блоковый поиск в открытых файлах Notepad++
    # ------------------------------------------------------------
    def search_block_in_open_files(self):
        raw = self.block_search_edit.toPlainText()
        if not raw.strip():
            return

        query_lines = [ln.rstrip() for ln in raw.splitlines()]
        while query_lines and not query_lines[0].strip():
            query_lines.pop(0)
        while query_lines and not query_lines[-1].strip():
            query_lines.pop()

        self.block_results_list.clear()

        open_files = self.get_notepadpp_open_files()
        open_abs = {os.path.abspath(p) for p in open_files}

        mode = "многострочный" if len(query_lines) > 1 else "однострочный"
        self.log(f"Поиск блока ({mode}) в {len(open_files)} открытых файлах Notepad++...")

        found_open = 0
        for path in open_files:
            found_open += self._scan_one_file(path, query_lines, source='open')
        self.log(f"  открытые файлы: найдено {found_open}")

        if found_open == 0:
            project_files = self._collect_project_files(skip_paths=open_abs)
            self.log(f"  в открытых не найдено. Поиск в {len(project_files)} "
                     f"файлах проекта...")
            found_closed = 0
            for path in project_files:
                found_closed += self._scan_one_file(path, query_lines, source='closed')
            self.log(f"  файлы проекта: найдено {found_closed}")

        total = self.block_results_list.count()
        self.log(f"Итого найдено блоков: {total}")

        if total == 1:
            self.on_double_block_result(self.block_results_list.item(0))
            
    def _collect_project_files(self, skip_paths=None):
        """Собирает текстовые файлы под PROJECT_ROOT для поиска.
        skip_paths — множество абсолютных путей, которые не надо проверять
        (например, уже проверенные открытые файлы)."""
        skip_paths = skip_paths or set()
        result = []
        for root, dirs, files in os.walk(PROJECT_ROOT):
            # правим dirs in-place, чтобы os.walk не заходил в лишние папки
            dirs[:] = [d for d in dirs
                       if d not in SEARCH_SKIP_DIRS and not d.startswith('.')]
            for name in files:
                ext = os.path.splitext(name)[1].lower()
                if ext in SEARCH_SKIP_EXTS:
                    continue
                full = os.path.abspath(os.path.join(root, name))
                if full in skip_paths:
                    continue
                try:
                    if os.path.getsize(full) > SEARCH_MAX_FILE_SIZE:
                        continue
                except OSError:
                    continue
                result.append(full)
        return result

    def _scan_one_file(self, path, query_lines, source):
        """Сканирует один файл и добавляет найденные блоки в block_results_list.
        source: 'open' или 'closed' — для метки в списке.
        Возвращает число найденных блоков."""
        try:
            with open(path, 'r', encoding='utf-8-sig', errors='replace') as f:
                file_lines = f.readlines()
        except Exception:
            return 0

        if len(query_lines) > 1:
            matches = self._find_multiline_block(file_lines, query_lines)
        else:
            matches = self._find_block_by_name(file_lines, query_lines[0])

        tag = "откр" if source == 'open' else "файл"
        count = 0
        for (start_idx, end_idx) in matches:
            preview = file_lines[start_idx].rstrip('\n')[:90]
            item = QListWidgetItem(
                f"[{tag}] {os.path.basename(path)}:"
                f"{start_idx + 1}-{end_idx + 1} — {preview}"
            )
            item.setData(Qt.ItemDataRole.UserRole, {
                'path': path,
                'start': start_idx + 1,
                'end': end_idx + 1,
            })
            item.setToolTip(path)
            self.block_results_list.addItem(item)
            count += 1
        return count            

    def _find_multiline_block(self, file_lines, query_lines):
        """Ищет точную последовательность строк (сравнение по strip()).
        Возвращает список (start_idx, end_idx) — 0-based включительно."""
        n = len(query_lines)
        q = [x.strip() for x in query_lines]
        matches = []
        if n == 0 or n > len(file_lines):
            return matches
        for i in range(len(file_lines) - n + 1):
            ok = True
            for j in range(n):
                if file_lines[i + j].strip() != q[j]:
                    ok = False
                    break
            if ok:
                matches.append((i, i + n - 1))
        return matches

    def _find_block_by_name(self, file_lines, query):
        """Fallback: однострочный ввод. Ищет определение по имени и вычисляет
        конец блока по отступам или балансу фигурных скобок."""
        name = self._extract_name_from_query(query) or query.strip()
        matches = []
        for idx, line in enumerate(file_lines):
            if not self._line_is_block_start(line, name):
                continue
            end_idx = self._find_block_end_v2(file_lines, idx)
            matches.append((idx, end_idx))
        return matches

    def _find_block_end_v2(self, file_lines, start_idx):
        """Возвращает 0-based индекс последней строки блока.

        Сначала «доискивает» открывающую { или : после сигнатуры
        (многострочная сигнатура), затем отслеживает баланс скобок
        или отступы.
        """
        # 1. Найдём строку с открывающей скобкой тела (или конец сигнатуры).
        open_idx = start_idx
        saw_open_brace = False
        for i in range(start_idx, min(start_idx + 20, len(file_lines))):
            line = file_lines[i]
            if '{' in line:
                # учитываем скобки в атрибутах типа Promise<{ signalId: UUID }> {
                # берём последнюю { в строке
                open_idx = i
                saw_open_brace = True
                break
            # Python: строка заканчивается ':' (def/class)
            if re.search(r':\s*(#.*)?$', line) and not line.lstrip().startswith('#'):
                open_idx = i
                break
            # Точка с запятой — это не блок (объявление)
            if ';' in line and '{' not in line:
                return i

        if saw_open_brace:
            depth = 0
            for i in range(open_idx, len(file_lines)):
                depth += file_lines[i].count('{') - file_lines[i].count('}')
                if depth <= 0:
                    return i
            return len(file_lines) - 1

        # Python-стиль: отступ тела больше отступа заголовка
        header_indent = len(file_lines[start_idx]) - len(
            file_lines[start_idx].lstrip(' \t'))
        for i in range(open_idx + 1, len(file_lines)):
            line = file_lines[i]
            if not line.strip():
                continue
            line_indent = len(line) - len(line.lstrip(' \t'))
            if line_indent <= header_indent:
                return i - 1
        return len(file_lines) - 1

    def on_double_block_result(self, item):
        data = item.data(Qt.ItemDataRole.UserRole)
        if not data:
            return
        path = data['path']
        start_line = data['start']
        end_line = data['end']

        if NOTEPAD_EXE is None:
            self.log("Notepad++ не найден.")
            return

        try:
            subprocess.Popen([NOTEPAD_EXE, f"-n{start_line}", path])
        except Exception as e:
            self.log(f"Не удалось открыть Notepad++: {e}")
            return

        QTimer.singleShot(
            700, lambda: self._select_in_notepadpp(start_line, end_line, 0)
        )


    def _select_in_notepadpp(self, start_line, end_line, attempt=0):
        """Выделяет диапазон строк в главном редакторе Notepad++."""
        if sys.platform != 'win32':
            return
        try:
            import ctypes
            from ctypes import wintypes
        except Exception as e:
            self.log(f"ctypes недоступен: {e}")
            return

        user32 = ctypes.WinDLL('user32', use_last_error=True)

        user32.SendMessageW.argtypes = [
            wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        user32.SendMessageW.restype = wintypes.LPARAM
        user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
        user32.FindWindowW.restype = wintypes.HWND
        user32.IsWindowVisible.argtypes = [wintypes.HWND]
        user32.IsWindowVisible.restype = wintypes.BOOL
        user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR,
                                         ctypes.c_int]
        user32.GetClassNameW.restype = ctypes.c_int
        user32.GetWindowRect.argtypes = [wintypes.HWND,
                                         ctypes.POINTER(wintypes.RECT)]
        user32.GetWindowRect.restype = wintypes.BOOL
        user32.SetForegroundWindow.argtypes = [wintypes.HWND]
        user32.SetForegroundWindow.restype = wintypes.BOOL

        SCI_POSITIONFROMLINE   = 2167
        SCI_GETLINEENDPOSITION = 2136
        SCI_SETSEL             = 2160
        SCI_GETLINECOUNT       = 2154
        SCI_SCROLLCARET        = 2169
        SCI_GETSELECTIONSTART  = 2143
        SCI_GETSELECTIONEND    = 2145

        MAX_ATTEMPTS = 8
        RETRY_DELAY_MS = 300

        hwnd = user32.FindWindowW("Notepad++", None)
        if not hwnd:
            if attempt < MAX_ATTEMPTS:
                QTimer.singleShot(
                    RETRY_DELAY_MS,
                    lambda: self._select_in_notepadpp(
                        start_line, end_line, attempt + 1))
            return

        # Собираем ВСЕ видимые Scintilla.
        vis_scis = []

        @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        def cb(child, _):
            buf = ctypes.create_unicode_buffer(256)
            user32.GetClassNameW(child, buf, 256)
            if buf.value == "Scintilla" and user32.IsWindowVisible(child):
                vis_scis.append(child)
            return True

        user32.EnumChildWindows(hwnd, cb, 0)

        if not vis_scis:
            if attempt < MAX_ATTEMPTS:
                QTimer.singleShot(
                    RETRY_DELAY_MS,
                    lambda: self._select_in_notepadpp(
                        start_line, end_line, attempt + 1))
            return

        # Из видимых Scintilla берём самый большой по площади — это
        # главный редактор, а не панель плагина (Function List и т.п.).
        def area(h):
            r = wintypes.RECT()
            user32.GetWindowRect(h, ctypes.byref(r))
            return (r.right - r.left) * (r.bottom - r.top)

        sci = max(vis_scis, key=area)

        line_count = user32.SendMessageW(sci, SCI_GETLINECOUNT, 0, 0) or 0
        if line_count < start_line:
            # Файл ещё не загрузился в редактор — пробуем ещё раз.
            if attempt < MAX_ATTEMPTS:
                QTimer.singleShot(
                    RETRY_DELAY_MS,
                    lambda: self._select_in_notepadpp(
                        start_line, end_line, attempt + 1))
            return

        if start_line < 1:
            start_line = 1
        if end_line > line_count:
            end_line = line_count
        if end_line < start_line:
            end_line = start_line

        start_pos = user32.SendMessageW(
            sci, SCI_POSITIONFROMLINE, start_line - 1, 0)
        end_pos = user32.SendMessageW(
            sci, SCI_GETLINEENDPOSITION, end_line - 1, 0)

        # Ставим выделение.
        user32.SendMessageW(sci, SCI_SETSEL, start_pos, end_pos)

        # Проверяем, что оно действительно установилось. Notepad++ c ключом
        # -n может асинхронно перебросить курсор на нужную строку уже ПОСЛЕ
        # нашего SCI_SETSEL и сбросить выделение. Поэтому повторяем.
        cur_start = user32.SendMessageW(sci, SCI_GETSELECTIONSTART, 0, 0)
        cur_end = user32.SendMessageW(sci, SCI_GETSELECTIONEND, 0, 0)
        if cur_end - cur_start == 0 and attempt < MAX_ATTEMPTS:
            QTimer.singleShot(
                RETRY_DELAY_MS,
                lambda: self._select_in_notepadpp(
                    start_line, end_line, attempt + 1))
            return

        user32.SendMessageW(sci, SCI_SCROLLCARET, 0, 0)
        try:
            user32.SetForegroundWindow(hwnd)
        except Exception:
            pass
    # ------------------------------------------------------------
    #  Сборка файла зависимостей
    # ------------------------------------------------------------
    def build_dependency_file(self, rec, include_reverse=False):
        current_id = rec['id']
        current_block = self.blocks_by_id.get(current_id, f"Блок для {current_id} не найден.")

        full_path = rec['abspath']
        if full_path is None:
            file_content = f"[ФАЙЛ НЕ СОЗДАЁТСЯ ДЛЯ ТИПА {rec['type']}]"
        elif os.path.isfile(full_path):
            try:
                with open(full_path, 'r', encoding='utf-8-sig') as f:
                    file_content = f.read()
            except Exception as e:
                file_content = f"[ОШИБКА ЧТЕНИЯ: {e}]"
        else:
            file_content = f"[ФАЙЛ НЕ НАЙДЕН: {full_path}]"

        deps = self.extract_dependencies_from_block(current_block, current_id=current_id)
        reverse_deps = self.find_reverse_dependencies(current_id) if include_reverse else []

        show_blocks = self.cb_blocks.isChecked()
        show_files = self.cb_files.isChecked()
        show_full_list = self.cb_full_list.isChecked()
        show_charter = self.cb_charter.isChecked()

        section_map = {
            '|Описание': self.cb_desc.isChecked(),
            '|Публичный API': self.cb_api.isChecked(),
            '|↙ ПОТРЕБЛЯЕТ': self.cb_consumes.isChecked(),
            '|↘ ПРЕДОСТАВЛЯЕТ': self.cb_provides.isChecked(),
            '|Реализация': self.cb_impl.isChecked(),
            '|Примечания': self.cb_notes.isChecked(),
        }

        os.makedirs(self.temp_dir, exist_ok=True)
        output_path = os.path.join(self.temp_dir, f"deps_{current_id}.md")

        with open(output_path, 'w', encoding='utf-8-sig') as out:
            out.write(current_block)
            out.write("\n\n" + "=" * 60 + "\n")

            rel_display = rec['relpath'] or rec['name']
            out.write(f"Содержимое файла: {rel_display}\n")
            out.write("=" * 60 + "\n\n")
            out.write(file_content)
            out.write("\n\n" + "=" * 60 + "\n")

            if deps or (include_reverse and reverse_deps):
                out.write("Содержимое зависимостей:\n")
                out.write("=" * 60 + "\n\n")
                if deps:
                    out.write("Прямые зависимости (упоминаются в блоке):\n")
                    for dep_id in deps:
                        self._write_dependency(out, dep_id, show_blocks, show_files)
                if include_reverse and reverse_deps:
                    out.write("\nОбратные зависимости (ID, которые ссылаются на данный):\n")
                    for dep_id in reverse_deps:
                        self._write_dependency(out, dep_id, show_blocks, show_files)
                out.write("---\n\n")

            if show_full_list:
                out.write("\n" + "=" * 60 + "\n")
                out.write("ЗАПОМНИТЬ СПИСОК ВСЕХ ФАЙЛОВ РЕЕСТРА НЕ ПЛОДИ ПОВТОРЫ:\n")
                out.write("=" * 60 + "\n\n")
                for rec_item in self.records:
                    header_line = self.lines[rec_item['line_num'] - 1].rstrip('\n')
                    header_line = re.sub(r'\s*\|\s*', '|', header_line)
                    out.write(header_line + "\n")
                    block = self.blocks_by_id.get(rec_item['id'], "")
                    for header, checked in section_map.items():
                        if checked and block:
                            section_text = self.get_section_text(block, header)
                            if section_text:
                                out.write(header + "\n")
                                out.write(section_text)
                                out.write("\n")

            if show_charter:
                only_self_for_charter = not (show_blocks or show_files)
                if only_self_for_charter:
                    all_ids = {current_id}
                else:
                    all_ids = {current_id}
                    all_ids.update(deps)
                    if include_reverse:
                        all_ids.update(reverse_deps)

                charter_refs = set()
                for id_ in all_ids:
                    block = self.blocks_by_id.get(id_, "")
                    if block:
                        refs = self.extract_charter_references_from_first_line(block)
                        charter_refs.update(refs)

                if charter_refs:
                    roman_map = {'I': 1, 'II': 2, 'III': 3, 'IV': 4,
                                 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8}

                    def sort_key(ref):
                        parts = ref.split('.')
                        return (roman_map.get(parts[0], 0),
                                int(parts[1]), int(parts[2]))

                    out.write("\n" + "=" * 60 + "\n")
                    out.write("СТАТЬИ ХАРТИИ (упоминаемые в модулях):\n")
                    out.write("=" * 60 + "\n\n")
                    for ref in sorted(charter_refs, key=sort_key):
                        article_text = self.charter_articles.get(
                            ref, f"[Статья {ref} не найдена в Хартии]")
                        out.write(f"--- Статья {ref} ---\n\n")
                        out.write(article_text)
                        out.write("\n\n")
                else:
                    out.write("\n" + "=" * 60 + "\n")
                    out.write("СТАТЬИ ХАРТИИ: не найдено ссылок.\n")

        self.log(f"Создан файл зависимостей: {output_path}")
        open_in_notepad_general(output_path)

    # ------------------------------------------------------------
    #  Обработчики кнопок сборки
    # ------------------------------------------------------------
    def assemble_blocks_to_file(self):
        selected_ids = []
        for i in range(self.left_list.count()):
            item = self.left_list.item(i)
            if item.checkState() == Qt.CheckState.Checked:
                rec = item.data(Qt.ItemDataRole.UserRole)
                selected_ids.append(rec['id'])
        if not selected_ids:
            self.log("Не выбрано ни одного ID в левой колонке.")
            return
        output_path = os.path.join(PROJECT_ROOT, "клей_id.md")
        assemble_id_blocks(self.records, selected_ids, self.blocks_by_id,
                           output_path, self.log)

    def assemble_files(self):
        selected_indices = []
        for i in range(self.mid_list.count()):
            item = self.mid_list.item(i)
            if item.checkState() == Qt.CheckState.Checked:
                selected_indices.append(i)
        if not selected_indices:
            self.log("Не выбрано ни одного ID в средней колонке.")
            return
        output_path = os.path.join(PROJECT_ROOT, "клей_файл.md")
        assemble_files_content(self.records, selected_indices, output_path, self.log)

    # ------------------------------------------------------------
    #  Логирование
    # ------------------------------------------------------------
    def log(self, message):
        self.log_queue.put(message)

    def process_log_queue(self):
        while not self.log_queue.empty():
            msg = self.log_queue.get_nowait()
            timestamp = datetime.now().strftime("%H:%M:%S")
            self.console.appendPlainText(f"[{timestamp}] {msg}")
            cursor = self.console.textCursor()
            cursor.movePosition(cursor.MoveOperation.End)
            self.console.setTextCursor(cursor)

    @pyqtSlot(bool)
    def set_busy_state(self, busy):
        self.btn_save.setEnabled(not busy)
        self.btn_rollback.setEnabled(not busy)
        self.copy_button.setEnabled(not busy)
        self.assemble_button.setEnabled(not busy)
        self.btn_placeholder.setEnabled(False)
        self.btn_insert_id.setEnabled(not busy)
        self.btn_merge.setEnabled(not busy)

    # ------------------------------------------------------------
    #  Сохранение снимка
    # ------------------------------------------------------------
    def save_snapshot(self):
        comment, ok = QInputDialog.getText(self, "Комментарий",
                                           "Введите комментарий к снимку:")
        if not ok:
            return
        self.set_busy_state(True)
        self.log(">>> Начинаю сохранение снимка...")
        self.operation_thread = threading.Thread(
            target=self._save_snapshot_worker, args=(comment,))
        self.operation_thread.daemon = True
        self.operation_thread.start()

    def _save_snapshot_worker(self, comment):
        try:
            os.makedirs(HISTORY_DIR, exist_ok=True)
            now = datetime.now()
            day_month = now.strftime("%d_%m")
            existing = [d for d in os.listdir(HISTORY_DIR)
                        if os.path.isdir(os.path.join(HISTORY_DIR, d)) and
                        d.startswith(day_month + '_')]
            max_num = 0
            for name in existing:
                parts = name.split('_')
                if len(parts) == 3 and parts[2].isdigit():
                    max_num = max(max_num, int(parts[2]))
            snapshot_name = f"{day_month}_{max_num + 1}"
            snapshot_path = os.path.join(HISTORY_DIR, snapshot_name)
            self.log(f"Создаю папку {snapshot_name}...")
            os.mkdir(snapshot_path)

            for item in os.listdir(PROJECT_ROOT):
                item_path = os.path.join(PROJECT_ROOT, item)
                if item in ("ИСТОРИЯ", "__pycache__") or not os.path.exists(item_path):
                    continue
                dest = os.path.join(snapshot_path, item)
                if os.path.isdir(item_path):
                    shutil.copytree(item_path, dest)
                    self.log(f"  Скопирована папка {item}")
                else:
                    shutil.copy2(item_path, dest)
                    self.log(f"  Скопирован файл {item}")

            with open(os.path.join(snapshot_path, "comment.txt"),
                      "w", encoding="utf-8-sig") as f:
                f.write(comment)
            self.log(f">>> Снимок {snapshot_name} успешно сохранён.")
        except Exception as e:
            self.log(f">>> Ошибка при сохранении снимка: {e}")
            QMetaObject.invokeMethod(self, "show_error", Qt.ConnectionType.QueuedConnection,
                                     Q_ARG(str, "Ошибка"),
                                     Q_ARG(str, f"Не удалось сохранить снимок:\n{e}"))
        finally:
            QMetaObject.invokeMethod(self, "set_busy_state",
                                     Qt.ConnectionType.QueuedConnection,
                                     Q_ARG(bool, False))

    # ------------------------------------------------------------
    #  Откат снимка
    # ------------------------------------------------------------
    def rollback_snapshot(self):
        if not os.path.isdir(HISTORY_DIR):
            QMessageBox.information(self, "Информация",
                                    "Папка ИСТОРИЯ ещё не создана.")
            return
        snapshots = [d for d in os.listdir(HISTORY_DIR)
                     if os.path.isdir(os.path.join(HISTORY_DIR, d))]
        if not snapshots:
            QMessageBox.information(self, "Информация", "В папке ИСТОРИЯ нет снимков.")
            return
        snapshots.sort(key=lambda d: os.path.getctime(os.path.join(HISTORY_DIR, d)),
                       reverse=True)
        dialog = SnapshotDialog(snapshots, self)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            snap_name = dialog.get_selected()
            if snap_name:
                self._perform_rollback(snap_name)

    def _perform_rollback(self, snapshot_name):
        self.set_busy_state(True)
        self.log(f">>> Начинаю восстановление из снимка {snapshot_name}...")
        self.operation_thread = threading.Thread(
            target=self._rollback_worker, args=(snapshot_name,))
        self.operation_thread.daemon = True
        self.operation_thread.start()

    def _kill_processes_using_path(self, path):
        if not PSUTIL_AVAILABLE:
            return []
        path = os.path.abspath(path).lower()
        killed = []
        paths_to_check = [path]
        if os.path.isdir(path):
            for root_dir, _dirs, files in os.walk(path):
                for file in files:
                    paths_to_check.append(os.path.join(root_dir, file).lower())
        for proc in psutil.process_iter(['pid', 'name', 'open_files', 'cwd']):
            try:
                info = proc.info
                if info['open_files']:
                    for f in info['open_files']:
                        if f.path.lower() in paths_to_check:
                            proc.terminate()
                            proc.wait(timeout=3)
                            killed.append((info['pid'], info['name']))
                            break
                if info['cwd'] and info['cwd'].lower().startswith(path):
                    proc.terminate()
                    proc.wait(timeout=3)
                    killed.append((info['pid'], info['name']))
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.TimeoutExpired):
                continue
            except Exception:
                continue
        return killed

    def _rollback_worker(self, snapshot_name):
        snapshot_path = os.path.join(HISTORY_DIR, snapshot_name)
        script_name = os.path.basename(__file__)
        try:
            for item in os.listdir(PROJECT_ROOT):
                item_path = os.path.join(PROJECT_ROOT, item)
                # НЕ удаляем сам скрипт, папку истории и __pycache__
                if item in ("ИСТОРИЯ", "__pycache__", script_name):
                    continue
                if not os.path.exists(item_path):
                    continue

                max_attempts = 3
                for attempt in range(1, max_attempts + 1):
                    try:
                        if os.path.isdir(item_path):
                            shutil.rmtree(item_path)
                            self.log(f"  Удалена папка {item}")
                        else:
                            os.remove(item_path)
                            self.log(f"  Удалён файл {item}")
                        break
                    except PermissionError:
                        if attempt == max_attempts:
                            self.log(f"  !!! Не удалось удалить {item_path} "
                                     f"после {max_attempts} попыток.")
                            raise
                        self.log(f"  {item} занят другим процессом. "
                                 f"Запрашиваю разрешение на завершение...")
                        user_allowed = False
                        call_success = QMetaObject.invokeMethod(
                            self, "ask_kill_processes",
                            Qt.ConnectionType.BlockingQueuedConnection,
                            Q_RETURN_ARG(bool, user_allowed),
                            Q_ARG(str, item),
                        )
                        if call_success and user_allowed:
                            killed = self._kill_processes_using_path(item_path)
                            if killed:
                                self.log(f"  Завершены процессы: {killed}")
                                time.sleep(1)
                            else:
                                self.log(f"  Не удалось найти блокирующие процессы.")
                                time.sleep(2)
                        else:
                            raise Exception("Откат отменён пользователем или ошибка вызова")

            for item in os.listdir(snapshot_path):
                if item == "comment.txt":
                    continue
                src = os.path.join(snapshot_path, item)
                dst = os.path.join(PROJECT_ROOT, item)
                try:
                    if os.path.isdir(src):
                        shutil.copytree(src, dst)
                        self.log(f"  Восстановлена папка {item}")
                    else:
                        shutil.copy2(src, dst)
                        self.log(f"  Восстановлен файл {item}")
                except Exception as e:
                    self.log(f"  !!! Ошибка при копировании {item}: {e}")
                    raise

            self.log(f">>> Восстановление из {snapshot_name} завершено.")
            QMetaObject.invokeMethod(self, "refresh_lists",
                                     Qt.ConnectionType.QueuedConnection)
        except Exception as e:
            self.log(f">>> Ошибка при восстановлении: {e}")
            QMetaObject.invokeMethod(self, "show_error",
                                     Qt.ConnectionType.QueuedConnection,
                                     Q_ARG(str, "Ошибка"),
                                     Q_ARG(str, f"Не удалось выполнить откат:\n{e}"))
        finally:
            QMetaObject.invokeMethod(self, "set_busy_state",
                                     Qt.ConnectionType.QueuedConnection,
                                     Q_ARG(bool, False))

    @pyqtSlot(str, result=bool)
    def ask_kill_processes(self, item_name):
        reply = QMessageBox.question(
            self, "Завершение процессов",
            f"Папка/файл {item_name} заблокирована.\n"
            f"Разрешить автоматическое завершение процессов, которые её используют?\n\n"
            f"Это может привести к потере несохранённых данных.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
        return reply == QMessageBox.StandardButton.Yes

    @pyqtSlot(str, str)
    def show_error(self, title, message):
        QMessageBox.critical(self, title, message)

    @pyqtSlot()
    def refresh_lists(self):
        self.sort_and_save_id_file()
        try:
            self.records = parse_id_file_full(ID_FILE)
            with open(ID_FILE, 'r', encoding='utf-8-sig') as f:
                self.lines = f.readlines()
            self.blocks_by_id = self._build_blocks_corrected()
            self.all_paths = sorted(set(rec['relpath'] for rec in self.records
                                        if rec['relpath']))
            self.all_ids = {rec['id'] for rec in self.records}

            self.left_list.clear()
            self.populate_list_with_checkboxes(self.left_list, self.on_double_left)
            self.mid_list.clear()
            self.populate_list_with_checkboxes(self.mid_list, self.on_double_mid)
            self.new_list.clear()
            self.populate_list_with_checkboxes(self.new_list, self.on_double_new)
            self.populate_paths(self.all_paths)
            self.filter_paths(self.search_edit.text())
            self.populate_module_list()
            self.log("Списки обновлены после сортировки.")
        except Exception as e:
            self.log(f"Ошибка при обновлении списков: {e}")

    def replace_id_file(self):
        id2_path = ID_FILE
        id4_path = os.path.join(PROJECT_ROOT, "id_4.md")

        if not os.path.isfile(id2_path):
            QMessageBox.warning(self, "Ошибка", "Файл id_2.md не найден.")
            return
        if not os.path.isfile(id4_path):
            QMessageBox.warning(self, "Ошибка",
                                "Файл id_4.md не найден. Сначала создайте его.")
            return

        try:
            with open(id2_path, 'r', encoding='utf-8') as f:
                lines_2 = f.readlines()
            with open(id4_path, 'r', encoding='utf-8') as f:
                lines_4 = f.readlines()
        except Exception as e:
            QMessageBox.critical(self, "Ошибка чтения",
                                 f"Не удалось прочитать файлы: {e}")
            return

        self.compare_dialog = CompareDialog(None, lines_2, lines_4, PROJECT_ROOT)
        self.compare_dialog.accepted.connect(lambda: self._perform_replace(lines_4))
        self.compare_dialog.rejected.connect(
            lambda: self.log("Замена отменена пользователем."))
        self.compare_dialog.show()

    def _perform_replace(self, lines_4):
        id2_path = ID_FILE
        id4_path = os.path.join(PROJECT_ROOT, "id_4.md")
        try:
            with open(id2_path, 'w', encoding='utf-8') as f:
                f.writelines(lines_4)
            if os.path.isfile(id4_path):
                os.remove(id4_path)
            self.log(f"Замена выполнена: id_2.md обновлён из id_4.md. "
                     f"Строк: {len(lines_4)}.")
            self.refresh_lists()
        except Exception as e:
            QMessageBox.critical(self, "Ошибка замены",
                                 f"Не удалось выполнить замену: {e}")
            self.log(f"Ошибка замены: {e}")

    # ------------------------------------------------------------
    #  Кнопка "Вставить"
    # ------------------------------------------------------------
    def insert_id_into_files(self):
        reply = QMessageBox.question(
            self, "Подтверждение",
            "Будет выполнена вставка ID-строки в начало каждого файла.\n"
            "Все начальные комментарии (строки, начинающиеся с //, #, /*, <!--) "
            "будут удалены.\nСуществующие файлы будут перезаписаны.\n\nПродолжить?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )
        if reply != QMessageBox.StandardButton.Yes:
            return

        self.set_busy_state(True)
        self.log(">>> Начинаю вставку ID в файлы...")
        threading.Thread(target=self._insert_id_worker, daemon=True).start()

    def _insert_id_worker(self):
        try:
            for rec in self.records:
                full_path = rec['abspath']
                if full_path is None:
                    continue
                rel_path = rec['relpath'] or rec['name']

                if not os.path.isfile(full_path):
                    self.log(f"Файл не найден: {rel_path}")
                    continue

                ext = os.path.splitext(rel_path)[1].lower()
                if ext in ['.dart', '.js', '.ts', '.java', '.c', '.cpp', '.h',
                           '.go', '.rs']:
                    comment_prefix, comment_suffix = '// ', ''
                elif ext in ['.py', '.rb', '.sh', '.pl', '.pm', '.bash']:
                    comment_prefix, comment_suffix = '# ', ''
                elif ext in ['.html', '.htm', '.xml', '.xhtml']:
                    comment_prefix, comment_suffix = '<!-- ', ' -->'
                elif ext in ['.css', '.scss', '.less']:
                    comment_prefix, comment_suffix = '/* ', ' */'
                elif ext in ['.sql', '.lua']:
                    comment_prefix, comment_suffix = '-- ', ''
                else:
                    comment_prefix, comment_suffix = '// ', ''

                with open(full_path, 'r', encoding='utf-8-sig') as f:
                    lines = f.readlines()

                start_idx = 0
                for i, line in enumerate(lines):
                    stripped = line.lstrip()
                    if stripped == '':
                        continue
                    if (stripped.startswith('//') or stripped.startswith('#') or
                            stripped.startswith('/*') or stripped.startswith('<!--') or
                            stripped.startswith('--')):
                        continue
                    start_idx = i
                    break

                id_line = self.lines[rec['line_num'] - 1].rstrip('\n')
                if comment_suffix:
                    new_first_line = f"{comment_prefix}{id_line}{comment_suffix}\n"
                else:
                    new_first_line = f"{comment_prefix}{id_line}\n"

                new_content = new_first_line + ''.join(lines[start_idx:])
                with open(full_path, 'w', encoding='utf-8-sig') as f:
                    f.write(new_content)

                self.log(f"Обновлён файл: {rel_path}")

            self.log(">>> Вставка ID завершена.")
        except Exception as e:
            self.log(f"Ошибка при вставке ID: {e}")
        finally:
            QMetaObject.invokeMethod(self, "set_busy_state",
                                     Qt.ConnectionType.QueuedConnection,
                                     Q_ARG(bool, False))

    # ------------------------------------------------------------
    #  Кнопка "Создать" (id_4.md)
    # ------------------------------------------------------------
    def merge_to_id_4(self):
        reply = QMessageBox.question(
            self, "Подтверждение",
            "Будет создан файл id_4.md на основе id_2.md и id_3.md.\n"
            "Убедитесь, что id_3.md подготовлен и находится в той же папке.\n\n"
            "Продолжить?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )
        if reply != QMessageBox.StandardButton.Yes:
            return
        self.set_busy_state(True)
        self.log(">>> Запуск слияния id_2.md и id_3.md...")
        threading.Thread(target=self._merge_worker, daemon=True).start()

    def _merge_worker(self):
        try:
            base_path = ID_FILE
            change_path = os.path.join(PROJECT_ROOT, "id_3.md")
            if not os.path.isfile(base_path) or not os.path.isfile(change_path):
                raise Exception("Не найден id_2.md или id_3.md в папке со скриптом.")

            with open(base_path, 'r', encoding='utf-8-sig') as f:
                base_lines = f.readlines()
            with open(change_path, 'r', encoding='utf-8-sig') as f:
                change_lines = f.readlines()

            base_blocks = self._split_into_blocks(base_lines)
            change_blocks = self._split_into_blocks(change_lines)
            merged_blocks = self._merge_blocks(base_blocks, change_blocks)

            output_lines = []
            for i, (_, block) in enumerate(merged_blocks):
                output_lines.extend(block)
                if i != len(merged_blocks) - 1:
                    output_lines.append('\n')

            while output_lines and output_lines[-1] == '':
                output_lines.pop()

            with open(base_path, 'rb') as f:
                raw = f.read()
            encoding = 'utf-8-sig' if raw.startswith(b'\xef\xbb\xbf') else 'utf-8'

            output_path = os.path.join(PROJECT_ROOT, "id_4.md")
            with open(output_path, 'w', encoding=encoding) as f:
                f.writelines(output_lines)

            self._normalize_blank_lines(output_path)
            self.log(f"Создан id_4.md. Всего блоков: {len(merged_blocks)}")
            open_in_notepad_general(output_path)
        except Exception as e:
            self.log(f"Ошибка при слиянии: {e}")
            import traceback
            self.log(traceback.format_exc())
        finally:
            QMetaObject.invokeMethod(self, "set_busy_state",
                                     Qt.ConnectionType.QueuedConnection,
                                     Q_ARG(bool, False))

    # ------------------------------------------------------------
    #  Вспомогательные методы слияния
    # ------------------------------------------------------------
    def _split_into_blocks(self, lines):
        blocks = []
        current_block = []
        current_id = None
        for line in lines:
            clean_line = re.sub(r'^[\s\u200b\u00a0\ufeff]+', '', line)
            stripped = clean_line.strip()
            match = MODULE_START_PATTERN.match(stripped)
            if match:
                if current_block:
                    blocks.append((current_id, current_block))
                current_block = [line]
                current_id = match.group(1)
            else:
                if current_block is not None:
                    current_block.append(line)
        if current_block:
            blocks.append((current_id, current_block))
        return blocks

    def _parse_block(self, block_lines):
        if not block_lines:
            return {'header': '', 'sections': {}}
        header = block_lines[0]
        sections = {}
        current_section = None
        current_lines = []
        SECTION_HEADER_RE = re.compile(
            r'^\s*\|(Описание|Публичный API|Реализация|Примечания|'
            r'↙ ПОТРЕБЛЯЕТ|↘ ПРЕДОСТАВЛЯЕТ)\s*[^:]*[:：]'
        )
        for line in block_lines[1:]:
            match = SECTION_HEADER_RE.match(line)
            if match:
                if current_section is not None:
                    sections[current_section] = current_lines
                sec_title = line
                if sec_title.endswith('|'):
                    sec_title = sec_title[:-1].rstrip()
                current_section = match.group(1)
                current_lines = [sec_title]
            else:
                if current_section is not None:
                    current_lines.append(line)
        if current_section is not None:
            sections[current_section] = current_lines
        return {'header': header, 'sections': sections}

    def _build_block(self, header, sections):
        lines = [header]
        standard_order = ['Описание', 'Публичный API', '↙ ПОТРЕБЛЯЕТ',
                          '↘ ПРЕДОСТАВЛЯЕТ', 'Реализация', 'Примечания']
        for sec_name in standard_order:
            if sec_name in sections:
                lines.extend(sections[sec_name])
        for sec_name, sec_lines in sections.items():
            if sec_name not in standard_order:
                lines.extend(sec_lines)
        return lines

    def _strip_trailing_empty_lines(self, block):
        if not block:
            return block
        i = len(block) - 1
        while i >= 0 and block[i].strip() == '':
            i -= 1
        return block[:i + 1]

    def _merge_blocks(self, blocks_base, blocks_changes):
        base_dict = {id_: block for id_, block in blocks_base if id_}
        change_dict = {id_: block for id_, block in blocks_changes if id_}
        result_blocks = []
        for id_, base_block in blocks_base:
            if id_ in change_dict:
                change_block = change_dict[id_]
                base_parsed = self._parse_block(base_block)
                change_parsed = self._parse_block(change_block)
                base_parsed['header'] = change_parsed['header']
                for sec_name, sec_lines in change_parsed['sections'].items():
                    if sec_name in base_parsed['sections']:
                        if len(sec_lines) > 1:
                            base_parsed['sections'][sec_name] = sec_lines
                        else:
                            base_parsed['sections'][sec_name][0] = sec_lines[0]
                    else:
                        base_parsed['sections'][sec_name] = sec_lines
                updated_block = self._build_block(base_parsed['header'],
                                                  base_parsed['sections'])
                result_blocks.append((id_, updated_block))
                self.log(f'Обновлён модуль {id_}')
            else:
                result_blocks.append((id_, base_block))
        for id_, change_block in blocks_changes:
            if id_ not in base_dict:
                result_blocks.append((id_, change_block))
                self.log(f'Добавлен новый модуль {id_}')
        return result_blocks

    def _normalize_blank_lines(self, filepath: str):
        with open(filepath, 'r', encoding='utf-8-sig') as f:
            lines = f.readlines()

        new_lines = []
        i = 0
        while i < len(lines):
            while i < len(lines) and lines[i].strip() == '':
                i += 1
            if i >= len(lines):
                break
            current_line = lines[i]
            if MODULE_START_PATTERN.match(current_line.strip()):
                if new_lines:
                    new_lines.append('\n')
            new_lines.append(current_line)
            i += 1

        while new_lines and new_lines[-1] == '\n':
            new_lines.pop()

        with open(filepath, 'w', encoding='utf-8') as f:
            f.writelines(new_lines)


# ============================================================
#  Диалог сравнения id_2.md ↔ id_4.md
# ============================================================
class CompareDialog(QDialog):
    def __init__(self, parent, lines_2, lines_4, script_dir):
        super().__init__(parent)
        self.lines_2 = lines_2
        self.lines_4 = lines_4
        self.script_dir = script_dir
        self.temp_file_editor = None
        self.temp_file_browser = None
        self.setWindowTitle("Подтверждение замены")
        self.setWindowModality(Qt.WindowModality.NonModal)
        self.setWindowFlags(self.windowFlags() | Qt.WindowType.WindowStaysOnTopHint)
        self.setModal(False)
        self.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose)
        self.move(0, 0)
        layout = QVBoxLayout(self)

        count_2 = len(lines_2)
        count_4 = len(lines_4)
        diff = count_4 - count_2
        change_desc = ("увеличится на " + str(diff)) if diff > 0 \
            else ("уменьшится на " + str(-diff)) if diff < 0 else "не изменится"

        msg = (f"id_2.md содержит {count_2} строк(и).\n"
               f"id_4.md содержит {count_4} строк(и).\n"
               f"После замены количество строк {change_desc}.\n\n"
               "Рекомендуется перед заменой сохранить снимок (кнопка 'Сохранить').")
        layout.addWidget(QLabel(msg))

        button_box = QDialogButtonBox()

        btn_editor = QPushButton("Редактор")
        btn_editor.clicked.connect(self.on_preview_editor)
        button_box.addButton(btn_editor, QDialogButtonBox.ButtonRole.ActionRole)

        btn_browser = QPushButton("Браузер")
        btn_browser.clicked.connect(self.on_preview_browser)
        button_box.addButton(btn_browser, QDialogButtonBox.ButtonRole.ActionRole)

        yes_btn = QPushButton("Да")
        yes_btn.clicked.connect(self.accept)
        button_box.addButton(yes_btn, QDialogButtonBox.ButtonRole.YesRole)

        no_btn = QPushButton("Нет")
        no_btn.clicked.connect(self.reject)
        button_box.addButton(no_btn, QDialogButtonBox.ButtonRole.NoRole)

        layout.addWidget(button_box)

    def _split_into_blocks(self, lines):
        blocks = {}
        current_id = None
        current_block = []
        for line in lines:
            clean_line = re.sub(r'^[\s\u200b\u00a0\ufeff]+', '', line)
            stripped = clean_line.strip()
            match = MODULE_START_PATTERN.match(stripped)
            if match:
                if current_id is not None and current_block:
                    blocks[current_id] = current_block
                current_id = match.group(1)
                current_block = [line]
            else:
                if current_id is not None:
                    current_block.append(line)
        if current_id is not None and current_block:
            blocks[current_id] = current_block
        return blocks

    def _normalize_block(self, block_lines):
        norm = []
        for line in block_lines:
            stripped = line.strip()
            if not stripped:
                continue
            norm.append(re.sub(r'\s+', ' ', stripped))
        return norm

    def _block_diff_report(self):
        blocks_2 = self._split_into_blocks(self.lines_2)
        blocks_4 = self._split_into_blocks(self.lines_4)

        ids_2 = set(blocks_2.keys())
        ids_4 = set(blocks_4.keys())

        added_ids = ids_4 - ids_2
        removed_ids = ids_2 - ids_4
        common_ids = ids_2 & ids_4

        report_lines = []
        report_lines.append("СРАВНЕНИЕ БЛОКОВ id_2.md ↔ id_4.md")
        report_lines.append("=" * 60)
        report_lines.append("")
        report_lines.append(f"Всего блоков: id_2.md = {len(blocks_2)}, "
                            f"id_4.md = {len(blocks_4)}")
        report_lines.append(f"Добавлено блоков: {len(added_ids)}")
        report_lines.append(f"Удалено блоков: {len(removed_ids)}")
        report_lines.append("")
        report_lines.append("-" * 60)

        if added_ids:
            report_lines.append("")
            report_lines.append("=== НОВЫЕ БЛОКИ ===")
            for id_ in sorted(added_ids):
                report_lines.append(f"Блок {id_} [ДОБАВЛЕН]")
                report_lines.extend(blocks_4[id_])
                report_lines.append("")

        if removed_ids:
            report_lines.append("")
            report_lines.append("=== УДАЛЁННЫЕ БЛОКИ ===")
            for id_ in sorted(removed_ids):
                report_lines.append(f"Блок {id_} [УДАЛЁН]")
                report_lines.extend(blocks_2[id_])
                report_lines.append("")

        if common_ids:
            report_lines.append("")
            report_lines.append("=== ИЗМЕНЁННЫЕ БЛОКИ ===")
            for id_ in sorted(common_ids):
                block_2 = self._normalize_block(blocks_2[id_])
                block_4 = self._normalize_block(blocks_4[id_])
                if block_2 == block_4:
                    continue
                report_lines.append(f"Блок {id_} [ИЗМЕНЁН]")
                matcher = difflib.SequenceMatcher(None, block_2, block_4)
                added = deleted = replaced = 0
                for tag, i1, i2, j1, j2 in matcher.get_opcodes():
                    if tag == 'insert':
                        added += (j2 - j1)
                    elif tag == 'delete':
                        deleted += (i2 - i1)
                    elif tag == 'replace':
                        replaced += max(i2 - i1, j2 - j1)
                report_lines.append(f"  Изменений: добавлено {added}, "
                                    f"удалено {deleted}, заменено {replaced}")
                report_lines.append("  --- Было (только изменённые строки) ---")
                for tag, i1, i2, j1, j2 in matcher.get_opcodes():
                    if tag == 'equal':
                        continue
                    ctx_before = max(0, i1 - 2)
                    ctx_after = min(len(block_2), i2 + 2)
                    for idx in range(ctx_before, ctx_after):
                        line = block_2[idx]
                        report_lines.append(("- " if i1 <= idx < i2 else "  ") + line)
                report_lines.append("  --- Стало ---")
                for tag, i1, i2, j1, j2 in matcher.get_opcodes():
                    if tag == 'equal':
                        continue
                    ctx_before_j = max(0, j1 - 2)
                    ctx_after_j = min(len(block_4), j2 + 2)
                    for idx in range(ctx_before_j, ctx_after_j):
                        line = block_4[idx]
                        report_lines.append(("+ " if j1 <= idx < j2 else "  ") + line)
                report_lines.append("")
        return "\n".join(report_lines)

    def on_preview_editor(self):
        self.temp_file_editor = os.path.join(self.script_dir, "compare_editor.md")
        report = self._block_diff_report()
        with open(self.temp_file_editor, 'w', encoding='utf-8') as f:
            f.write(report)
        open_in_notepad_general(self.temp_file_editor)

    def on_preview_browser(self):
        try:
            self.temp_file_browser = os.path.join(self.script_dir, "compare_browser.html")
            diff = difflib.HtmlDiff(tabsize=4, wrapcolumn=None)
            html = diff.make_file(
                self.lines_2, self.lines_4,
                fromdesc="id_2.md", todesc="id_4.md",
                context=False, numlines=5,
            )
            if not html:
                raise RuntimeError("HtmlDiff вернул пустой результат")

            our_css = r"""
<style>
html, body { margin:0; padding:0; width:100%; height:100%; background:#fff; }
body { font-family: Consolas, "Courier New", monospace; font-size: 12px; color:#222; overflow:hidden; }
.diff-wrap { position:relative; width:100%; height:100vh; overflow:auto; box-sizing:border-box; scrollbar-gutter: stable; }
table.diff { width:100%; table-layout:fixed; border-collapse:collapse; border-spacing:0; margin:0; }
table.diff td, table.diff th { box-sizing:border-box; vertical-align:top; }
table.diff td:nth-child(1) { padding:2px 2px; text-align:center; white-space:nowrap; overflow:hidden; background:#f0f0f0; }
table.diff td:nth-child(2) { padding:2px 5px; text-align:right; white-space:nowrap; overflow:hidden; background:#f0f0f0; color:#666; }
table.diff td:nth-child(3) { padding:2px 6px; vertical-align:top; white-space:pre-wrap; overflow-wrap:anywhere; word-break:normal; line-height:1.35; }
table.diff td:nth-child(4) { padding:2px 2px; text-align:center; white-space:nowrap; overflow:hidden; background:#f0f0f0; }
table.diff td:nth-child(5) { padding:2px 5px; text-align:right; white-space:nowrap; overflow:hidden; background:#f0f0f0; color:#666; }
table.diff td:nth-child(6) { padding:2px 6px; vertical-align:top; white-space:pre-wrap; overflow-wrap:anywhere; word-break:normal; line-height:1.35; }
.diff_add { background:#aaffaa !important; }
.diff_chg { background:#ffffaa !important; }
.diff_sub { background:#ffaaaa !important; }
.diff_blank { background:#f0f0f0 !important; }
table.diff th { padding:4px 6px; background:#ddd; font-weight:bold; vertical-align:middle; }
#marker-container { position:absolute; top:0; right:2px; width:12px; pointer-events:none; z-index:1000; }
.marker-dot { position:absolute; left:2px; width:8px; height:4px; margin-top:-2px; background:#ffcc00; border-radius:2px; opacity:0.9; }
</style>
"""
            head_end = html.lower().find("</head>")
            if head_end == -1:
                raise RuntimeError("Не найден </head>")
            html = html[:head_end] + our_css + html[head_end:]

            table_start = html.find('<table class="diff"')
            if table_start == -1:
                raise RuntimeError('Не найдена таблица class="diff"')
            table_end = html.find("</table>", table_start)
            if table_end == -1:
                raise RuntimeError("Не найден </table>")
            table_end += len("</table>")
            table_html = html[table_start:table_end]

            colgroup = ('<colgroup>'
                        '<col style="width: 2%"><col style="width: 5%">'
                        '<col style="width: 43%"><col style="width: 2%">'
                        '<col style="width: 5%"><col style="width: 43%">'
                        '</colgroup>')
            table_open_end = table_html.find(">")
            if table_open_end == -1:
                raise RuntimeError("Некорректное открытие таблицы")
            table_html = (table_html[:table_open_end + 1] + colgroup +
                          table_html[table_open_end + 1:])

            wrapped_table = ('<div class="diff-wrap">' + table_html +
                             '<div id="marker-container"></div></div>')
            html = html[:table_start] + wrapped_table + html[table_end:]

            # (скрипт маркеров как в оригинале — без изменений)
            clean_script = r"""
<script>
(function(){
  "use strict";
  var markerContainer=null, changedRows=[], table=null, wrap=null;
  function collectChangedRows(){
    wrap=document.querySelector('.diff-wrap'); if(!wrap) return;
    table=wrap.querySelector('table.diff'); if(!table) return;
    var rows=table.querySelectorAll('tr'), dataRows=[];
    rows.forEach(function(r){ if(r.querySelector('th')) return; dataRows.push(r); });
    changedRows=[];
    dataRows.forEach(function(r){
      var c=r.querySelectorAll('td'); if(c.length<6) return;
      var l=c[2].textContent.trim(), rr=c[5].textContent.trim();
      if(l!==rr) changedRows.push(r);
    });
  }
  function buildMarkers(){
    if(!wrap||!table) return;
    if(!markerContainer){
      markerContainer=document.createElement('div');
      markerContainer.id='marker-container';
      markerContainer.style.cssText='position:fixed;top:0;right:4px;width:12px;height:100%;pointer-events:auto;z-index:10000;background:transparent;';
      document.body.appendChild(markerContainer);
    }
    markerContainer.innerHTML='';
    if(changedRows.length===0){ markerContainer.style.display='none'; return; }
    markerContainer.style.display='block';
    var wrapRect=wrap.getBoundingClientRect();
    var tableHeight=table.scrollHeight||table.offsetHeight;
    var scrollTop=wrap.scrollTop, windowHeight=window.innerHeight;
    changedRows.forEach(function(row){
      var rowRect=row.getBoundingClientRect();
      var rowTopRelative=rowRect.top-wrapRect.top+scrollTop;
      var percent=Math.min(Math.max(rowTopRelative/tableHeight,0),1);
      var topPx=percent*windowHeight;
      var dot=document.createElement('div');
      dot.className='marker-dot';
      dot.style.cssText='position:absolute;left:2px;width:8px;height:8px;margin-top:-4px;background:#ffcc00;border-radius:50%;opacity:0.9;cursor:pointer;border:1px solid #999;';
      dot.style.top=topPx+'px';
      dot.addEventListener('click',function(e){
        e.stopPropagation();
        wrap.scrollTo({top:rowTopRelative-100,behavior:'smooth'});
      });
      var c=row.querySelectorAll('td');
      var ln=c[1]||c[4];
      if(ln){ dot.title='Строка '+ln.textContent.trim(); }
      markerContainer.appendChild(dot);
    });
  }
  function updateMarkers(){ buildMarkers(); }
  function init(){
    collectChangedRows(); buildMarkers();
    if(wrap){ wrap.addEventListener('scroll',updateMarkers); }
    window.addEventListener('resize',updateMarkers);
  }
  if(document.readyState==='complete'){ setTimeout(init,300); }
  else { window.addEventListener('load',function(){ setTimeout(init,300); }); }
})();
</script>
"""
            body_end = html.lower().rfind("</body>")
            if body_end == -1:
                html += clean_script
            else:
                html = html[:body_end] + clean_script + html[body_end:]

            with open(self.temp_file_browser, "w", encoding="utf-8", newline="") as f:
                f.write(html)

            file_path = os.path.abspath(self.temp_file_browser)
            if sys.platform.startswith("win"):
                try:
                    os.startfile(file_path)
                except OSError:
                    webbrowser.open("file:///" + file_path.replace("\\", "/"))
            elif sys.platform == "darwin":
                subprocess.Popen(["open", file_path])
            else:
                subprocess.Popen(["xdg-open", file_path])
        except Exception:
            import traceback
            error_msg = traceback.format_exc()
            print(error_msg)
            QMessageBox.critical(self, "Ошибка",
                                 "Не удалось открыть предпросмотр в браузере:\n\n"
                                 + error_msg)

    def closeEvent(self, event):
        self.cleanup()
        event.accept()

    def cleanup(self):
        for path in (self.temp_file_editor, self.temp_file_browser):
            if path and os.path.isfile(path):
                try:
                    os.remove(path)
                except Exception:
                    pass


# ============================================================
#  Точка входа
# ============================================================
if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())