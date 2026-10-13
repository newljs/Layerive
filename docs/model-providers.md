# 新增图片模型接入

最后核对：2026-10-13。以下兼容性由官方协议核对和本地模拟测试确认，尚未使用真实账号验证权限、时延、费用或画质。

## 配置

进入「模型配置」→「添加图片生成模型」，选择对应预设及推荐型号，填写名称、API Key 后保存。三个预设默认选择 Pro，保留现有模型与默认模型；新增时不自动替换已有默认配置。生成、提示词改图、融合、局部编辑和批量任务共用同一适配。

| 预设 | 推荐型号 / 模型 ID | 默认 Base URL | 协议 |
| --- | --- | --- | --- |
| 豆包 Seedream | `doubao-seedream-5-0-pro-260628`、`doubao-seedream-5-0-flash-260915` | `https://ark.cn-beijing.volces.com/api/v3` | Seedream Images |
| Qwen-Image | `qwen-image-3.0-pro`、`qwen-image-3.0`、`qwen-image-2.1-pro`、`qwen-image-2.1-turbo` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | Qwen Images |
| FLUX.2 | `flux-2-pro`（固定版本） | `https://api.bfl.ai/v1` | BFL FLUX |

方舟可使用已开通的模型 ID 或接入点 ID。百炼模型、Key 与域名必须同地域，可将北京旧域名替换为 `https://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`；旧域名仍被官方支持。选择其他地域时填写该地域官方域名。预设与协议独立，可在「自定义」中使用相同协议连接兼容网关。

## 功能与限制

| 项目 | Seedream 5.0 Pro / Flash | Qwen-Image | FLUX.2 Pro |
| --- | --- | --- | --- |
| 文生图、提示词改图 | 支持 | 支持 | 支持 |
| 有序参考输入上限 | 10 图 | 3.0 为 3 图；2.1 为 10 图 | 8 图 |
| 多候选 | 应用逐张调度，最多 4 张，并发 2 | 原生整数 n，应用最多 4 张 | 应用逐张调度，最多 4 张，并发 2 |
| 输出格式 | PNG / JPEG | PNG | PNG / JPEG / WebP |
| 透明生成 / 去背景 | 不开放 | 仅官方名称的 2.1 Pro / Turbo 开放；去背景需通过 Alpha 校验 | 不开放 |
| 取图 | Base64 或 URL | URL；兼容网关也可返回 Base64 | 异步提交、轮询、下载 |

Seedream 的透明模式要求已带 Alpha 的输入，无法直接代表本项目的普通照片去背景能力；本次也未启用图层拆分。FLUX 的其他型号可以手填，但本次预设和验证聚焦 Pro，其余型号的独有参数不在适配范围内。

三家接口不接受本项目的通用 quality 值，配置页禁用质量选择，请求中不传该参数。尺寸选项可编辑，但请求前会校验：Seedream 为 921,600–4,624,220 像素、最长短边比不超过 16；Qwen 为 512²–2048² 像素、最长短边比不超过 8；FLUX 使用 64px 以上的 16px 整倍数尺寸，应用限制最多 4×1024×1024 像素。默认推荐尺寸满足这些限制。

多图始终保留主图、参考图的完整内容与顺序。服务拒绝多图时任务失败，不会静默丢弃参考图。局部替换仍由 Sharp 回填选区并保护框外原像素；融合允许改变整体主体与遮挡，保持原有产品行为。

FLUX 的生成、轮询、下载共用当前任务的取消与超时信号。取消后本地停止请求和发布版本，但供应商任务可能继续并计费。轮询使用平台返回的区域地址，429 仅重试轮询，不重新提交生成。图片下载不转发 Key，模型日志仅保存提示词及元数据。

## 验证

「测试连接」不生成收费图片：Seedream/Qwen 查询模型列表，FLUX 检查账户 credits；服务不提供查询时仅检查端点可达并明确提示未验证权限。真实生成与编辑权限需实际任务确认。

本地回归：`node --test server/image-providers.test.mjs server/native-image-api.test.mjs`。测试只使用生成图片、回环 HTTP stub 和 `work/*-test-*` 隔离目录，覆盖七个型号、单/双图、候选与批量、局部像素保留、融合、Qwen 2.1 Alpha、错误与取消、连接检查和凭据隔离；不读取真实 config/data。

## 官方协议依据

- [Seedream 5.0 Pro / Flash 教程](https://docs.volcengine.com/docs/ark/seedream-5-0-pro?lang=zh)
- [火山方舟图片生成 API](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh)
- [Qwen 图片生成与编辑 API](https://help.aliyun.com/en/model-studio/qwen-image-generation-and-editing-api-reference)
- [FLUX.2 Pro 请求参数](https://docs.bfl.ai/api-reference/models/generate-or-edit-an-image-with-flux2-%5Bpro%5D)
- [FLUX.2 图片编辑](https://docs.bfl.ai/flux_2/flux2_image_editing)
- [BFL 结果轮询](https://docs.bfl.ai/quick_start/generating_images)
