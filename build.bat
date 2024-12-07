@echo off

:: 从 manifest.json 中获取版本号
for /f "tokens=2 delims=:," %%a in ('findstr "version" manifest.json') do (
    set VERSION=%%~a
)
set VERSION=%VERSION: "=%
set VERSION=%VERSION:"=%

:: 设置输出文件名
set FILENAME=Easy_window_resizer_v%VERSION%.zip

:: 创建打包命令
powershell -Command "Compress-Archive -Path * -DestinationPath %FILENAME% -Force"
powershell -Command "Expand-Archive -Path %FILENAME% -DestinationPath temp -Force"
powershell -Command "Remove-Item temp/store -Recurse -Force -ErrorAction SilentlyContinue"
powershell -Command "Remove-Item temp/README.md -Force -ErrorAction SilentlyContinue"
powershell -Command "Remove-Item temp/build.bat -Force -ErrorAction SilentlyContinue"
powershell -Command "Remove-Item temp/build.sh -Force -ErrorAction SilentlyContinue"
powershell -Command "Remove-Item %FILENAME% -Force"
powershell -Command "Compress-Archive -Path temp/* -DestinationPath %FILENAME% -Force"
powershell -Command "Remove-Item temp -Recurse -Force"

echo 打包完成: %FILENAME%
pause