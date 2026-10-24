# launch_folders.py
# Контейнер папок: 6 нативных Qt-деревьев файлов на правой половине экрана.
# Сетка 3x2. 4 окна — корень проекта, 1 — scripts/, 1 — db/migrations/.
#
# Возможности:
#   • Строка пути над каждой плиткой — редактируется, Enter = перейти.
#   • Кнопка «+» — создать новый файл в текущей папке, сразу открыть в NPP.
#   • Двойной клик по файлу — открыть в Notepad++ (или системный редактор).
#   • Правый клик по объекту → «Удалить» → подтверждение.
#   • Перетаскивание файлов/папок мышью между плитками и внутри дерева
#     (ЛКМ удержать + тянуть). По умолчанию — ПЕРЕМЕЩЕНИЕ, Ctrl — КОПИРОВАНИЕ.
#     Перед выполнением операции спрашивается подтверждение.
#   • Сворачивание ВСЕГО контейнера в тонкую полоску поверх экрана:
#     кнопка «▼ Свернуть» в тулбаре, пункт меню «Вид» или Ctrl+M.
#     Развёртывание — обратно той же кнопкой «▲ Развернуть» или Ctrl+M.
#   • Режим «Поверх всех окон» — Ctrl+T (полезно, когда контейнер свёрнут).
#   • ПЕРЕМЕЩЕНИЕ ОКНА: захватить мышью за «ручку» ⣿⣿⣿ в начале тулбара,
#     за пустое место в тулбаре или за пустое место в панели меню — и тянуть.
#     Работает и в свёрнутом виде.
#
# БЕЗ Explorer, БЕЗ SetParent, БЕЗ админ-прав.

import os
import sys
import ctypes
import shutil
import subprocess
from PyQt5.QtWidgets import (
    QApplication, QMainWindow, QWidget, QGridLayout,
    QTreeView, QFileSystemModel, QHeaderView, QGroupBox,
    QVBoxLayout, QHBoxLayout, QLineEdit, QPushButton,
    QMessageBox, QInputDialog, QAction, QMenu, QAbstractItemView,
    QShortcut, QLabel, QToolBar,
)
from PyQt5.QtCore import Qt, QDir, QModelIndex, QPoint, QEvent
from PyQt5.QtGui import QFont, QPalette, QColor, QKeySequence

# ------------------------------------------------------------
# Конфигурация
# ------------------------------------------------------------
PROJECT_DIR = r'C:\Users\TD\Desktop\heart'

SCRIPTS_DIR    = os.path.join(PROJECT_DIR, 'scripts')
MIGRATIONS_DIR = os.path.join(PROJECT_DIR, 'db', 'migrations')

# (заголовок, стартовый путь к папке)
FOLDERS = [
    ('root-1',      PROJECT_DIR),
    ('root-2',      PROJECT_DIR),
    ('root-3',      PROJECT_DIR),
    ('root-4',      PROJECT_DIR),
    ('scripts',     SCRIPTS_DIR),
    ('migrations',  MIGRATIONS_DIR),
]

# Высота свёрнутой полоски (меню + тулбар + запас).
COLLAPSED_HEIGHT = 60
# «Максимально возможная» высота окна (QWIDGETSIZE_MAX).
EXPANDED_HEIGHT  = 16777215


# ------------------------------------------------------------
# Вспомогательное: «путь внутри родителя?»
# ------------------------------------------------------------
def _is_inside(path: str, parent: str) -> bool:
    """True, если path === parent или path лежит внутри parent."""
    try:
        p = os.path.normcase(os.path.abspath(path)).rstrip('\\/')
        q = os.path.normcase(os.path.abspath(parent)).rstrip('\\/')
        return p == q or p.startswith(q + os.sep)
    except Exception:
        return False


