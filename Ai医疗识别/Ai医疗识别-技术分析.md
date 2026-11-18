# Ai医疗识别 技术分析报告

> 分析对象：`C:\Users\yxh\Desktop\最新版\Ai医疗识别`
> 包含：`ISIC2018-Original-NPY.zip`（数据集）、`SkinFusion-Seg-deploy.zip`（AI 推理部署包）
> 分析时间：2026-11-13

## 一、这两个包分别是什么

| 文件 | 大小 | 内容 |
| --- | --- | --- |
| `ISIC2018-Original-NPY.zip` | 472 MB（解压 2.59 GB） | ISIC2018 皮肤镜病灶分割数据集的 **NPY 数值副本**：图像/掩码数组 + 样本清单 + 3 个“模拟中心”的划分索引 |
| `SkinFusion-Seg-deploy.zip` | 4 MB | **SkinFusion-Seg 分割模型部署包**：PyTorch 模型代码、已训练权重、FastAPI 推理服务、网页/ Python 调用示例、Docker 配置、验证记录 |

一句话：**数据集负责“训练/评估用的皮肤病灶图 + 分割标注”，部署包负责“把训练好的分割模型做成 JSON API 给网页/后端调用”。**

## 二、数据集怎么做的

### 2.1 来源与预处理

- 来源：ISIC 2018 皮肤镜病灶分割公开数据（Task 1）。
- 预处理：**统一缩放到 256×256**，保持原始数值精度（float32），通道顺序为 **C×H×W**（PyTorch 习惯）。
- 实测样本值：图像 float32，范围 0–1（3×256×256）；掩码 float32，值只有 **0/1**（1×256×256），使用时可按 `>0` 转二值。

### 2.2 数组与样本量

| 数组 | 形状 | 说明 |
| --- | --- | --- |
| `data/images_train.npy` | (2075, 3, 256, 256) | 开发集图像（训练+验证） |
| `data/masks_train.npy` | (2075, 1, 256, 256) | 对应开发集掩码 |
| `data/dataset/test_0/images_test.npy` | (519, 3, 256, 256) | 测试图像 |
| `data/dataset/test_0/masks_test.npy` | (519, 1, 256, 256) | 对应测试掩码 |

总量 2594 张 = **ISIC2018 官方训练集规模**（2075 开发 + 519 测试）。

> ⚠️ 注意：这里的 “test 519” 是从官方**训练集**中切出来的本地留出，不是 ISIC2018 官方 1000 张 test set。因此后续算出的指标属于**内部验证**，不能直接与公开排行榜的官方测试指标对比。

### 2.3 三个“模拟中心”（为联邦学习准备的）

- `simulated_center_A/B/C/` 各含 `indices.npz`（`train_indices / val_indices / test_indices`）和 `manifest.csv`。
- 实测划分（**互不重叠**，我做过集合交并验证）：

| 中心 | 训练 | 验证 | 测试 | 合计 |
| --- | ---: | ---: | ---: | ---: |
| 模拟中心 A | 605 | 87 | 173 | 865 |
| 模拟中心 B | 605 | 87 | 173 | 865 |
| 模拟中心 C | 605 | 86 | 173 | 864 |
| 总计 | 1815 | 260 | 519 | 2594 |

- `train_indices/val_indices` 是开发数组（2075）的下标；`test_indices` 是测试数组（519）的下标；**两套下标空间不同，不能混用**。
- `manifest.csv` 字段：`sample_id, center_id, is_simulated_center, actual_institution, official_isic_id, split, source_array_index, images_npy, masks_npy`。
- 关键限制（README 已明确）：A/B/C 是**人为模拟的机构**，不对应真实医院；`actual_institution`、`official_isic_id` 都是 `unknown`，本地没有可核实的逐图机构/患者/官方编号映射，**不能作为“真实多医院采集或外部验证”的证据**。

### 2.4 数据集对项目的意义

- 这套划分天然适合做**多中心 / 联邦学习**实验（每个中心各自有 train/val/test，不共享原始图像）。
- 和你之前那两份 FedBuff 实验日志（MNIST）是同一套“联邦学习研究”思路，只是这个数据集是医学皮肤分割场景。
- 注意：NPY 不能直接进 `<img>`，网页预览需要后端转 PNG；包内只提供数据，**没有训练脚本**。

## 三、模型怎么做的（SkinFusion-Seg）

