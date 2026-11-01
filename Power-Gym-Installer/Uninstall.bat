@echo off
rem ============================================================
rem  Power Gym - uninstaller
rem  Removes the program, shortcuts and the Settings > Apps entry.
rem  Your data in Documents\Power Gym is kept on purpose.
rem ============================================================
setlocal
title Power Gym - Uninstall

set "INSTALL_DIR=%LOCALAPPDATA%\Programs\Power Gym"

echo.
choice /c YN /n /m "Uninstall Power Gym? [Y/N] "
if errorlevel 2 goto :end

del /q "%USERPROFILE%\Desktop\Power Gym.lnk" 2>nul
del /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Power Gym.lnk" 2>nul
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\PowerGym" /f >nul 2>&1

rem The uninstaller runs from inside the folder it deletes, so hand off to a temp copy.
set "CLEANUP=%TEMP%\powergym-cleanup.bat"
(
  echo @echo off
  echo timeout /t 2 /nobreak ^>nul
  echo rmdir /s /q "%INSTALL_DIR%"
  echo del /q "%%~f0"
) > "%CLEANUP%"
start "" /min cmd /c "%CLEANUP%"

echo.
echo  Power Gym was removed. Your data is still in %USERPROFILE%\Documents\Power Gym
echo.
pause

:end
endlocal
exit /b 0
