前端包说明
==========

当前项目已按前后端分离整理：
- 前端：frontend/
- 后端：backend/
- 启动脚本：项目根目录 启动医疗检验工作台.cmd / .ps1

本目录为纯静态前端，无需编译。当前入口：
  index.html
  login.html
  app.js
  style.css
  workspace-pages.js
  security-pages.js
  showcase-pages.js
  security-data.js
  cs1-data.js
  cs2-data.js
  pb-data.js
  zkp-data.js
  cs2-assets/

页面通过相对路径 fetch('/api/medical/...') 调用后端，必须与后端同源部署。
本地由 Spring Boot 通过 FRONTEND_LOCATION=file:../frontend/ 托管；也可用 Nginx 同域部署。
不要把 index.html 直接用 file:// 打开。

完整说明见同目录 README.md。