### 3.1 基本信息

| 项目 | 内容 |
| --- | --- |
| 任务 | 皮肤病灶**二分类分割**（病灶 vs 背景），输出原图尺寸的 mask/overlay |
| 参数量 | **1,069,307**（约 1.07M），权重 `skinfusion_seg_v1.pth` 4.4 MB |
| 版本 | 1.0.1 |
| 输入 | 256×256 RGB，3 通道 |
| 阈值 | 0.5 |
| 权重完整性 | SHA-256 与 `MODEL_MANIFEST.json` 一致（我已复算验证通过） |
| 训练数据 | ISIC2018 皮肤镜病灶分割数据 |

### 3.2 网络结构（“频域 + 空域”双分支融合）

1. **频域压缩输入**：对输入做 FFT2，只保留低频 `r=64` 的复数频谱（`LowPassFilter`），即把 256×256 图像变成压缩的复数频谱。
2. **复数编码器-解码器骨干**（`EncoderDecoder`）：
   - 复数卷积 `ComplexConv2d`、复数 BatchNorm、复数 ReLU、复数反卷积；
   - 4 级下采样用抗混叠低通（`ComplexLowpass`），中间带 **ComplexCBAM** 注意力；
   - 解码端逐级与编码特征拼接（skip connection）；
   - 输出仍是复数频谱，经 `ZeroPadding` 补回 256×256 频谱后做 **IFFT2**，得到“粗分割 logits”。
3. **空域分支 + 频谱特征回投**：
   - 空域分支对原图做 3 级 stride-2 卷积；
   - 把骨干解码器 3 个尺度的复数特征用 `spectrum_to_spatial`（补零 + `irfft2`，并显式满足共轭对称）还原成空域特征；
   - 与空域特征逐尺度拼接、卷积融合。
4. **上下文聚合**：`ContextAggregation` 做通道/空间注意力聚合，增强多尺度上下文。
5. **特征重采样融合**：`FeatureResampler`（CARAFE 风格的可学习上采样）逐级融合高低层特征，解码后 1×1 卷积预测“修正图”。
6. **最终输出**：`sigmoid(粗分割 logits + 修正图)` → 256×256 概率图。

`complex_ops.py` / `context.py` / `resample.py` **是同一个网络的内部依赖**，不是三个模型。

> 设计核心：**频域全局感受野（FFT 低频）负责“整体病灶定位”，空域分支负责“边界细节修正”**，两者融合得到最终分割——这就是 “SkinFusion” 名字的来源。

### 3.3 训练配置线索（代码里能确认的部分）

- 输入 256×256，RGB，阈值 0.5（训练/评估口径一致）；
- 验证记录里提到用同一预处理/评估路径（float32 → OpenCV 线性缩放 → 全图 min-max）；
- **训练脚本/训练超参（损失函数、优化器、epoch、学习率、数据增强）没有包含在这两个包里**，只有推理代码和权重。

## 四、AI 接入怎么做的（部署包）

### 4.1 服务形态

- 框架：**FastAPI + Uvicorn**，默认端口 8000，单 worker；
- 模型启动时加载一次并校验权重 SHA-256；
- 设备自动选择 CUDA/CPU，可用 `DEVICE=cpu|cuda:0` 指定；CPU 线程默认 2；
- 同一时刻只允许一个推理请求，忙时返回 **503 + Retry-After**；
- 请求体上限 **12.1 MB**，图片上限 **8 MiB / 400 万像素**。

### 4.2 接口

| 接口 | 说明 |
| --- | --- |
| `POST /v1/segment` | 核心分割接口，JSON：`image_base64`（支持 Data URL 或纯 Base64）+ `include_overlay`（是否返回叠加图） |
| `GET /health` | 健康检查，模型加载成功返回 `ready` |
| `GET /` | 自带测试网页（选图即分割） |
| `/docs`、`/openapi.json` | Swagger 文档 |

认证：环境变量 `API_KEY` 非空时，请求必须带 `X-API-Key` 头。

返回字段：
`request_id, model, version, width, height, model_input_size, threshold, mask_png_base64, overlay_png_base64, lesion_area_ratio, inference_ms`

- `mask_png_base64`：原图尺寸灰度 PNG，255=病灶、0=背景；
- `overlay_png_base64`：病灶红色半透明 + 青色轮廓的叠加图；
- `lesion_area_ratio`：预测病灶像素占比（**不是疾病概率**）；
- 不返回 Dice/IoU（单张输入没有真值）。

