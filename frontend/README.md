# Frontend

原生 HTML/CSS/JS 单页前端，与 `backend/` 完全分离。

## 目录

```text
index.html            工作台入口
login.html            登录页
app.js                路由、导航、公共 UI
workspace-pages.js    工作空间页面
security-pages.js     安全计算页面与图表交互
showcase-pages.js     功能演示/项目页
security-data.js      安全计算基础数据
cs1-data.js           CS.1 逐轮数据
cs2-data.js           CS.2 回放数据
pb-data.js            数据存证检测数据
zkp-data.js           零知识证明检测数据
style.css             全站样式
cs2-assets/           CS.2 图像重建资产
```

## 接口约定

页面通过相对路径访问 `/api/medical/...` 和 `/api/auth/...`。

当前本地部署由 Spring Boot 同源托管本目录；如果独立部署到 Nginx，需要反向代理 `/api/` 到后端，或改为独立 API 域名并处理 CORS/Session Cookie。

## 版本号

修改 `app.js`、`security-pages.js`、`showcase-pages.js`、`workspace-pages.js` 或 `style.css` 后，同步提升 `index.html` 中的 `?v=` 版本，避免浏览器缓存旧文件。
