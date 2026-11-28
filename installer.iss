; Inno Setup script - builds CrashFlow-Setup.exe from dist\CrashFlow.exe
; Build: iscc /DAppVersion=1.0.0 installer.iss

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{6B2E6F0A-3C1D-4E7B-9A55-8D2F4C1B7E90}
AppName=Crash Flow
AppVersion={#AppVersion}
AppPublisher=ThecrashO
AppPublisherURL=https://github.com/ThecrashO/crash-flow
AppSupportURL=https://github.com/ThecrashO/crash-flow/issues
DefaultDirName={localappdata}\Programs\CrashFlow
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=CrashFlow-Setup
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\CrashFlow.exe
CloseApplications=force
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Tasks]
Name: "autostart"; Description: "Start Crash Flow when Windows starts"
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[InstallDelete]
; From before 1.4, when the app was called Myanmar Flow.
Type: files; Name: "{app}\MyanmarFlow.exe"
Type: files; Name: "{userprograms}\Myanmar Flow.lnk"
Type: files; Name: "{userdesktop}\Myanmar Flow.lnk"

[Files]
Source: "dist\CrashFlow.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\Crash Flow"; Filename: "{app}\CrashFlow.exe"
Name: "{userdesktop}\Crash Flow"; Filename: "{app}\CrashFlow.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: none; ValueName: "Myanmar Flow"; Flags: deletevalue
; Same value name the app's own "start with Windows" setting uses.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Crash Flow"; \
  ValueData: """{app}\CrashFlow.exe"""; Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{app}\CrashFlow.exe"; Description: "Open Crash Flow now"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/f /im CrashFlow.exe"; Flags: runhidden; RunOnceId: "StopApp"

[UninstallDelete]
Type: filesandordirs; Name: "{userappdata}\CrashFlow"
Type: filesandordirs; Name: "{userappdata}\MyanmarFlow"
