; Inno Setup script - builds MyanmarFlow-Setup.exe from dist\MyanmarFlow.exe
; Build: iscc /DAppVersion=1.0.0 installer.iss

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{6B2E6F0A-3C1D-4E7B-9A55-8D2F4C1B7E90}
AppName=Myanmar Flow
AppVersion={#AppVersion}
AppPublisher=ThecrashO
AppPublisherURL=https://github.com/ThecrashO/myanmar-flow
AppSupportURL=https://github.com/ThecrashO/myanmar-flow/issues
DefaultDirName={localappdata}\Programs\MyanmarFlow
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=MyanmarFlow-Setup
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\MyanmarFlow.exe
CloseApplications=force
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Tasks]
Name: "autostart"; Description: "Start Myanmar Flow when Windows starts"
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "dist\MyanmarFlow.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\Myanmar Flow"; Filename: "{app}\MyanmarFlow.exe"
Name: "{userdesktop}\Myanmar Flow"; Filename: "{app}\MyanmarFlow.exe"; Tasks: desktopicon

[Registry]
; Same value name the app's own "start with Windows" setting uses.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Myanmar Flow"; \
  ValueData: """{app}\MyanmarFlow.exe"""; Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{app}\MyanmarFlow.exe"; Description: "Open Myanmar Flow now"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/f /im MyanmarFlow.exe"; Flags: runhidden; RunOnceId: "StopApp"

[UninstallDelete]
Type: filesandordirs; Name: "{userappdata}\MyanmarFlow"
