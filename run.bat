@echo off
rem Runs from source without building the exe.
cd /d "%~dp0"
if not exist .venv py -m venv .venv
.venv\Scripts\python -m pip install -q -r requirements.txt
start "" .venv\Scripts\pythonw myanmar_flow.py
