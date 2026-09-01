; Lightweight redirector stub for FuseGrab.
;
; Sits at C:\Program Files\FuseGrab\FuseGrab.exe when upgrading from an older
; system-wide installation. Forwards any launch (including taskbar pins and
; desktop shortcuts) to the per-user install at
; %LOCALAPPDATA%\Programs\Amfaiz\FuseGrab\FuseGrab.exe without breaking existing
; user shortcuts.

Unicode true
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
ShowInstDetails nevershow

!include "FileFunc.nsh"
!include "LogicLib.nsh"

!ifndef APPNAME
  !define APPNAME "FuseGrab"
!endif
!ifndef EXENAME
  !define EXENAME "FuseGrab.exe"
!endif
!ifndef OUTFILE
  !define OUTFILE "..\out\FuseGrab-Redirector.exe"
!endif
!ifndef ICONFILE
  !define ICONFILE "..\assets\icon.ico"
!endif

OutFile "${OUTFILE}"
Icon "${ICONFILE}"

Section
    Var /GLOBAL TargetDir
    Var /GLOBAL TargetExe

    StrCpy $TargetDir "$LOCALAPPDATA\Programs\Amfaiz\${APPNAME}"
    StrCpy $TargetExe "$TargetDir\${EXENAME}"

    ${If} ${FileExists} "$TargetExe"
        ; Set the working directory to the target application directory
        SetOutPath "$TargetDir"

        ; Forward any command-line arguments cleanly
        ${GetParameters} $0
        ${If} $0 == ""
            Exec '"$TargetExe"'
        ${Else}
            Exec '"$TargetExe" $0'
        ${EndIf}
    ${Else}
        MessageBox MB_ICONSTOP "${APPNAME} was moved or uninstalled. Please reinstall ${APPNAME}."
    ${EndIf}
SectionEnd
