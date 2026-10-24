@echo off
chcp 65001 > nul
REM Двойной клик — открывает окно-контейнер папок.
REM pythonw — запуск без консольного окна.
cd /d "%~dp0.."
start "" pythonw "%~dp0launch_folders.py"