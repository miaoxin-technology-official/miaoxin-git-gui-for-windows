; Miaoxin Git GUI installer extras:
;  * adds the install directory to the per-user PATH (MiaoxinGitGUI command)
;  * adds an Explorer context menu entry for folders

!include "WinMessages.nsh"

!macro customInstall
  ; Per-user PATH entry. $INSTDIR is stable for per-user installs.
  ReadRegStr $0 HKCU "Environment" "Path"
  WriteRegExpandStr HKCU "Environment" "Path" "$0;$INSTDIR"
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=3000

  ; Folder context menu: right click a directory -> open it in Miaoxin Git GUI.
  WriteRegStr HKCU "Software\Classes\Directory\shell\MiaoxinGitGUI" "" "在这里打开 Miaoxin Git GUI"
  WriteRegStr HKCU "Software\Classes\Directory\shell\MiaoxinGitGUI" "Icon" "$INSTDIR\MiaoxinGitGUI.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\MiaoxinGitGUI\command" "" '"$INSTDIR\MiaoxinGitGUI.exe" "%1"'

  ; Folder background (empty area) context menu.
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\MiaoxinGitGUI" "" "在这里打开 Miaoxin Git GUI"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\MiaoxinGitGUI" "Icon" "$INSTDIR\MiaoxinGitGUI.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\MiaoxinGitGUI\command" "" '"$INSTDIR\MiaoxinGitGUI.exe" "%V"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\MiaoxinGitGUI"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\MiaoxinGitGUI"
!macroend
