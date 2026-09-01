; Traditional Windows installer for FuseGrab, built with NSIS + Modern UI 2.
;
; This wraps the unpacked app produced by `electron-forge package`
; (out/FuseGrab-win32-<arch>) into a wizard-style setup .exe with a
; Welcome -> Directory -> Install (progress bar) -> Finish flow, plus a
; matching uninstaller registered in Add/Remove Programs.
;
; It is normally invoked by scripts/make-nsis.mjs, which passes the source
; directory, output path, and version via /D defines. The !ifndef defaults
; below let it also be compiled standalone for quick iteration.

Unicode true

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

; ---- Configuration (overridable via makensis /D flags) ----------------------
!ifndef APPNAME
  !define APPNAME "FuseGrab"
!endif
!ifndef COMPANYNAME
  !define COMPANYNAME "Amfaiz"
!endif
!ifndef EXENAME
  !define EXENAME "FuseGrab.exe"
!endif
!ifndef VERSIONMAJOR
  !define VERSIONMAJOR 1
!endif
!ifndef VERSIONMINOR
  !define VERSIONMINOR 0
!endif
!ifndef VERSIONBUILD
  !define VERSIONBUILD 0
!endif
!ifndef SOURCEDIR
  !define SOURCEDIR "..\out\FuseGrab-win32-x64"
!endif
!ifndef OUTFILE
  !define OUTFILE "..\out\make\${APPNAME}-Setup-${VERSIONMAJOR}.${VERSIONMINOR}.${VERSIONBUILD}.exe"
!endif
!define VERSION "${VERSIONMAJOR}.${VERSIONMINOR}.${VERSIONBUILD}"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"

; ---- Installer attributes ---------------------------------------------------
Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Amfaiz\${APPNAME}"
InstallDirRegKey HKCU "Software\Amfaiz\${APPNAME}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show
AutoCloseWindow true

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "CompanyName" "${COMPANYNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} Setup"
VIAddVersionKey "FileVersion" "${VERSION}.0"
VIAddVersionKey "ProductVersion" "${VERSION}.0"
VIAddVersionKey "LegalCopyright" "(c) ${COMPANYNAME}"

; ---- Modern UI --------------------------------------------------------------
!define MUI_ICON "..\assets\icon.ico"
!define MUI_UNICON "..\assets\icon.ico"
!define MUI_ABORTWARNING

; Launch via the LaunchApp function rather than running the exe directly: this
; installer is elevated (admin), and a direct run would start the app with that
; same elevated token. LaunchApp goes through explorer.exe to drop back to the
; user's normal integrity level — matching the silent auto-update relaunch.
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${APPNAME}"
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchApp"

!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipWhenAutoUpdate
!insertmacro MUI_PAGE_WELCOME
!undef MUI_PAGE_CUSTOMFUNCTION_PRE
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipWhenAutoUpdate
!insertmacro MUI_PAGE_DIRECTORY
!undef MUI_PAGE_CUSTOMFUNCTION_PRE
!insertmacro MUI_PAGE_INSTFILES
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipWhenAutoUpdate
!insertmacro MUI_PAGE_FINISH
!undef MUI_PAGE_CUSTOMFUNCTION_PRE

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Var AutoUpdate

Function .onInit
    StrCpy $AutoUpdate "0"
    ${GetParameters} $0
    ClearErrors
    ${GetOptions} $0 "/AUTOUPDATE" $1
    IfErrors AutoUpdateDone 0
    StrCpy $AutoUpdate "1"

AutoUpdateDone:
    ; Conditional elevation check:
    ; Only request UAC elevation if an older installation exists in Program Files
    ; with an uninstaller and we are not already running with Administrator privileges.
    ${If} ${FileExists} "$PROGRAMFILES64\${APPNAME}\Uninstall.exe"
        UserInfo::GetAccountType
        Pop $2
        ${If} $2 != "Admin"
            ${GetParameters} $3
            ExecShell "runas" '"$EXEPATH"' '$3'
            Quit
        ${EndIf}
    ${EndIf}
FunctionEnd

; ---- Helpers ----------------------------------------------------------------
; /AUTOUPDATE is used by the in-app updater. It keeps the native installer
; progress window visible, but skips all choice/finish pages so the update
; installs and relaunches without requiring extra clicks.
Function SkipWhenAutoUpdate
    StrCmp $AutoUpdate "1" 0 +2
      Abort
