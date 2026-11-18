# SkinFusion-Seg

独立皮肤病灶分割 API。
网页输入的是 **皮肤病原图**

## 本地和服务器启动

建议 Python 3.11–3.13，进入本文件夹后执行：

```bash
python -m venv .venv
# Linux
source .venv/bin/activate
# Windows PowerShell 则执行：.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn service.app:app --host 0.0.0.0 --port 8000 --workers 1
```

- 测试页面：`http://127.0.0.1:8000/`，选原图即可分割。
- JSON 接口：`POST /v1/segment`
- 在线接口文档：`/docs`；OpenAPI：`/openapi.json`
- 健康检查：`GET /health`，模型加载成功后返回 ready。
- 一次仅执行一个推理请求，忙时返回 503 和 Retry-After。网页可稍后重试。
- 默认自动选择 CUDA 或 CPU。可用环境变量 `DEVICE=cpu`、`DEVICE=cuda:0` 指定；`CPU_THREADS` 默认 2。
- 模型启动时只加载一次。单张 GPU 建议一个 worker，多个 worker 会分别占用显存。

CPU 服务器可先通过 PyTorch CPU 源安装 torch，再安装 requirements，避免下载 CUDA 依赖：

```bash
pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
```

NVIDIA GPU 服务器应选择与驱动匹配的 PyTorch 2.8 CUDA 安装包，例如 CUDA 12.8：

```bash
pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements.txt
```

随附 Dockerfile 为 CPU 版本；Docker 构建和 Linux 服务器运行需在目标环境验证：

```bash
docker build -t skinfusion-seg:1.0 .
docker run --rm -p 127.0.0.1:8000:8000 -e API_KEY=replace-with-your-secret skinfusion-seg:1.0
```

## JSON 调用

```json
{
  "image_base64": "data:image/jpeg;base64,/9j/...原图的Base64...",
  "include_overlay": true
}
```

也接受不带 Data URL 前缀的纯 Base64。支持单帧、8位 JPG/PNG/WebP，文件最多8 MiB、最多400万像素。手机原图过大时，可先等比例缩小再上传。EXIF 朝向会被应用，输出尺寸与校正朝向后的图像一致；透明背景合成到白色。

返回 JSON 示例（数值仅说明格式）：

```json
{
  "request_id": "请求唯一编号",
  "model": "SkinFusion-Seg",
  "version": "1.0.1",
  "width": 1024,
  "height": 768,
  "model_input_size": [256, 256],
  "threshold": 0.5,
  "mask_png_base64": "PNG掩码的Base64",
  "overlay_png_base64": "PNG叠加图的Base64",
  "lesion_area_ratio": 0.25,
  "inference_ms": 123.45
}
```

掩码是原图尺寸的灰度 PNG：255=预测病灶、0=背景。`include_overlay=false` 时叠加图为 null。`lesion_area_ratio` 是预测区域像素占比，不是疾病概率；`inference_ms` 包括预处理、设备传输及模型计算，不包括上传和 PNG 编码。没有真值掩码，因此不返回 Dice/IoU。

网页调用核心代码：

```javascript
const reader = new FileReader();
reader.onload = async () => {
  const response = await fetch('/v1/segment', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({image_base64: reader.result, include_overlay: true})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result.detail));
  document.querySelector('#result').src =
    'data:image/png;base64,' + result.overlay_png_base64;
};
reader.readAsDataURL(fileInput.files[0]);
```

已有网页最好由其后端代理调用此 API；后端保存 `API_KEY`，通过 `X-API-Key` 请求头发送，不要把服务器密钥写进公开网页 JS。同源代理路径需要转发至 `/v1/segment`。测试页面中的密钥输入框仅供联调，不保存密钥。

跨域直连可设置 `CORS_ORIGINS=https://your-web.example`，多个来源逗号分隔；默认不放行跨域。公网服务请用反向代理提供 HTTPS、访问控制和请求速率限制。服务端 Nginx 建议 `client_max_body_size 12m;`、`proxy_read_timeout 120s;`。这些配置取决于实际服务器域名，不包含真实服务器部署。

错误状态：400 图片/Base64错误；401 API key错误；413 请求体太大；422 JSON字段错误；503 模型忙。服务不把上传原图或 Base64 写入磁盘/错误响应。

Python 调用：`python examples/client.py photo.jpg --url http://127.0.0.1:8000`，结果保存到 client_output。

## 模型与输入适用范围

模型参数量 1,069,307。当前权重来自 ISIC2018 皮肤镜病灶分割训练。

预处理：RGB float32 → OpenCV 双线性缩放至256×256 → 全图 min-max。预测概率阈值0.5，再以最近邻把二值 mask 映射回原图，保持现有评估口径；不执行去毛、额外后处理或阈值调整。

`MODEL_MANIFEST.json` 记录模型配置与权重哈希。运行不依赖父目录，只提供一个模型入口：

```python
from model import SkinFusionSeg
model = SkinFusionSeg()
```

```text
model/
  __init__.py       # 只导出 SkinFusionSeg
  network.py        # 唯一完整模型及内部编码器
  complex_ops.py    # 基础运算
  context.py        # 内部特征聚合
  resample.py       # 内部特征重采样
service/           # 图片处理与 JSON API
weights/           # 唯一模型权重
examples/          # 网页与 Python 调用示例
```

后三个模型文件是该网络的运行依赖，不是另外三个模型，部署时保留整个 model 文件夹。

## 验证

`tests/smoke_api.py` 用真实权重验证 API 和返回图片；执行前安装 `httpx`：

```bash
pip install httpx==0.27.2
python -m tests.smoke_api
```

本机具体验证结果见 `VALIDATION.md`。`.test_deps` 仅是本机联调临时依赖目录，不属于部署包。

实现参考：[FastAPI JSON请求体](https://fastapi.tiangolo.com/tutorial/body/)、[服务器worker部署](https://fastapi.tiangolo.com/deployment/server-workers/)。

## 1.0.1 更新

修复频谱还原在部分 CUDA 批次形状下产生明显差异的问题，显式满足实信号频谱的共轭对称约束。权重未改变，没有按测试样本调阈值。历史GPU批量评估指标不直接代表本版本，需重新评估。此修复保证数值一致性，不代表分割准确率提高。运行中的服务需停止后重新启动。