# ------------------------------------------------------------
# Notepad++ (поиск по стандартным путям)
# ------------------------------------------------------------
def find_notepad_plus_plus():
    candidates = [
        r'C:\Program Files\Notepad++\notepad++.exe',
        r'C:\Program Files (x86)\Notepad++\notepad++.exe',
        os.path.join(os.environ.get('LOCALAPPDATA', ''),
                     r'Programs\Notepad++\notepad++.exe'),
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    return None


NPP_PATH = find_notepad_plus_plus()


# ------------------------------------------------------------
# DPI awareness
# ------------------------------------------------------------
def set_dpi_aware():
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except AttributeError:
        ctypes.windll.user32.SetProcessDPIAware()


# ------------------------------------------------------------
# Дерево с подтверждением перетаскивания
# ------------------------------------------------------------
class TileTreeView(QTreeView):
    """QTreeView с drag-and-drop и подтверждением операции."""

    def __init__(self, parent=None, on_drop_confirm=None):
        super().__init__(parent)
        self.on_drop_confirm = on_drop_confirm

    def _target_dir_from_pos(self, pos):
        idx = self.indexAt(pos)
        if idx.isValid():
            p = self.model().filePath(idx)
            if os.path.isdir(p):
                return p
            return os.path.dirname(p) or p
        return self.model().filePath(self.rootIndex())

    def dropEvent(self, event):
        mime = event.mimeData()
        if not mime.hasUrls():
            event.ignore()
            return

        sources = []
        for url in mime.urls():
            if url.isLocalFile():
                p = url.toLocalFile()
                if p and os.path.exists(p):
                    sources.append(p)
        if not sources:
            event.ignore()
            return

        target = self._target_dir_from_pos(event.pos())

        for src in sources:
            if _is_inside(target, src):
                QMessageBox.warning(
                    self, "Недопустимое перемещение",
                    f"Нельзя переместить папку внутрь себя:\n{src}\n→ {target}"
                )
                event.ignore()
                return

        proposed = event.proposedAction()
        if proposed == Qt.IgnoreAction:
            proposed = Qt.MoveAction

        if self.on_drop_confirm:
            ok, action = self.on_drop_confirm(sources, target, proposed)
            if not ok:
                event.ignore()
                return
            event.setDropAction(action)
            event.accept()
            super().dropEvent(event)
        else:
            super().dropEvent(event)


# ------------------------------------------------------------
# Данные плитки
# ------------------------------------------------------------
class Tile:
    def __init__(self, title, path):
        self.title = title
        self.path = path
        self.group = None
        self.view = None
        self.path_edit = None


# ------------------------------------------------------------
# Главное окно
# ------------------------------------------------------------
class ContainerWindow(QMainWindow):
    def __init__(self):
        super().__init__()

        self.rows = 3
        self.cols = 2
        self.tiles = []
        self.fs_model = None

        # ── Состояние сворачивания ────────────────────────────
        self.is_collapsed = False
        self._saved_geometry = None
        self._saved_state = None
        self._always_on_top = False

        # ── Состояние перетаскивания окна ─────────────────────
        self._drag_offset = None          # QPoint — смещение курсора внутри окна
        self._toolbar = None              # ссылка на тулбар
        self._drag_handle = None          # визуальная «ручка»

        self.init_model()
        self.init_ui()
        self.setup_menus()
        self.setup_toolbar()
        self.setup_shortcuts()

        if NPP_PATH:
            self.statusBar().showMessage(
                f"Notepad++: {NPP_PATH}   |   Тяни мышью — перемещение, "
                f"Ctrl+тяни — копирование   |   Ctrl+M — свернуть, Ctrl+T — поверх окон"
            )
        else:
            self.statusBar().showMessage(
                "Notepad++ не найден — файлы откроются системным редактором"
            )

    # ---------- Модель ФС ----------
    def init_model(self):
        self.fs_model = QFileSystemModel(self)
        self.fs_model.setFilter(
            QDir.AllEntries | QDir.NoDotAndDotDot | QDir.DirsFirst
        )
        self.fs_model.setRootPath('')
        self.fs_model.setReadOnly(False)  # нужен для move/copy при drop

    # ---------- UI ----------
    def init_ui(self):
        self.setWindowTitle("Контейнер папок — heart workspace")
        self.setGeometry(0, 0, 800, 600)

        self.container = QWidget()
        self.container.setStyleSheet("background-color: #2b2b2b;")
        self.setCentralWidget(self.container)

        self.grid_layout = QGridLayout(self.container)
        self.grid_layout.setContentsMargins(4, 4, 4, 4)
        self.grid_layout.setSpacing(4)

        self._build_tiles()

    def _build_tiles(self):
        old_paths = {t.title: t.path for t in self.tiles}

        while self.grid_layout.count():
            item = self.grid_layout.takeAt(0)
            w = item.widget()
            if w is not None:
                w.deleteLater()
        self.tiles.clear()

        for i, (title, default_path) in enumerate(FOLDERS):
            path = old_paths.get(title, default_path)
            tile = Tile(title, path)
            group = self._make_tile(tile)
            row = i // self.cols
            col = i % self.cols
            self.grid_layout.addWidget(group, row, col)
            self.tiles.append(tile)

    def _make_tile(self, tile: Tile):
        group = QGroupBox(tile.title)
        group.setStyleSheet(
            "QGroupBox { "
            "  color: #d0d0d0; "
            "  border: 1px solid #555; "
            "  border-radius: 3px; "
            "  margin-top: 8px; "
            "  font-size: 11px; "
            "} "
            "QGroupBox::title { "
            "  subcontrol-origin: margin; "
            "  left: 6px; "
            "  padding: 0 4px; "
            "  color: #9cdcfe; "
            "}"
        )

        outer = QVBoxLayout(group)
        outer.setContentsMargins(2, 2, 2, 2)
        outer.setSpacing(2)

        # ── Строка пути + кнопка «+» ───────────────────────────
        path_row = QHBoxLayout()
        path_row.setContentsMargins(0, 0, 0, 0)
        path_row.setSpacing(2)

        path_edit = QLineEdit(tile.path)
        path_edit.setFont(QFont("Consolas", 8))
        path_edit.setToolTip("Путь к папке. Enter — перейти.")
        path_edit.setStyleSheet(
            "QLineEdit { "
            "  background-color: #1e1e1e; "
            "  color: #d0d0d0; "
            "  border: 1px solid #3c3c3c; "
            "  padding: 2px 4px; "
            "  border-radius: 2px; "
            "} "
            "QLineEdit:focus { border: 1px solid #264f78; }"
        )

        btn_new = QPushButton("+")
        btn_new.setFixedWidth(22)
        btn_new.setFixedHeight(20)
        btn_new.setToolTip("Новый файл в этой папке")
        btn_new.setStyleSheet(
            "QPushButton { "
            "  background-color: #2d2d2d; "
            "  color: #d0d0d0; "
            "  border: 1px solid #3c3c3c; "
            "  border-radius: 2px; "
            "  font-weight: bold; "
            "  padding: 0; "
            "} "
            "QPushButton:hover { background-color: #3c3c3c; } "
            "QPushButton:pressed { background-color: #264f78; color: #fff; }"
        )

        path_row.addWidget(path_edit, 1)
        path_row.addWidget(btn_new, 0)
        outer.addLayout(path_row)

        # ── Дерево ─────────────────────────────────────────────
        view = TileTreeView(
            on_drop_confirm=lambda src, tgt, act, t=tile:
                self._confirm_drop(t, src, tgt, act)
        )
        view.setModel(self.fs_model)
        view.setRootIndex(self.fs_model.index(tile.path))

        view.setAnimated(False)
        view.setIndentation(12)
        view.setUniformRowHeights(True)
        view.setEditTriggers(QTreeView.NoEditTriggers)
        view.setSortingEnabled(False)
        view.setHeaderHidden(True)
        view.setAlternatingRowColors(False)
        view.setExpandsOnDoubleClick(True)
        view.setFont(QFont("Segoe UI", 8))
        view.setContextMenuPolicy(Qt.CustomContextMenu)

        # ── Drag & Drop ───────────────────────────────────────
        view.setSelectionMode(QAbstractItemView.ExtendedSelection)
        view.setDragEnabled(True)
        view.setAcceptDrops(True)
        view.setDropIndicatorShown(True)
        view.setDragDropMode(QAbstractItemView.DragDrop)
        view.setDefaultDropAction(Qt.MoveAction)
        view.setDragDropOverwriteMode(False)
        view.setToolTip(
            "Тяни ЛКМ, чтобы переместить файл/папку.\n"
            "Ctrl+тяни — копирование."
        )

        pal = view.palette()
        pal.setColor(QPalette.Base, QColor('#1e1e1e'))
        pal.setColor(QPalette.AlternateBase, QColor('#1e1e1e'))
        pal.setColor(QPalette.Text, QColor('#d0d0d0'))
        pal.setColor(QPalette.Window, QColor('#1e1e1e'))
        pal.setColor(QPalette.WindowText, QColor('#d0d0d0'))
        pal.setColor(QPalette.Highlight, QColor('#264f78'))
        pal.setColor(QPalette.HighlightedText, QColor('#ffffff'))
        view.setPalette(pal)

        for c in (1, 2, 3):
            view.setColumnHidden(c, True)
        view.header().setSectionResizeMode(0, QHeaderView.Stretch)

        view.setStyleSheet(
            "QTreeView { "
            "  background-color: #1e1e1e; "
            "  color: #d0d0d0; "
            "  border: none; "
            "  selection-background-color: #264f78; "
            "  selection-color: #ffffff; "
            "  outline: none; "
            "} "
            "QTreeView::item { background-color: #1e1e1e; color: #d0d0d0; } "
            "QTreeView::item:hover { background-color: #2a2d2e; } "
            "QTreeView::item:selected { "
            "  background-color: #264f78; color: #ffffff; }"
        )

        view.doubleClicked.connect(self._on_double_click)
        view.customContextMenuRequested.connect(
            lambda pos, t=tile: self._on_context_menu(t, pos)
        )

        outer.addWidget(view, 1)

        tile.group = group
        tile.view = view
        tile.path_edit = path_edit

        path_edit.returnPressed.connect(lambda t=tile: self._on_path_changed(t))
        btn_new.clicked.connect(lambda _=False, t=tile: self._on_new_file(t))

        return group

    # ---------- Подтверждение drop ----------
    def _confirm_drop(self, tile: Tile, sources, target, action):
        is_copy = (action == Qt.CopyAction)
        verb = 'КОПИРОВАТЬ' if is_copy else 'ПЕРЕМЕСТИТЬ'

        src_lines = []
        for p in sources[:8]:
            src_lines.append(os.path.basename(p.rstrip('\\/')) or p)
        if len(sources) > 8:
            src_lines.append(f"… и ещё {len(sources) - 8}")

        msg = (
            f"{verb} {len(sources)} объект(ов)?\n\n"
            f"Куда:\n{target}\n\n"
            f"Что:\n  " + "\n  ".join(src_lines)
        )

        conflicts = []
        for p in sources:
            name = os.path.basename(p.rstrip('\\/'))
            if name and os.path.exists(os.path.join(target, name)):
                conflicts.append(name)
        if conflicts and not is_copy:
            msg += (
                "\n\n⚠ В целевой папке уже есть файлы с такими именами:\n  "
                + ", ".join(conflicts[:5])
            )

        box = QMessageBox(self)
        box.setWindowTitle("Подтверждение операции")
        box.setIcon(QMessageBox.Question)
        box.setText(msg)
        yes_primary = box.addButton(
            "Копировать" if is_copy else "Переместить", QMessageBox.YesRole
        )
        yes_cp = box.addButton("Копировать", QMessageBox.ActionRole)
        no_btn = box.addButton("Отмена", QMessageBox.RejectRole)
        box.setDefaultButton(no_btn)
        box.exec_()

        clicked = box.clickedButton()
        if clicked is no_btn:
            return False, Qt.IgnoreAction
        if clicked is yes_cp:
            return True, Qt.CopyAction
        return True, (Qt.CopyAction if is_copy else Qt.MoveAction)

    # ---------- Изменение пути ----------
    def _on_path_changed(self, tile: Tile):
        raw = tile.path_edit.text().strip()
        new_path = raw.strip('"').strip("'")
        if not new_path:
            tile.path_edit.setText(tile.path)
            return

        if not os.path.isdir(new_path):
            QMessageBox.warning(
                self, "Папка не найдена",
                f"Путь не существует:\n{new_path}"
            )
            tile.path_edit.setText(tile.path)
            return

        tile.path = new_path
        tile.path_edit.setText(new_path)
        tile.view.setRootIndex(self.fs_model.index(new_path))
        self.statusBar().showMessage(f"{tile.title}: {new_path}")

    # ---------- Создание файла ----------
    def _on_new_file(self, tile: Tile):
        name, ok = QInputDialog.getText(
            self, "Новый файл",
            f"Имя файла в папке:\n{tile.path}\n",
        )
        if not ok:
            return
        name = name.strip()
        if not name:
            return
        if '/' in name or '\\' in name:
            QMessageBox.warning(
                self, "Неверное имя",
                "Слэши в имени недопустимы. Введите имя файла без пути."
            )
            return

        full = os.path.join(tile.path, name)

        if os.path.exists(full):
            res = QMessageBox.question(
                self, "Файл уже существует",
                f"{full}\n\nОткрыть существующий?",
                QMessageBox.Yes | QMessageBox.No,
                QMessageBox.Yes,
            )
            if res == QMessageBox.Yes:
                self._open_in_editor(full)
            return

        try:
            open(full, 'x', encoding='utf-8').close()
        except Exception as e:
            QMessageBox.warning(self, "Ошибка создания", str(e))
            return

        self.fs_model.setRootPath(self.fs_model.rootPath() + '/')
        tile.view.setRootIndex(self.fs_model.index(tile.path))

        self._open_in_editor(full)
        self.statusBar().showMessage(f"Создан: {full}")

    # ---------- Двойной клик ----------
    def _on_double_click(self, index: QModelIndex):
        if not index.isValid():
            return
        path = self.fs_model.filePath(index)
        if os.path.isdir(path):
            return
        self._open_in_editor(path)

    def _open_in_editor(self, path: str):
        try:
            if NPP_PATH:
                subprocess.Popen([NPP_PATH, path], shell=False)
                self.statusBar().showMessage(f"Открыто в Notepad++: {path}")
            else:
                os.startfile(path)
                self.statusBar().showMessage(f"Открыто: {path}")
        except Exception as e:
            QMessageBox.warning(self, "Не удалось открыть", f"{path}\n\n{e}")

    # ---------- Контекстное меню ----------
    def _on_context_menu(self, tile: Tile, pos: QPoint):
        index = tile.view.indexAt(pos)
        if not index.isValid():
            return

        path = self.fs_model.filePath(index)
        is_dir = os.path.isdir(path)

        menu = QMenu(self)
        menu.setStyleSheet(
            "QMenu { "
            "  background-color: #2d2d2d; "
            "  color: #d0d0d0; "
            "  border: 1px solid #3c3c3c; "
            "} "
            "QMenu::item { padding: 4px 20px; } "
            "QMenu::item:selected { background-color: #264f78; color: #ffffff; }"
        )

        if is_dir:
            act_open = menu.addAction("Открыть в этой плитке")
            menu.addSeparator()
            act_delete = menu.addAction("Удалить папку")
        else:
            act_open = menu.addAction("Открыть в Notepad++")
            menu.addSeparator()
            act_delete = menu.addAction("Удалить файл")

        chosen = menu.exec_(tile.view.viewport().mapToGlobal(pos))
        if chosen is None:
            return

        if chosen == act_open:
            if is_dir:
                tile.path = path
                tile.path_edit.setText(path)
                tile.view.setRootIndex(self.fs_model.index(path))
                self.statusBar().showMessage(f"{tile.title}: {path}")
            else:
                self._open_in_editor(path)
        elif chosen == act_delete:
            self._confirm_delete(path, is_dir, tile)

    # ---------- Удаление ----------
    def _confirm_delete(self, path: str, is_dir: bool, tile: Tile):
        name = os.path.basename(path.rstrip('\\/')) or path

        if is_dir:
            try:
                items = os.listdir(path)
            except Exception as e:
                QMessageBox.critical(
                    self, "Ошибка доступа",
                    f"Не удалось прочитать содержимое:\n{path}\n\n{e}"
                )
                return

            n = len(items)
            if n == 0:
                msg = f"Удалить пустую папку?\n\n{path}"
            else:
                preview = ', '.join(items[:5])
                if n > 5:
                    preview += f", … (всего {n})"
                msg = (
                    f"Удалить ПАПКУ со всем содержимым?\n\n"
                    f"{path}\n\n"
                    f"Внутри ({n}): {preview}\n\n"
                    f"⚠ Действие необратимо."
                )
        else:
            try:
                size = os.path.getsize(path)
            except Exception:
                size = 0
            if size < 1024:
                size_str = f"{size} Б"
            elif size < 1024 * 1024:
                size_str = f"{size / 1024:.1f} КБ"
            else:
                size_str = f"{size / 1024 / 1024:.1f} МБ"
            msg = f"Удалить файл?\n\n{path}\n\nРазмер: {size_str}"

        reply = QMessageBox.question(
            self, "Подтверждение удаления", msg,
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No,
        )
        if reply != QMessageBox.Yes:
            return

        try:
            if is_dir:
                shutil.rmtree(path)
            else:
                os.remove(path)
        except Exception as e:
            QMessageBox.critical(self, "Ошибка удаления", f"{path}\n\n{e}")
            return

        self.fs_model.setRootPath(self.fs_model.rootPath() + '/')
        tile.view.setRootIndex(self.fs_model.index(tile.path))
        tile.view.viewport().update()

        self.statusBar().showMessage(f"Удалено: {path}")

    # ---------- Меню ----------
    def setup_menus(self):
        menubar = self.menuBar()

        view_menu = menubar.addMenu("Вид")

        # Свернуть / развернуть
        self.act_collapse = QAction("Свернуть контейнер", self)
        self.act_collapse.setShortcut(QKeySequence("Ctrl+M"))
        self.act_collapse.triggered.connect(self.toggle_collapse)
        view_menu.addAction(self.act_collapse)

        # Поверх всех окон
        self.act_on_top = QAction("Поверх всех окон", self)
        self.act_on_top.setShortcut(QKeySequence("Ctrl+T"))
        self.act_on_top.setCheckable(True)
        self.act_on_top.setChecked(False)
        self.act_on_top.toggled.connect(self.set_always_on_top)
        view_menu.addAction(self.act_on_top)

        view_menu.addSeparator()

        a = QAction("Изменить сетку (строки x столбцы)...", self)
        a.triggered.connect(self.change_grid)
        view_menu.addAction(a)

        a = QAction("Обновить (F5)", self)
        a.triggered.connect(self.refresh)
        view_menu.addAction(a)

        help_menu = menubar.addMenu("Справка")
        a = QAction("О программе", self)
        a.triggered.connect(self.about)
        help_menu.addAction(a)

        # Перетаскивание окна за пустое место панели меню.
        menubar.setMouseTracking(True)
        menubar.installEventFilter(self)

    def setup_toolbar(self):
        self._toolbar = QToolBar("Управление")
        self._toolbar.setMovable(False)
        self._toolbar.setFloatable(False)
        self.addToolBar(self._toolbar)

        # ── Ручка-«грип»: за неё удобно тащить окно ───────────
        self._drag_handle = QLabel("⣿⣿⣿")
        self._drag_handle.setToolTip(
            "Потяните мышью, чтобы переместить окно контейнера"
        )
        self._drag_handle.setCursor(Qt.SizeAllCursor)
        self._drag_handle.setStyleSheet(
            "QLabel { "
            "  color: #9a9a9a; "
            "  padding: 2px 8px 2px 4px; "
            "  font-size: 14px; "
            "  letter-spacing: 2px; "
            "} "
            "QLabel:hover { color: #dcdcdc; }"
        )
        self._drag_handle.installEventFilter(self)
        self._toolbar.addWidget(self._drag_handle)

        # Разделитель между ручкой и кнопками
        self._toolbar.addSeparator()

        btn = QPushButton("Обновить")
        btn.clicked.connect(self.refresh)
        self._toolbar.addWidget(btn)

        btn = QPushButton("Сетка")
        btn.clicked.connect(self.change_grid)
        self._toolbar.addWidget(btn)

        self._toolbar.addSeparator()

        # Кнопка сворачивания — всегда видна в тулбаре.
        self.btn_collapse = QPushButton("▼ Свернуть")
        self.btn_collapse.setToolTip("Свернуть весь контейнер в полоску (Ctrl+M)")
        self.btn_collapse.setStyleSheet(
            "QPushButton { "
            "  background-color: #264f78; "
            "  color: #ffffff; "
            "  border: 1px solid #3a6ea5; "
            "  border-radius: 2px; "
            "  padding: 2px 10px; "
            "  font-weight: bold; "
            "} "
            "QPushButton:hover { background-color: #2f5f8f; } "
            "QPushButton:pressed { background-color: #1d3f60; }"
        )
        self.btn_collapse.clicked.connect(self.toggle_collapse)
        self._toolbar.addWidget(self.btn_collapse)

        # Кнопка «поверх всех»
        self.btn_on_top = QPushButton("Поверх всех")
        self.btn_on_top.setToolTip("Держать контейнер поверх других окон (Ctrl+T)")
        self.btn_on_top.setCheckable(True)
        self.btn_on_top.setStyleSheet(
            "QPushButton { "
            "  background-color: #2d2d2d; "
            "  color: #d0d0d0; "
            "  border: 1px solid #3c3c3c; "
            "  border-radius: 2px; "
            "  padding: 2px 8px; "
            "} "
            "QPushButton:hover { background-color: #3c3c3c; } "
            "QPushButton:checked { "
            "  background-color: #264f78; color: #ffffff; "
            "  border: 1px solid #3a6ea5; "
            "}"
        )
        self.btn_on_top.toggled.connect(self.set_always_on_top)
        self._toolbar.addWidget(self.btn_on_top)

        # Пустое место тулбара тоже работает как зона захвата.
        self._toolbar.setMouseTracking(True)
        self._toolbar.installEventFilter(self)

    def setup_shortcuts(self):
        # Ctrl+M — свернуть/развернуть (дублирует меню и кнопку, но работает
        # даже когда фокус на дереве).
        QShortcut(QKeySequence("Ctrl+M"), self, activated=self.toggle_collapse)
        # F5 — обновить
        QShortcut(QKeySequence("F5"), self, activated=self.refresh)

    # ---------- Перетаскивание окна за верхнюю часть ----------
    def _drag_target(self, obj):
        """Возвращает True, если obj — «зона захвата» окна."""
        if obj is self._drag_handle:
            return True
        if obj is self._toolbar:
            # Тулбар получает событие только если под курсором нет дочернего
            # виджета (кнопки, разделителя, ручки). Значит, это пустое место.
            return True
        if obj is self.menuBar():
            # Панель меню получает событие при клике по пустому месту
            # (клик по пункту уходит в QAction/QMenu).
            return True
        return False

    def eventFilter(self, obj, event):
        et = event.type()
        if self._drag_target(obj):
            if et == QEvent.MouseButtonPress and event.button() == Qt.LeftButton:
                # Пропускаем клик по пунктам меню (иначе поломаем меню).
                if obj is self.menuBar():
                    act = self.menuBar().actionAt(event.pos())
                    if act is not None:
                        return False  # пусть Qt откроет меню
                self._drag_offset = event.globalPos() - self.geometry().topLeft()
                return True

            if et == QEvent.MouseMove and self._drag_offset is not None:
                if event.buttons() & Qt.LeftButton:
                    self.move(event.globalPos() - self._drag_offset)
                    return True
                else:
                    # Потеряли кнопку (например, отпустили вне окна) — сброс.
                    self._drag_offset = None

            if et == QEvent.MouseButtonRelease and self._drag_offset is not None:
                self._drag_offset = None
                return True

        return super().eventFilter(obj, event)

    # ---------- Сворачивание / разворачивание ----------
    def toggle_collapse(self):
        if not self.is_collapsed:
            self._collapse()
        else:
            self._expand()

    def _collapse(self):
        # Запоминаем текущую геометрию и состояние окна.
        self._saved_geometry = self.geometry()
        self._saved_state = self.windowState()

        # Скрываем всё, кроме меню и тулбара.
        self.centralWidget().hide()
        self.statusBar().hide()

        # Жёстко ограничиваем высоту полоской.
        self.setMaximumHeight(COLLAPSED_HEIGHT)
        self.setMinimumHeight(COLLAPSED_HEIGHT)
        self.resize(self.width(), COLLAPSED_HEIGHT)

        self.is_collapsed = True
        self.btn_collapse.setText("▲ Развернуть")
        self.btn_collapse.setToolTip(
            "Развернуть контейнер обратно на пол-экрана (Ctrl+M)"
        )
        self.act_collapse.setText("Развернуть контейнер")

        # Если окно было максимизировано — снимем максимизацию, иначе
        # максимизированное окно проигнорирует resize по высоте.
        if self._saved_state & Qt.WindowMaximized:
            self.showNormal()
            self.setGeometry(
                self._saved_geometry.x(),
                self._saved_geometry.y(),
                self._saved_geometry.width(),
                COLLAPSED_HEIGHT,
            )

        self.raise_()
        self.activateWindow()

    def _expand(self):
        self.is_collapsed = False

        # Снимаем ограничение высоты.
        self.setMaximumHeight(EXPANDED_HEIGHT)
        self.setMinimumHeight(0)

        # Показываем содержимое обратно.
        self.centralWidget().show()
        self.statusBar().show()

        # Восстанавливаем геометрию и состояние.
        if self._saved_geometry is not None:
            self.setGeometry(self._saved_geometry)
        if self._saved_state:
            self.setWindowState(self._saved_state)

        self.btn_collapse.setText("▼ Свернуть")
        self.btn_collapse.setToolTip("Свернуть весь контейнер в полоску (Ctrl+M)")
        self.act_collapse.setText("Свернуть контейнер")

        self.raise_()
        self.activateWindow()

    # ---------- Поверх всех окон ----------
    def set_always_on_top(self, checked: bool):
        if self._always_on_top == checked:
            return
        self._always_on_top = checked

        flags = self.windowFlags()
        if checked:
            flags |= Qt.WindowStaysOnTopHint
        else:
            flags &= ~Qt.WindowStaysOnTopHint

        # Синхронизируем чек-боксы, если вызов пришёл из одного из них.
        if self.act_on_top.isChecked() != checked:
            self.act_on_top.blockSignals(True)
            self.act_on_top.setChecked(checked)
            self.act_on_top.blockSignals(False)
        if self.btn_on_top.isChecked() != checked:
            self.btn_on_top.blockSignals(True)
            self.btn_on_top.setChecked(checked)
            self.btn_on_top.blockSignals(False)

        # Переприменяем флаги без потери геометрии.
        geo = self.geometry()
        self.setWindowFlags(flags)
        self.show()
        self.setGeometry(geo)
        if self.is_collapsed:
            # После show() Qt может восстановить «нормальную» высоту — вернём полоску.
            self.setMaximumHeight(COLLAPSED_HEIGHT)
            self.setMinimumHeight(COLLAPSED_HEIGHT)
            self.resize(geo.width(), COLLAPSED_HEIGHT)

    # ---------- Действия ----------
    def refresh(self):
        self.fs_model.setRootPath(self.fs_model.rootPath() + '/')
        for t in self.tiles:
            if t.view is not None:
                t.view.setRootIndex(self.fs_model.index(t.path))
                t.view.viewport().update()
        self.statusBar().showMessage("Обновлено")

    def change_grid(self):
        rows, ok1 = QInputDialog.getInt(
            self, "Сетка", "Количество строк:", self.rows, 1, 10
        )
        if not ok1:
            return
        cols, ok2 = QInputDialog.getInt(
            self, "Сетка", "Количество столбцов:", self.cols, 1, 10
        )
        if not ok2:
            return

        self.rows = rows
        self.cols = cols
        self._build_tiles()
        self.statusBar().showMessage(f"Сетка изменена: {self.rows}x{self.cols}")

    def about(self):
        npp = NPP_PATH if NPP_PATH else "не найден"
        QMessageBox.about(
            self, "О программе",
            "Контейнер папок — heart workspace\n"
            "6 нативных деревьев: 4 корня, scripts, db/migrations\n"
            f"Notepad++: {npp}\n"
            "Версия 3.4 (PyQt5 + QTreeView + drag&drop + сворачивание + drag окна)"
        )


# ------------------------------------------------------------
# Точка входа
# ------------------------------------------------------------
def main():
    set_dpi_aware()

    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    app.setFont(QFont("Segoe UI", 9))

    user32 = ctypes.windll.user32
    screen_width = user32.GetSystemMetrics(0)
    screen_height = user32.GetSystemMetrics(1)

    win_left = screen_width // 2
    win_top = 0
    win_width = screen_width // 2
    win_height = screen_height

    window = ContainerWindow()
    window.setGeometry(win_left, win_top, win_width, win_height)
    window.show()

    sys.exit(app.exec_())


if __name__ == "__main__":
    main()