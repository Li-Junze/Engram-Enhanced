@echo off
rem ============================================================
rem  Engram 网页版一键部署（Cloudflare Pages，项目名 study）
rem  线上地址：https://study-60a.pages.dev
rem  前置：已安装 wrangler 并 wrangler login
rem ============================================================
setlocal
cd /d "%~dp0"

echo [1/4] 重建词书数据...
node scripts\build-web.js || goto :err

echo [2/4] 同步页面与文档...
xcopy /E /Y /I static web-dist >nul || goto :err
xcopy /E /Y /I docs web-dist\docs >nul || goto :err

echo [3/4] 上传到 Cloudflare Pages...
call npx wrangler pages deploy web-dist --project-name=study --branch=main --commit-dirty=true || goto :err

echo [4/4] 完成！线上地址：https://study-60a.pages.dev
pause
exit /b 0

:err
echo 部署失败，请检查上方报错信息。
pause
exit /b 1
