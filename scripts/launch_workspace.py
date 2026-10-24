# launch_workspace.py
# Консольный контейнер для heart workspace в режиме Docker-only.
#
# Запуск:  python scripts/launch_workspace.py   (требует UAC)
#
# 8 ПЛИТОК (4x2):
#   web · ws · tsc · api-logs
#   infra-logs · ops · db · shell
#
# WORKFLOW после правки src/:
#   toolbar → «Пересобрать + Запустить»      (рекомендуется)
#   toolbar → «Запустить всё» (mtime-check — предложит пересобрать)
#   меню Docker → «Пересобрать api»           (без запуска задач)
#   меню Docker → «Docker ps»                 (диалог с таблицей)
#
# v2.4 (fix set_console_font):
#   - Дочерний процесс принудительно включает DPI-aware — иначе
#     SetCurrentConsoleFontEx виртуализуется и Y=10 на 150–200% DPI
#     даёт «большой» шрифт.
#   - GetStdHandle.restype = c_void_p — иначе на 64-bit Python HANDLE
#     обрезается до c_int и Get/SetCurrentConsoleFontEx тихо падают.
#   - Диагностика дочернего процесса пишется в
#     %TEMP%\heart_ws_setfont.log — сбой больше не «молчаливый».
#
# v2.3 (fix docker_ps):
#   - docker_ps: `docker ps --filter name=charter-` вместо `docker compose ps`
#     (compose ps без аргумента падал с WinError 6 на Windows + capture_output).
#   - QMessageBox(None) + fallback в notepad — для надёжности.
#   - QInputDialog(None) для «Сетки» — parent=None.
#   - setOverrideCursor убран — не нужен, меньше поверхностей для сбоя.

from __future__ import annotations

import os
import sys
import time
import ctypes
import datetime
import tempfile
import subprocess
import traceback

import win32gui
import win32con
import win32process
import win32api

from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QGridLayout,
                             QPushButton, QLabel, QMessageBox, QInputDialog,
                             QAction, QSizePolicy, QDialog, QVBoxLayout,
                             QHBoxLayout, QPlainTextEdit)
from PyQt5.QtCore import Qt, QTimer, QProcess
from PyQt5.QtGui import QFont


# ------------------------------------------------------------
# Конфигурация
# ------------------------------------------------------------
PROJECT_DIR    = r'C:\Users\TD\Desktop\heart'
COMPOSE_FILE   = 'docker/docker-compose.yml'
DOCKER_COMPOSE = f'docker compose -f {COMPOSE_FILE}'
BAT_PREFIX     = 'heart_ws_'
BAT_SUFFIX     = '.bat'
LOG_DIR        = os.path.join(PROJECT_DIR, 'logs', 'ws')
ENV_PATH       = os.path.join(PROJECT_DIR, '.env')
SRC_DIR        = os.path.join(PROJECT_DIR, 'src')
API_CONTAINER  = 'charter-api'

NO_WINDOW = subprocess.CREATE_NO_WINDOW


TASKS = [
    ('cmd', 'xartia-web',        'pnpm dev:web',                                              []),
    ('cmd', 'xartia-ws',         'pnpm tsx src/ws/server.ts',                                 [3001]),
    ('cmd', 'xartia-tsc',        'pnpm exec tsc --noEmit --watch --preserveWatchOutput',      []),
    ('cmd', 'xartia-api-logs',   f'{DOCKER_COMPOSE} logs -f --tail 200 api',                  []),
    ('cmd', 'xartia-infra-logs', f'{DOCKER_COMPOSE} logs -f --tail 100 postgres redis minio', []),
    ('cmd', 'xartia-ops',        r'call scripts\xartia-ops.bat',                              []),
    ('cmd', 'xartia-db',         f'{DOCKER_COMPOSE} exec postgres psql -U charter -d charter', []),
    ('cmd', 'xartia-shell',      f'{DOCKER_COMPOSE} exec api sh',                             []),
]


# ------------------------------------------------------------
# PowerShell / taskkill / docker helpers
# ------------------------------------------------------------
def _ps(command: str, timeout: int = 15) -> str:
    try:
        return subprocess.run(
            ['powershell', '-NoProfile', '-NonInteractive', '-Command', command],
            capture_output=True, text=True, timeout=timeout,
            stdin=subprocess.DEVNULL,
            creationflags=NO_WINDOW,
        ).stdout
    except Exception:
        return ''


def _taskkill(pid: int) -> bool:
    try:
        r = subprocess.run(
            ['taskkill', '/F', '/T', '/PID', str(pid)],
            capture_output=True, timeout=5,
            stdin=subprocess.DEVNULL,
            creationflags=NO_WINDOW,
        )
        return r.returncode == 0
    except Exception:
        return False


def _docker(*args: str, timeout: int = 60) -> tuple[int, str, str]:
    try:
        r = subprocess.run(
            ['docker', *args], capture_output=True, text=True,
            timeout=timeout,
            stdin=subprocess.DEVNULL,
            creationflags=NO_WINDOW, cwd=PROJECT_DIR,
        )
        return r.returncode, r.stdout, r.stderr
    except FileNotFoundError:
        return -1, '', 'docker not found'
    except subprocess.TimeoutExpired:
        return -1, '', 'timeout'
    except Exception as e:
        return -1, '', f'{type(e).__name__}: {e}'


def _compose(*args: str, timeout: int = 120) -> tuple[int, str, str]:
    return _docker('compose', '-f', COMPOSE_FILE, *args, timeout=timeout)


