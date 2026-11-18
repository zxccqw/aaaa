# 医疗检验工作台

Spring Boot 3.4 + JDK 21 后端，配套原生 HTML/CSS/JS 单页前端。

## 项目结构

```text
aaa/
├─ backend/                    # Spring Boot 后端工程
│  ├─ pom.xml
│  ├─ src/main/java/           # controller / service / repository / config / dto
│  ├─ src/main/resources/      # application.yml
│  ├─ data/                    # 运行数据（检查记录、媒体文件）
│  ├─ logs/                    # 后端运行日志
│  └─ target/                  # Maven 构建产物
├─ frontend/                   # 前端静态资源
│  ├─ index.html / login.html
│  ├─ app.js / style.css
│  ├─ security-*.js            # 安全计算页面
│  ├─ cs1-data.js / cs2-data.js
│  ├─ pb-data.js / zkp-data.js
│  ├─ workspace-pages.js / showcase-pages.js
│  └─ cs2-assets/
├─ Ai医疗识别/                  # SkinFusion-Seg 图像分割服务
├─ 过程/                        # 原始过程数据与检测报告资料
├─ 运行截图/                    # 验收/运行截图
├─ 启动医疗检验工作台.cmd
├─ 停止医疗检验工作台.cmd
├─ 启动医疗检验工作台.ps1
├─ 本地运行说明.md
└─ README.md
```

## 前后端职责

- `backend/`：只负责 REST API、登录会话、数据持久化、AI 服务调用、图表任务状态与结果归档。
- `frontend/`：只负责页面、交互和图表渲染，不写入后端源码目录。
- 当前本地部署为了让登录 Session 保持同源，由 Spring Boot 通过 `FRONTEND_LOCATION` 托管 `frontend/` 静态资源；前后端目录已经独立，前端也可以单独部署到 Nginx 等静态服务器。

## 启动

双击：

```text
启动医疗检验工作台.cmd
```

或命令行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\启动医疗检验工作台.ps1 -Background
```

访问：

```text
http://127.0.0.1:5175/login.html
```

停止：

```text
停止医疗检验工作台.cmd
```

## 构建后端

```powershell
cd backend
mvn -DskipTests package
```

产物：

```text
backend/target/skin-backend-1.0.0.jar
```

启动脚本会设置：

```text
FRONTEND_LOCATION=file:../frontend/
SKIN_STORAGE=<项目>/backend/data
```

并以 `backend/` 作为工作目录启动 JAR，因此 `../frontend/` 指向项目内前端目录。

## 数据与日志

- 检查记录及图片：`backend/data/`
- 后端日志：`backend/logs/`
- 前端静态资源修改后刷新浏览器即可，无需重启后端。
- 后端的会话级图表任务保存在 Session 中，切换页面不取消，退出登录后清空。

## 线上部署

- 公网地址：http://114.55.179.52/login.html
- 部署详情：[部署说明-云服务器.md](部署说明-云服务器.md)
- 服务器服务：medical-platform / skinfusion-seg / nginx
