@echo off
rem Builds dist\MyanmarFlow.exe
cd /d "%~dp0"
if not exist .venv py -m venv .venv
.venv\Scripts\python -m pip install -q -r requirements.txt pyinstaller
.venv\Scripts\python -c "import myanmar_flow as m; m.make_icon(m.STATE_COLORS['idle'], 256).save('icon.ico', sizes=[(16,16),(32,32),(48,48),(256,256)])"
.venv\Scripts\pyinstaller --noconfirm --onefile --windowed --name MyanmarFlow --icon icon.ico --hidden-import pystray._win32 myanmar_flow.py
echo.
echo Done: dist\MyanmarFlow.exe