### 4.3 推理预处理/后处理（`service/inference.py`）

1. Base64 解码，限制 8 MiB / 400 万像素，只接受单帧 8 位 PNG/JPEG/WebP；
2. 应用 EXIF 朝向，透明背景合成白底；
3. RGB float32 → OpenCV 双线性缩放 256×256 → **全图 min-max 归一化**；
4. 模型输出概率 → 阈值 0.5 → 最近邻缩放回原图尺寸；
5. 生成 mask/overlay PNG Base64，统计病灶面积占比与推理耗时。

### 4.4 验证与性能（包内 VALIDATION.md）

- 权重 strict 加载与 SHA-256 校验通过；
- CPU/GPU 概率输出与数学参考回归通过（1.0.1 修复了 CUDA 批次形状下的频谱还原差异）；
- 非正方形原图 320×192 的 mask/overlay 尺寸正确，mask 仅 0/255；
- 单样本 Dice：CPU 单张/批量 **0.80069453**；GPU 单张 0.80066143、批量 0.80062833（**仅样本 97 单张，不是整体指标**）；
- 本机 CPU 首次接口推理约 **214 ms**，GPU 约 **28 ms**（单次记录，不含网络与 PNG 编码）；
- 未在真实服务器部署，Linux/CUDA/反向代理/HTTPS 仍需目标环境联调。

## 五、和你现有医疗平台的关系 / 怎么接

你现在的“皮肤检验”页面 AI 走的是 **DeepSeek 视觉大模型**（返回检查所见/结论/区域框）。这个 SkinFusion-Seg 是**专用分割模型**，输出像素级 mask，两者定位不同，可以互补：

| 能力 | 现有 DeepSeek 分析 | SkinFusion-Seg |
| --- | --- | --- |
| 输入 | 皮肤图 | 皮肤图 |
| 输出 | 文字所见/结论 + 粗区域框 | 像素级病灶 mask + 叠加图 |
| 用途 | 报告辅助描述 | 病灶定位、面积占比、可视化 |
| 依赖 | 外网 API + 密钥 | 本地模型，无外网依赖 |

推荐接入方式（不改动现有流程）：
1. 在服务器上跑 FastAPI 服务（CPU 即可，单张 ~200 ms；有 GPU 更快）；
2. Spring Boot 后端新增代理接口（如 `POST /api/medical/segment`），由后端保存 `API_KEY` 并转发到 `http://127.0.0.1:8000/v1/segment`；
3. 前端在“皮肤检验”记录里增加“AI 病灶分割”按钮，展示 overlay 图，mask/overlay 存到 `data/media`；
4. 不要在前端 JS 里放 API key，也不要把 8000 端口直接暴露公网。

## 六、需要特别注意的点

1. **数据集是“模拟中心”**：A/B/C 不是真实医院，`official_isic_id`/机构均为 unknown；不能当作“真实多医院数据”或“外部验证”证据。
2. **test 519 是官方训练集的本地留出**，不是官方 test set；指标只能用于内部评估。
3. **训练代码不在这两个包里**：只有数据 + 推理模型；如果要“复现训练/联邦训练”，需要另外的训练脚本。
4. **单样本 Dice 0.8007 不能代表整体精度**；要写进报告/答辩，建议用全部 519 张测试集重新算 Dice/IoU。
5. **模型与数据是配套的**（256×256、min-max、阈值 0.5 的评估口径），换预处理会掉点。
6. 权重哈希已验证一致（`be728c6c...cfda`）；部署时保留整个 `model/` 文件夹。

## 七、建议的下一步（我可以直接做）

1. **跑通推理服务**：本机安装 Python 依赖（torch 2.8 CPU + opencv + fastapi），启动 8000 端口，用数据集或真实皮肤图测试 `/v1/segment`；
2. **用 519 张测试集算整体 Dice/IoU**（数据集和模型都在手，可以给出真实评估表）；
3. **接入现有系统**：Spring Boot 增加代理接口，前端皮肤检验页加“AI 病灶分割”入口；
4. **多中心实验**：用 A/B/C 模拟中心做联邦/拆分训练对比（和之前 FedBuff 日志呼应）。

需要我从哪一步开始？