def docker_daemon_ok() -> bool:
    rc, _, _ = _docker('info', timeout=10)
    return rc == 0


def docker_api_status() -> str:
    rc, out, err = _compose('ps', 'api', timeout=20)
    if rc != 0:
        low = (err or '').lower()
        if 'cannot connect' in low or 'error during connect' in low:
            return 'no-daemon'
        return 'missing'
    if API_CONTAINER not in (out or ''):
        return 'missing'
    low = (out or '').lower()
    if 'unhealthy' in low:
        return 'unhealthy'
    if 'health: starting' in low or 'starting' in low:
        return 'starting'
    return 'healthy'


def wait_api_healthy(timeout: float = 90.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        st = docker_api_status()
        if st == 'healthy':
            return True
        if st in ('missing', 'no-daemon', 'unhealthy'):
            return False
        time.sleep(1.0)
    return docker_api_status() == 'healthy'


# ------------------------------------------------------------
# mtime-детектор
# ------------------------------------------------------------
def _src_mtime() -> float:
    if not os.path.isdir(SRC_DIR):
        return 0.0
    latest = 0.0
    for root, _, files in os.walk(SRC_DIR):
        for f in files:
            try:
                m = os.path.getmtime(os.path.join(root, f))
                if m > latest:
                    latest = m
            except OSError:
                pass
    return latest


def _container_created_ts() -> float:
    rc, out, _ = _docker('inspect', API_CONTAINER, '--format', '{{.Created}}', timeout=10)
    if rc != 0 or not out.strip():
        return 0.0
    s = out.strip().replace('Z', '+00:00')
    try:
        return datetime.datetime.fromisoformat(s).timestamp()
    except ValueError:
        return 0.0


def _src_is_stale() -> tuple[bool, float, float]:
    src_m = _src_mtime()
    ctr_m = _container_created_ts()
    return (src_m > ctr_m > 0, src_m, ctr_m)


def _fmt_ts(ts: float) -> str:
    if not ts:
        return '?'
    return datetime.datetime.fromtimestamp(ts).strftime('%d.%m %H:%M:%S')


# ------------------------------------------------------------
# Порты
# ------------------------------------------------------------
def _port_owners(port: int) -> list[dict]:
    try:
        out = subprocess.run(
            ['netstat', '-ano', '-p', 'tcp'],
            capture_output=True, text=True, timeout=10,
            creationflags=NO_WINDOW,
        ).stdout
    except Exception:
        return []

    pids: set[int] = set()
    for line in out.splitlines():
        if 'LISTENING' not in line:
            continue
        parts = line.split()
        if len(parts) < 5:
            continue
        local = parts[1]
        try:
            p = int(local.rsplit(':', 1)[-1])
        except (ValueError, IndexError):
            continue
        if p != port:
            continue
        try:
            pids.add(int(parts[-1]))
        except ValueError:
            continue

    if not pids:
        return []

    where = ' or '.join(f'ProcessId={p}' for p in pids)
    dump = _ps(
        f"Get-CimInstance Win32_Process -Filter '{where}' "
        "| Select-Object ProcessId,Name,CommandLine "
        "| ForEach-Object { \"$($_.ProcessId)|$($_.Name)|$($_.CommandLine)\" }"
    )

    owners: list[dict] = []
    for line in dump.splitlines():
        line = line.strip()
        if not line or '|' not in line:
            continue
        parts = line.split('|', 2)
        if len(parts) < 3:
            continue
        try:
            pid = int(parts[0])
        except ValueError:
            continue
        name, cmd = parts[1], parts[2] or ''
        low_name, low_cmd = name.lower(), cmd.lower()

        if low_name in ('com.docker.backend.exe', 'wslrelay.exe'):
            kind = 'docker'
        elif low_name in ('node.exe', 'tsx.exe', 'pnpm.exe', 'vite.exe') and (
            '\\heart\\' in low_cmd or '/heart/' in low_cmd
        ):
            kind = 'heart'
        elif low_name in ('node.exe', 'tsx.exe', 'pnpm.exe', 'vite.exe'):
            kind = 'node-other'
        else:
            kind = 'other'

        owners.append({'pid': pid, 'name': name, 'cmd': cmd, 'kind': kind})
    return owners


def _wait_port_free(port: int, timeout: float = 3.0) -> list[dict]:
    deadline = time.time() + timeout
    while time.time() < deadline:
        owners = _port_owners(port)
        if not owners:
            return []
        time.sleep(0.2)
    return _port_owners(port)


# ------------------------------------------------------------
# Sweep
# ------------------------------------------------------------
def sweep_orphan_cmds(keep_pids: set[int] | None = None) -> int:
    if keep_pids is None:
        keep_pids = set()
    out = _ps(
        "Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" "
        f"| Where-Object {{ $_.CommandLine -like '*{BAT_PREFIX}*' }} "
        "| Select-Object -ExpandProperty ProcessId"
    )
    killed = 0
    for line in out.splitlines():
        line = line.strip()
        if not line.isdigit():
            continue
        pid = int(line)
        if pid in keep_pids:
            continue
        if _taskkill(pid):
            killed += 1
    return killed


def sweep_heart_nodes() -> int:
    out = _ps(
        "Get-CimInstance Win32_Process "
        "| Where-Object { "
        "   ($_.Name -in @('node.exe','tsx.exe','pnpm.exe','vite.exe')) "
        "   -and ($_.CommandLine -like '*\\heart\\*' -or $_.CommandLine -like '*heart/node_modules*') "
        "} "
        "| Select-Object -ExpandProperty ProcessId"
    )
    killed = 0
    for line in out.splitlines():
        line = line.strip()
        if not line.isdigit():
            continue
        if _taskkill(int(line)):
            killed += 1
    return killed


def delete_old_bats() -> int:
    tmp = tempfile.gettempdir()
    removed = 0
    try:
        for f in os.listdir(tmp):
            if f.startswith(BAT_PREFIX) and f.endswith(BAT_SUFFIX):
                try:
                    os.remove(os.path.join(tmp, f))
                    removed += 1
                except OSError:
                    pass
    except OSError:
        pass
    return removed


def env_api_url_warn() -> str | None:
    try:
        with open(ENV_PATH, 'r', encoding='utf-8', errors='replace') as f:
            for line in f:
                line = line.strip()
                if line.startswith('API_URL='):
                    url = line.split('=', 1)[1]
                    if 'localhost' in url.lower():
                        return (
                            f"В .env: {line}\n"
                            "На Windows 'localhost' → [::1], Docker — 0.0.0.0.\n"
                            "Рекомендуется API_URL=http://127.0.0.1:3000"
                        )
                    return None
    except OSError:
        pass
    return None


# ------------------------------------------------------------
# DPI / admin
# ------------------------------------------------------------
def set_dpi_aware():
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except AttributeError:
        ctypes.windll.user32.SetProcessDPIAware()


def is_admin() -> bool:
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except Exception:
        return False


def run_as_admin():
    ctypes.windll.shell32.ShellExecuteW(
        None, "runas", sys.executable, " ".join(sys.argv), None, 1
    )


# ------------------------------------------------------------
# Окно по PID
# ------------------------------------------------------------
def find_window_by_pid(pid: int) -> int | None:
    hwnds: list[int] = []

    def cb(hwnd, _):
        if win32gui.IsWindowVisible(hwnd):
            _, fp = win32process.GetWindowThreadProcessId(hwnd)
            if fp == pid:
                hwnds.append(hwnd)
        return True

    win32gui.EnumWindows(cb, None)
    return hwnds[0] if hwnds else None


# ------------------------------------------------------------
# Шрифт консоли
# ------------------------------------------------------------
_FONT_LOG = os.path.join(tempfile.gettempdir(), 'heart_ws_setfont.log')

# Child-процесс:
#   1) Включает DPI-aware, иначе SetCurrentConsoleFontEx виртуализуется
#      и Y=10 на 150–200% DPI даёт «большой» шрифт.
#   2) Ставит restype=c_void_p для GetStdHandle — иначе на 64-bit Python
#      HANDLE обрезается до c_int и Get/SetCurrentConsoleFontEx тихо падают.
#   3) Пишет результат в stderr → parent редиректит в %TEMP%\heart_ws_setfont.log,
#      чтобы сбой не был «молчаливым».
_SET_FONT_SCRIPT = '''
import ctypes
import sys
from ctypes import wintypes

def _err(msg):
    try:
        sys.stderr.write(msg + "\\n")
        sys.stderr.flush()
    except Exception:
        pass

try:
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass

    k = ctypes.WinDLL("kernel32", use_last_error=True)

    class COORD(ctypes.Structure):
        _fields_ = [("X", ctypes.c_short), ("Y", ctypes.c_short)]

    class CONSOLE_FONT_INFOEX(ctypes.Structure):
        _fields_ = [
            ("cbSize", wintypes.ULONG),
            ("nFont", wintypes.ULONG),
            ("dwFontSize", COORD),
            ("FontFamily", wintypes.UINT),
            ("FontWeight", wintypes.UINT),
            ("FaceName", ctypes.c_wchar * 32),
        ]

    k.AttachConsole.argtypes = [wintypes.DWORD]
    k.AttachConsole.restype  = wintypes.BOOL
    k.FreeConsole.argtypes   = []
    k.FreeConsole.restype    = wintypes.BOOL
    k.CreateFileW.argtypes   = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD,
                                wintypes.HANDLE]
    k.CreateFileW.restype    = wintypes.HANDLE
    k.GetCurrentConsoleFontEx.argtypes = [wintypes.HANDLE, wintypes.BOOL,
                                          ctypes.POINTER(CONSOLE_FONT_INFOEX)]
    k.GetCurrentConsoleFontEx.restype  = wintypes.BOOL
    k.SetCurrentConsoleFontEx.argtypes = [wintypes.HANDLE, wintypes.BOOL,
                                          ctypes.POINTER(CONSOLE_FONT_INFOEX)]
    k.SetCurrentConsoleFontEx.restype  = wintypes.BOOL
    k.CloseHandle.argtypes   = [wintypes.HANDLE]
    k.CloseHandle.restype    = wintypes.BOOL

    k.FreeConsole()
    if not k.AttachConsole({pid}):
        _err("AttachConsole failed err=%d" % ctypes.get_last_error())
        sys.exit(1)

    # ВАЖНО: GetStdHandle(-11) НЕ ГОДИТСЯ. Родитель запустил нас с
    # stdout=лог-файл; AttachConsole std-хендлы не перезаписывает.
    # Открываем консоль target-процесса явно через CONOUT$.
    GENERIC_READ, GENERIC_WRITE       = 0x80000000, 0x40000000
    FILE_SHARE_READ, FILE_SHARE_WRITE = 0x01, 0x02
    OPEN_EXISTING                     = 3
    INVALID = ctypes.c_void_p(-1).value

    h = k.CreateFileW(
        "CONOUT$",
        GENERIC_READ | GENERIC_WRITE,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        None, OPEN_EXISTING, 0, None,
    )
    if not h or h == INVALID or h == -1:
        _err("CreateFile(CONOUT$) failed err=%d" % ctypes.get_last_error())
        k.FreeConsole()
        sys.exit(1)

    info = CONSOLE_FONT_INFOEX()
    info.cbSize = ctypes.sizeof(CONSOLE_FONT_INFOEX)
    if not k.GetCurrentConsoleFontEx(h, False, ctypes.byref(info)):
        _err("GetCurrentConsoleFontEx err=%d" % ctypes.get_last_error())
        k.CloseHandle(h); k.FreeConsole(); sys.exit(1)

    old_y    = info.dwFontSize.Y
    old_face = info.FaceName
    info.dwFontSize.Y = {font_size}
    info.dwFontSize.X = 0
    if not k.SetCurrentConsoleFontEx(h, False, ctypes.byref(info)):
        _err("SetCurrentConsoleFontEx err=%d old_y=%d old_face=%r new_y=%d" % (
            ctypes.get_last_error(), old_y, old_face, {font_size}))
        k.CloseHandle(h); k.FreeConsole(); sys.exit(1)

    # Проверяем, что Windows не «клампнула» размер (raster fonts!)
    verify = CONSOLE_FONT_INFOEX()
    verify.cbSize = ctypes.sizeof(CONSOLE_FONT_INFOEX)
    actual_y = -1
    if k.GetCurrentConsoleFontEx(h, False, ctypes.byref(verify)):
        actual_y = verify.dwFontSize.Y

    _err("OK old_y=%d old_face=%r new_y=%d actual_y=%d" % (
        old_y, old_face, {font_size}, actual_y))
    k.CloseHandle(h)
    k.FreeConsole()
except Exception:
    import traceback
    _err(traceback.format_exc())
    sys.exit(1)
'''


def set_console_font(hwnd: int, font_size: int) -> bool:
    """Установить размер шрифта в консоли чужого окна.

    ВАЖНО: FreeConsole/AttachConsole выполняются в ДОЧЕРНЕМ процессе,
    чтобы не отвязывать родителя от его консоли. Иначе sys.stdin/stdout
    родителя становятся мёртвыми, и subprocess.run(..., capture_output=True)
    падает с WinError 6 (ERROR_INVALID_HANDLE) на любой команде (docker,
    powershell, taskkill).

    Дочерний процесс принудительно включает DPI-aware и пишет диагностику
    в %TEMP%\\heart_ws_setfont.log — иначе сбой был бы «молчаливым».
    """
    _, pid = win32process.GetWindowThreadProcessId(hwnd)
    if not pid:
        return False
    try:
        with open(_FONT_LOG, 'a', encoding='utf-8') as log:
            log.write(
                f"\n=== pid={pid} size={font_size} "
                f"{time.strftime('%H:%M:%S')} ===\n"
            )
            log.flush()
            subprocess.Popen(
                [sys.executable, '-c',
                 _SET_FONT_SCRIPT.format(pid=pid, font_size=font_size)],
                creationflags=subprocess.CREATE_NO_WINDOW,
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=log,
            )
        return True
    except Exception as e:
        try:
            with open(_FONT_LOG, 'a', encoding='utf-8') as f:
                f.write(f"parent EXC: {type(e).__name__}: {e}\n")
        except Exception:
            pass
        return False


# ------------------------------------------------------------
# ConsoleProcess
# ------------------------------------------------------------
class ConsoleProcess:
    def __init__(self, shell_type: str, title: str, command: str, ports: list[int]):
        self.shell_type = shell_type
        self.title = title
        self.command = command
        self.ports = list(ports or [])
        self.proc: subprocess.Popen | None = None
        self.hwnd: int | None = None
        self.embedded = False
        self.err_log = ''
        self.launch_error: str | None = None


# ------------------------------------------------------------
# Главное окно
# ------------------------------------------------------------
class ContainerWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.processes: list[ConsoleProcess] = []
        self.rows = 4
        self.cols = 2
        self.embed_timer: QTimer | None = None
        self._bat_files: list[str] = []

        self.build_proc: QProcess | None = None
        self._build_output: list[str] = []
        self._pending_start_after_build = False
        self._healthy_timer: QTimer | None = None
        self._healthy_deadline = 0.0

        self.init_ui()
        self.setup_menus()
        self.setup_toolbar()
        self.statusBar().showMessage("Готов (Docker-only)")

    # ---------- UI ----------
    def init_ui(self):
        self.setWindowTitle("Консольный контейнер — heart (Docker-only)")
        self.setGeometry(0, 0, 800, 700)

        self.container = QWidget()
        self.container.setAttribute(Qt.WA_NativeWindow)
        self.container.setStyleSheet("background-color: #2b2b2b;")
        self.setCentralWidget(self.container)

        self.grid_layout = QGridLayout(self.container)
        self.grid_layout.setContentsMargins(0, 0, 0, 0)
        self.grid_layout.setSpacing(2)

        self.cell_widgets: list[QLabel] = []
        self._rebuild_placeholders()
        self.container.installEventFilter(self)

    def _rebuild_placeholders(self):
        for w in self.cell_widgets:
            self.grid_layout.removeWidget(w)
            w.deleteLater()
        self.cell_widgets = []
        for i in range(self.rows * self.cols):
            label = QLabel(f"Ожидание окна {i + 1}")
            label.setAlignment(Qt.AlignCenter)
            label.setStyleSheet(
                "color: white; background-color: #3c3c3c; border: 1px solid #555;"
            )
            label.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
            self.cell_widgets.append(label)
            self.grid_layout.addWidget(label, i // self.cols, i % self.cols)

    def eventFilter(self, obj, event):
        if obj == self.container and event.type() == event.Resize:
            self.rearrange_children()
        return super().eventFilter(obj, event)

    def setup_menus(self):
        menubar = self.menuBar()

        proc = menubar.addMenu("Процессы")
        for label, slot in [
            ("Запустить все",  self.start_all_processes),
            ("Остановить все", self.terminate_all_processes),
        ]:
            a = QAction(label, self); a.triggered.connect(slot); proc.addAction(a)

        dk = menubar.addMenu("Docker")
        for label, slot in [
            ("Пересобрать + Запустить всё", self.docker_rebuild_and_start),
            ("Пересобрать api",             self.docker_rebuild_api),
            ("Рестарт api",                 self.docker_restart_api),
            ("Stop api",                    self.docker_stop_api),
            ("Start api",                   self.docker_start_api),
            ("Docker ps",                   self.docker_ps),
            ("Открыть shell в api",         self.open_api_shell),
        ]:
            a = QAction(label, self); a.triggered.connect(slot); dk.addAction(a)

        view = menubar.addMenu("Вид")
        a = QAction("Изменить сетку...", self); a.triggered.connect(self.change_grid); view.addAction(a)

        help_ = menubar.addMenu("Справка")
        a = QAction("О программе", self); a.triggered.connect(self.about); help_.addAction(a)

    def setup_toolbar(self):
        tb = self.addToolBar("Управление")
        tb.setMovable(False)
        for label, slot in [
            ("Пересобрать + Запустить", self.docker_rebuild_and_start),
            ("Запустить всё",           self.start_all_processes),
            ("Остановить всё",          self.terminate_all_processes),
            ("Docker ps",               self.docker_ps),
            ("Сетка",                   self.change_grid),
        ]:
            b = QPushButton(label); b.clicked.connect(slot); tb.addWidget(b)

    # ---------- HELPER: показать текст (QMessageBox → notepad) ----------
    def _show_text_window(self, title: str, text: str):
        """Показать текст. QMessageBox.detailedText; fallback — notepad."""
        try:
            msg = QMessageBox(None)
            msg.setWindowTitle(title)
            n = len(text.splitlines())
            msg.setText(f"{n} строк — нажмите «Show Details»")
            msg.setDetailedText(text)
            msg.setStyleSheet(
                "QTextEdit { font-family: Consolas, 'Courier New', monospace; font-size: 9pt; }"
            )
            msg.exec_()
        except Exception:
            try:
                path = os.path.join(tempfile.gettempdir(), f'{title.replace(" ", "_")}.txt')
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(text)
                os.startfile(path)
            except Exception:
                try:
                    QMessageBox.critical(None, "Ошибка", traceback.format_exc())
                except Exception:
                    pass

    def _safe_msg(self, title: str, text: str):
        """QMessageBox(None) → notepad."""
        try:
            QMessageBox.critical(None, title, text)
        except Exception:
            self._show_text_window(title, text)

    # ---------- BUILD via QProcess ----------
    def _start_build_process(self, then_start: bool) -> bool:
        if self.build_proc is not None:
            QMessageBox.information(self, "Уже идёт", "Сборка уже выполняется.")
            return False

        self._pending_start_after_build = then_start
        self._build_output = []
        self.build_proc = QProcess(self)
        self.build_proc.setWorkingDirectory(PROJECT_DIR)
        self.build_proc.setProcessChannelMode(QProcess.MergedChannels)
        self.build_proc.readyReadStandardOutput.connect(self._on_build_output)
        self.build_proc.finished.connect(self._on_build_finished)

        self.statusBar().showMessage("Сборка api...")
        self.build_proc.start('docker', [
            'compose', '-f', COMPOSE_FILE, 'up', '-d', '--build', 'api',
        ])
        return True

    def _on_build_output(self):
        if self.build_proc is None:
            return
        data = bytes(self.build_proc.readAllStandardOutput()).decode('utf-8', 'replace')
        self._build_output.append(data)
        lines = [ln for ln in data.splitlines() if ln.strip()]
        if lines:
            self.statusBar().showMessage(f"build: {lines[-1][:110]}")

    def _on_build_finished(self, exit_code: int, _exit_status):
        output = ''.join(self._build_output)
        self._build_output = []
        self.build_proc = None

        if exit_code != 0:
            tail = '\n'.join(output.splitlines()[-30:])
            self._show_text_window(
                f"Сборка api упала (exit {exit_code})",
                tail,
            )
            self._pending_start_after_build = False
            self.statusBar().showMessage("Сборка api упала — см. диалог")
            return

        self.statusBar().showMessage("Сборка OK, ждём healthy charter-api...")
        self._healthy_deadline = time.time() + 90.0
        if self._healthy_timer is not None:
            self._healthy_timer.stop()
        self._healthy_timer = QTimer(self)
        self._healthy_timer.timeout.connect(self._check_healthy_after_build)
        self._healthy_timer.start(1000)

    def _check_healthy_after_build(self):
        st = docker_api_status()
        if st == 'healthy':
            if self._healthy_timer is not None:
                self._healthy_timer.stop()
                self._healthy_timer = None
            self.statusBar().showMessage("api healthy")
            if self._pending_start_after_build:
                self._pending_start_after_build = False
                self.start_all_processes(skip_stale_check=True)
        elif st in ('missing', 'no-daemon', 'unhealthy') or time.time() > self._healthy_deadline:
            if self._healthy_timer is not None:
                self._healthy_timer.stop()
                self._healthy_timer = None
            QMessageBox.warning(
                self, "api не healthy",
                f"Статус: {st}\nСмотрите окно xartia-api-logs.",
            )
            self._pending_start_after_build = False

    # ---------- Docker actions ----------
    def docker_rebuild_and_start(self):
        if self.build_proc is not None:
            QMessageBox.information(self, "Уже идёт", "Сборка уже выполняется.")
            return
        self.terminate_all_processes()
        self.processes.clear()
        self._add_configured_processes()
        self._start_build_process(then_start=True)

    def docker_rebuild_api(self):
        self._start_build_process(then_start=False)

    def docker_restart_api(self):
        self.statusBar().showMessage("Рестарт api...")
        rc, _, err = _compose('restart', 'api', timeout=60)
        if rc != 0:
            self._safe_msg("restart api", err or "unknown")
            return
        self.statusBar().showMessage("api перезапущен (без пересборки)")

    def docker_stop_api(self):
        rc, _, err = _compose('stop', 'api', timeout=60)
        if rc != 0:
            self._safe_msg("stop api", err or "unknown")
            return
        self.statusBar().showMessage("api остановлен")

    def docker_start_api(self):
        rc, _, err = _compose('up', '-d', 'api', timeout=180)
        if rc != 0:
            self._safe_msg("start api", err or "unknown")
            return
        self.statusBar().showMessage("api запущен (без пересборки)")

    def docker_ps(self):
        """docker ps --filter name=charter-* — без compose-ps TTY-detection.

        `docker compose ps` (без аргумента) на Windows с capture_output=True
        падает с WinError 6 (ERROR_INVALID_HANDLE) при TTY-detection.
        Плоский `docker ps --filter name=charter-` этой проблемы не имеет.
        """
        try:
            rc, out, err = _docker(
                'ps',
                '--filter', 'name=charter-',
                '--format', 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}',
                timeout=15,
            )
        except Exception:
            self._show_text_window("docker ps: exception", traceback.format_exc())
            return
        if rc != 0:
            self._safe_msg("docker ps", err or f"exit {rc}")
            return
        if not out.strip():
            self._safe_msg("docker ps", "Нет контейнеров charter-*.")
            return
        self._show_text_window("docker ps (charter-*)", out)

    def open_api_shell(self):
        """Открыть интерактивный shell в api. Список — без вложенных кавычек в пути."""
        try:
            subprocess.Popen(
                ['cmd.exe', '/k', f'{DOCKER_COMPOSE} exec api sh'],
                creationflags=subprocess.CREATE_NEW_CONSOLE,
                cwd=PROJECT_DIR,
            )
        except Exception:
            self._safe_msg("shell api", traceback.format_exc())

    # ---------- PRE-FLIGHT ----------
    def preflight(self) -> bool:
        n = sweep_orphan_cmds()
        m = sweep_heart_nodes()
        if n or m:
            self.statusBar().showMessage(f"Pre-flight: убито cmd={n}, node={m}")
            time.sleep(0.4)

        if not docker_daemon_ok():
            QMessageBox.critical(
                self, "Docker недоступен",
                "Docker daemon не отвечает.\nЗапустите Docker Desktop.",
            )
            return False

        st = docker_api_status()
        if st == 'missing':
            reply = QMessageBox.question(
                self, "charter-api не запущен",
                f"Контейнер api не найден. Поднять без пересборки?\n\n"
                f"{DOCKER_COMPOSE} up -d api",
                QMessageBox.Yes | QMessageBox.No, QMessageBox.Yes,
            )
            if reply != QMessageBox.Yes:
                return False
            rc, _, err = _compose('up', '-d', 'api', timeout=180)
            if rc != 0:
                self._safe_msg("Ошибка up -d api", err or "unknown")
                return False
            st = docker_api_status()

        if st in ('starting', 'missing'):
            self.statusBar().showMessage("Ждём healthy charter-api (до 90 сек)...")
            if not wait_api_healthy(90.0):
                QMessageBox.warning(
                    self, "charter-api не healthy",
                    f"api в состоянии '{docker_api_status()}' >90 сек.\n"
                    "Смотрите логи в окне xartia-api-logs.",
                )

        for pi in self.processes:
            for port in list(pi.ports):
                if port == 3000:
                    continue
                remaining = _wait_port_free(port, timeout=1.5)
                if not remaining:
                    continue
                bad = [o for o in remaining if o['kind'] in ('other', 'node-other')]
                if bad:
                    details = '\n'.join(
                        f"  PID {o['pid']}  {o['name']}\n    {o['cmd'][:140]}"
                        for o in bad
                    )
                    QMessageBox.critical(
                        self, "Порт занят",
                        f"Порт {port} (задача {pi.title}) занят:\n\n{details}",
                    )
                    return False

        warn = env_api_url_warn()
        if warn:
            self.statusBar().showMessage("⚠ API_URL=localhost — см. справку")
            QMessageBox.information(self, "Совет по .env", warn)

        return True

    # ---------- LIFECYCLE ----------
    def start_all_processes(self, skip_stale_check: bool = False):
        if self.embed_timer is not None:
            self.embed_timer.stop()
            self.embed_timer = None

        self.terminate_all_processes()
        self.processes.clear()
        self._add_configured_processes()

        if not skip_stale_check:
            st = docker_api_status()
            if st == 'healthy':
                stale, src_m, ctr_m = _src_is_stale()
                if stale:
                    reply = QMessageBox.question(
                        self, "src/ новее контейнера",
                        f"src/ изменён:   {_fmt_ts(src_m)}\n"
                        f"api собран:     {_fmt_ts(ctr_m)}\n\n"
                        f"api крутит СТАРЫЙ код.\n\n"
                        f"Да  — пересобрать и запустить (30–90 сек)\n"
                        f"Нет — запустить без пересборки.",
                        QMessageBox.Yes | QMessageBox.No, QMessageBox.Yes,
                    )
                    if reply == QMessageBox.Yes:
                        self._start_build_process(then_start=True)
                        return

        if not self.preflight():
            self.statusBar().showMessage("Запуск отменён (pre-flight)")
            return

        self.statusBar().showMessage("Запускаю...")
        for pi in self.processes:
            self._launch_process(pi)

        self.embed_timer = QTimer(self)
        self.embed_timer.timeout.connect(self.try_embed_windows)
        self.embed_timer.start(500)

        QTimer.singleShot(5000, self._check_startup_errors)
        self.statusBar().showMessage(
            f"Запущены процессы. api: {docker_api_status()}"
        )

    def _add_configured_processes(self):
        for shell, title, cmd, ports in TASKS:
            self.processes.append(ConsoleProcess(shell, title, cmd, ports))

    def _make_bat(self, pi: ConsoleProcess) -> str:
        bat = os.path.join(tempfile.gettempdir(), f'{BAT_PREFIX}{pi.title}{BAT_SUFFIX}')
        os.makedirs(LOG_DIR, exist_ok=True)
        pi.err_log = os.path.join(LOG_DIR, f'{pi.title}.err.log')
        try:
            open(pi.err_log, 'w').close()
        except OSError:
            pass
        with open(bat, 'w', encoding='cp866') as f:
            f.write('@echo off\n')
            f.write(f'title {pi.title}\n')
            f.write(f'cd /d "{PROJECT_DIR}"\n')
            if pi.command:
                f.write(f'{pi.command} 2>"{pi.err_log}"\n')
            else:
                f.write('echo [empty command]\n')
        self._bat_files.append(bat)
        return bat

    def _launch_process(self, pi: ConsoleProcess):
        pi.launch_error = None
        try:
            if pi.shell_type == 'cmd':
                args = ['cmd.exe', '/k', self._make_bat(pi)]
            elif pi.shell_type == 'powershell':
                ps_cmd = f"Set-Location -LiteralPath '{PROJECT_DIR}'; {pi.command}"
                args = ['powershell.exe', '-NoExit', '-Command', ps_cmd]
            else:
                raise ValueError(f"Неизвестный тип оболочки: {pi.shell_type}")

            pi.proc = subprocess.Popen(
                args, shell=False,
                creationflags=subprocess.CREATE_NEW_CONSOLE,
                close_fds=True,
            )
        except Exception as e:
            pi.launch_error = str(e)
            self.statusBar().showMessage(f"Ошибка запуска {pi.title}: {e}")

    # ---------- STARTUP ERRORS ----------
    def _check_startup_errors(self):
        markers = [
            'EADDRINUSE', 'ENOTFOUND', 'ECONNREFUSED',
            'SyntaxError',
            'Cannot find module', 'Cannot find package',
            'ERR_PNPM_',
            'TS2307', 'TS2339', 'TS2345',
        ]
        problems: list[str] = []
        for pi in self.processes:
            if pi.launch_error:
                problems.append(f"• {pi.title}: {pi.launch_error}")
                continue
            if not pi.err_log or not os.path.exists(pi.err_log):
                continue
            try:
                with open(pi.err_log, 'r', encoding='utf-8', errors='replace') as f:
                    content = f.read().strip()
            except OSError:
                continue
            if not content:
                continue
            hits = [mk for mk in markers if mk in content]
            if hits:
                snippet = '\n'.join(content.splitlines()[:12])
                problems.append(f"• {pi.title}: {', '.join(hits)}\n{snippet}")

        rc, out, _ = _compose('logs', '--tail', '60', 'api', timeout=20)
        if rc == 0 and out:
            hits = [mk for mk in markers if mk in out]
            if hits:
                snippet = '\n'.join(out.splitlines()[-12:])
                problems.append(f"• docker api: {', '.join(hits)}\n{snippet}")

        if problems:
            QMessageBox.warning(
                self, "Ошибки при старте",
                "Некоторые задачи не запустились:\n\n" + '\n\n'.join(problems),
            )
            self.statusBar().showMessage("Старт с ошибками — см. logs/ws/*.err.log")
        else:
            self.statusBar().showMessage("Старт без ошибок")

    # ---------- EMBED ----------
    def try_embed_windows(self):
        all_embedded = True
        for i, pi in enumerate(self.processes):
            if pi.hwnd is None and pi.proc is not None:
                hwnd = find_window_by_pid(pi.proc.pid)
                if hwnd:
                    self._embed_window(pi, hwnd, i)
                else:
                    all_embedded = False
            elif pi.hwnd is not None and not pi.embedded:
                self._embed_window(pi, pi.hwnd, i)

        if all_embedded and self.embed_timer is not None:
            self.embed_timer.stop()
            self.embed_timer = None
            self.statusBar().showMessage("Все окна внедрены")
            self.rearrange_children()

    def _embed_window(self, pi: ConsoleProcess, hwnd: int, index: int):
        try:
            win32gui.SetParent(hwnd, int(self.container.winId()))
        except Exception:
            pass
        try:
            win32gui.SetWindowText(hwnd, pi.title)
        except Exception:
            pass
        set_console_font(hwnd, 10)
        try:
            win32gui.ShowWindow(hwnd, win32con.SW_SHOW)
        except Exception:
            pass
        pi.hwnd = hwnd
        pi.embedded = True
        if index < len(self.cell_widgets):
            label = self.cell_widgets[index]
            label.hide()
            self.grid_layout.removeWidget(label)
        self.rearrange_children()

    def rearrange_children(self):
        if not self.container:
            return
        w, h = self.container.width(), self.container.height()
        if w <= 0 or h <= 0:
            return
        cw, ch = w // self.cols, h // self.rows
        for i, pi in enumerate(self.processes):
            if not pi.embedded or not pi.hwnd:
                continue
            r, c = i // self.cols, i % self.cols
            try:
                win32gui.SetWindowPos(
                    pi.hwnd, win32con.HWND_TOP,
                    c * cw, r * ch, cw, ch,
                    win32con.SWP_NOZORDER,
                )
                win32gui.ShowWindow(pi.hwnd, win32con.SW_SHOW)
            except Exception:
                pass

    def change_grid(self):
        rows, ok1 = QInputDialog.getInt(None, "Сетка", "Строк:", self.rows, 1, 10)
        if not ok1:
            return
        cols, ok2 = QInputDialog.getInt(None, "Сетка", "Столбцов:", self.cols, 1, 10)
        if not ok2:
            return
        self.rows, self.cols = rows, cols
        self._rebuild_placeholders()
        for i, pi in enumerate(self.processes):
            if pi.embedded and i < len(self.cell_widgets):
                self.cell_widgets[i].hide()
                self.grid_layout.removeWidget(self.cell_widgets[i])
        self.rearrange_children()
        self.statusBar().showMessage(f"Сетка: {self.rows}x{self.cols}")

    # ---------- STOP ----------
    def terminate_all_processes(self):
        if self.embed_timer is not None:
            self.embed_timer.stop()
            self.embed_timer = None

        self.statusBar().showMessage("Останавливаю процессы...")
        for pi in self.processes:
            if pi.proc is not None:
                _taskkill(pi.proc.pid)
                pi.proc = None
                pi.hwnd = None
                pi.embedded = False

        time.sleep(0.4)
        n = sweep_orphan_cmds()
        m = sweep_heart_nodes()
        time.sleep(0.2)
        k = delete_old_bats()
        self._bat_files.clear()

        for label in self.cell_widgets:
            label.show()

        self.statusBar().showMessage(
            f"Остановлено: процессов={len(self.processes)}, "
            f"cmd={n}, node={m}, bat={k}  (Docker api не тронут)"
        )

    # ---------- CLOSE ----------
    def closeEvent(self, event):
        if self.build_proc is not None:
            reply = QMessageBox.question(
                self, "Идёт сборка",
                "Сборка api ещё выполняется. Прервать и выйти?",
                QMessageBox.Yes | QMessageBox.No, QMessageBox.No,
            )
            if reply != QMessageBox.Yes:
                event.ignore()
                return
            self.build_proc.kill()
            self.build_proc = None

        reply = QMessageBox.question(
            self, "Подтверждение",
            "Закрыть все консоли и выйти?\n(Docker-контейнеры продолжат работу)",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No,
        )
        if reply == QMessageBox.Yes:
            self.terminate_all_processes()
            delete_old_bats()
            event.accept()
        else:
            event.ignore()

    def about(self):
        QMessageBox.about(
            self, "О программе",
            "Консольный контейнер — heart workspace\n"
            "v2.4 (Docker-only, 8 плиток, build-aware, DPI-aware font)\n\n"
            "WORKFLOW после правки src/:\n"
            "  toolbar → «Пересобрать + Запустить»\n"
            "  или «Запустить всё» — предложит пересобрать,\n"
            "      если src/ новее контейнера.\n\n"
            "ПЛИТКИ (4x2):\n"
            "  web · ws · tsc · api-logs\n"
            "  infra-logs · ops · db · shell\n\n"
            "Docker ps — `docker ps --filter name=charter-`.\n"
            "НЕ `docker compose ps`: на Windows с capture_output=True\n"
            "падает с WinError 6 (ERROR_INVALID_HANDLE).\n\n"
            "Шрифт консоли: диагностика в %TEMP%\\heart_ws_setfont.log."
        )


# ------------------------------------------------------------
# Точка входа
# ------------------------------------------------------------
def main():
    if not is_admin():
        print("Требуются права администратора. Запрашиваю UAC...")
        run_as_admin()
        sys.exit(0)

    set_dpi_aware()

    print("Стартовая очистка:")
    print(f"  cmd с маркером: {sweep_orphan_cmds()}")
    print(f"  node из heart:  {sweep_heart_nodes()}")
    print(f"  bat-файлов:     {delete_old_bats()}")

    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    app.setFont(QFont("Segoe UI", 9))

    user32 = ctypes.windll.user32
    sw, sh = user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)

    window = ContainerWindow()
    window.setGeometry(0, 0, sw // 2, sh)
    window.show()

    QTimer.singleShot(100, window.start_all_processes)
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()