FunctionEnd

; Launch the app through explorer.exe so the new process runs at the user's
; normal integrity level instead of inheriting this installer's elevated
; (admin) token. Used by both the Finish-page button and the silent relaunch.
Function LaunchApp
    Exec '"$WINDIR\explorer.exe" "$INSTDIR\${EXENAME}"'
FunctionEnd

; ---- Install ----------------------------------------------------------------
Section "Install"
    ; Close any running instance before overwriting its (locked) binaries. This
    ; covers a manual install run while the app is open; in the silent
    ; auto-update path the app has already quit itself, so taskkill finds
    ; nothing. /F because a GUI app won't always respond to a polite request in
    ; time, and we're about to replace the executable anyway; /T also terminates
    ; child processes (e.g. ffmpeg) that could be holding files in $INSTDIR.
    nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "${EXENAME}"'
    Pop $0
    ; Exit code "0" means a process was actually terminated — give Windows a
    ; moment to release the file handles before we write. Skip the wait when
    ; nothing was running so a clean install/update isn't slowed down.
    StrCmp $0 "0" 0 +2
      Sleep 2000

    ; If an older installation exists in Program Files, run its uninstaller silently
    ${If} ${FileExists} "$PROGRAMFILES64\${APPNAME}\Uninstall.exe"
        DetailPrint "Uninstalling previous version from Program Files..."
        ClearErrors
        ExecWait '"$PROGRAMFILES64\${APPNAME}\Uninstall.exe" /S _?=$PROGRAMFILES64\${APPNAME}' $0
        Delete "$PROGRAMFILES64\${APPNAME}\Uninstall.exe"
        RMDir /r "$PROGRAMFILES64\${APPNAME}"

        ; Ensure legacy system-wide registry entries and shortcuts are cleaned up
        DeleteRegKey HKLM "${UNINSTKEY}"
        DeleteRegKey HKLM "Software\${APPNAME}"
        SetShellVarContext all
        Delete "$DESKTOP\${APPNAME}.lnk"
        Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
        Delete "$SMPROGRAMS\${APPNAME}.lnk"
        RMDir "$SMPROGRAMS\${APPNAME}"
        SetShellVarContext current
    ${EndIf}

    SetOutPath "$INSTDIR"
    File /r "${SOURCEDIR}\*.*"

    ; Shortcuts
    CreateDirectory "$SMPROGRAMS\Amfaiz"
    CreateShortcut "$SMPROGRAMS\Amfaiz\${APPNAME}.lnk" "$INSTDIR\${EXENAME}"
    CreateShortcut "$SMPROGRAMS\${APPNAME}.lnk" "$INSTDIR\${EXENAME}"
    CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXENAME}"

    ; Uninstaller
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    WriteRegStr HKCU "Software\Amfaiz\${APPNAME}" "InstallDir" "$INSTDIR"

    ; Add/Remove Programs entry (registered in HKCU for per-user install)
    WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
    WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${COMPANYNAME}"
    WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${EXENAME}"
    WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
    WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" "$\"$INSTDIR\Uninstall.exe$\" /S"
    WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
    WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1

    ; Report install size to Add/Remove Programs (KB)
    ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
    IntFmt $0 "0x%08X" $0
    WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" "$0"

    ; In silent and visible auto-update installs there's no Finish page to
    ; relaunch from, so start the app ourselves — de-elevated, same as the
    ; Finish-page button.
    StrCmp $AutoUpdate "1" LaunchAfterInstall 0
    IfSilent LaunchAfterInstall DoneLaunching

LaunchAfterInstall:
    Call LaunchApp

DoneLaunching:
SectionEnd

; ---- Uninstall --------------------------------------------------------------
Section "Uninstall"
    Delete "$SMPROGRAMS\${APPNAME}.lnk"
    Delete "$SMPROGRAMS\Amfaiz\${APPNAME}.lnk"
    RMDir "$SMPROGRAMS\Amfaiz"
    Delete "$DESKTOP\${APPNAME}.lnk"

    RMDir /r "$INSTDIR"

    DeleteRegKey HKCU "${UNINSTKEY}"
    DeleteRegKey HKCU "Software\Amfaiz\${APPNAME}"
    DeleteRegKey HKCU "Software\${APPNAME}"
SectionEnd
