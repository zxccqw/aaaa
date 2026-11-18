Linux 服务器部署说明（Ubuntu）
================================
1. 安装环境：
   apt-get update && apt-get install -y openjdk-21-jre-headless nginx
2. 目录结构（示例）：
   /opt/medical-platform/
     ├─ backend/skin-backend-1.0.0.jar
     ├─ frontend/            （把“前端”包里的文件放这里）
     └─ data/                （jar 同级的 data 数据目录）
3. 配置密钥：
   cp medical-platform.env.example /etc/medical-platform.env
   chmod 600 /etc/medical-platform.env
   编辑填入 DEEPSEEK_API_KEY=sk-xxxx
4. 安装服务：
   cp medical-platform.service /etc/systemd/system/
   systemctl daemon-reload && systemctl enable --now medical-platform
5. 配置 Nginx：
   cp nginx-medical-platform.conf /etc/nginx/sites-available/medical-platform
   ln -sf /etc/nginx/sites-available/medical-platform /etc/nginx/sites-enabled/medical-platform
   rm -f /etc/nginx/sites-enabled/default
   nginx -t && systemctl reload nginx
6. 安全组放行 80 端口，浏览器访问 http://服务器公网IP/