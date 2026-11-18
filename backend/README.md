# Backend

Spring Boot 3.4 / JDK 21 后端工程。

## 目录

```text
src/main/java/com/skinclinic/
  SkinApplication.java
  config/       本地请求来源过滤、安全配置
  controller/   Auth / Medical / Dataset / 全局异常
  service/      检查记录、AI 分析、图像分割
  repository/   文件与 MySQL 存储适配
  dto/          接口 DTO
src/main/resources/application.yml
data/           运行数据（已加入运行目录）
logs/           运行日志
target/         Maven 构建产物
```

## 构建

```powershell
cd backend
mvn -DskipTests package
```

## 运行

由项目根目录的 `启动医疗检验工作台.ps1` 启动，工作目录为 `backend/`，前端位置由：

```text
FRONTEND_LOCATION=file:../frontend/
```

指向前端目录。

## 接口分组

- `/api/auth/*`：登录、会话、退出
- `/api/medical/records`：检查记录
- `/api/medical/analysis` / `segment`：AI 分析与图像分割
- `/api/medical/feasibility-runs`：CS.1 复测记录
- `/api/medical/encrypted-runs`：CS.2 回放记录
- `/api/medical/chart-tasks`：CS.1 / CS.2 图表生成任务（后端计时与归档）
- `/api/medical/dataset/*`：数据集缩略图与掩码

所有接口默认仅本机访问并通过登录 Session 做角色鉴权。
