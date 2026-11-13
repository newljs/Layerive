# 新增图片模型接入

最后核对：2026-11-13。以下兼容性由官方协议核对和本地模拟测试确认，尚未使用真实账号验证权限、时延、费用或画质。

## 配置

进入「模型配置」→「添加图片生成模型」，选择对应预设及推荐型号，填写名称、API Key 后保存。三个预设默认选择 Pro，保留现有模型与默认模型；新增时不自动替换已有默认配置。生成、提示词改图、融合、局部编辑和批量任务共用同一适配。

| 预设 | 推荐型号 / 模型 ID | 默认 Base URL | 协议 |
| --- | --- | --- | --- |
| 豆包 Seedream | `doubao-seedream-5-0-pro-260628`、`doubao-seedream-5-0-flash-260915` | `https://ark.cn-beijing.volces.com/api/v3` | Seedream Images |
| Qwen-Image | `qwen-image-3.0-pro`、`qwen-image-3.0`、`qwen-image-2.1-pro`、`qwen-image-2.1-turbo` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | Qwen Images |
| FLUX.2 | `flux-2-pro`（固定版本） | `https://api.bfl.ai/v1` | BFL FLUX |
| 日日新 SenseNova | `sensenova-u1.5-lite`、`sensenova-u1.5-fast` | `https://token.sensenova.cn/v1` | OpenAI Images |

方舟可使用已开通的模型 ID 或接入点 ID。百炼模型、Key 与域名必须同地域，可将北京旧域名替换为 `https://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`；旧域名仍被官方支持。选择其他地域时填写该地域官方域名。预设与协议独立，可在「自定义」中使用相同协议连接兼容网关。

## 功能与限制

| 项目 | Seedream 5.0 Pro / Flash | Qwen-Image | FLUX.2 Pro | 日日新 U1.5 |
| --- | --- | --- | --- | --- |
| 文生图、提示词改图 | 支持 | 支持 | 支持 | 支持 |
| 有序参考输入上限 | 10 图 | 3.0 为 3 图；2.1 为 10 图 | 8 图 | 主图 + 5 张参考图 |
| 多候选 | 应用逐张调度，最多 4 张，并发 2 | 原生整数 n，应用最多 4 张 | 应用逐张调度，最多 4 张，并发 2 | 接口固定 n=1，应用逐张调度，最多 4 张，并发 2 |
| 输出格式 | PNG / JPEG | PNG | PNG / JPEG / WebP | PNG / JPEG / WebP |
| 透明生成 / 去背景 | 不开放 | 仅官方名称的 2.1 Pro / Turbo 开放；去背景需通过 Alpha 校验 | 不开放 | 接口无透明参数，不开放 |
| 取图 | Base64 或 URL | URL；兼容网关也可返回 Base64 | 异步提交、轮询、下载 | Base64 或 URL（URL 24 小时有效） |

Seedream 的透明模式要求已带 Alpha 的输入，无法直接代表本项目的普通照片去背景能力；本次也未启用图层拆分。FLUX 的其他型号可以手填，但本次预设和验证聚焦 Pro，其余型号的独有参数不在适配范围内。

四家接口都不接受本项目的通用 quality 值，配置页禁用质量选择，请求中不传该参数。尺寸选项可编辑，但请求前会校验：Seedream 为 921,600–4,624,220 像素、最长短边比不超过 16；Qwen 为 512²–2048² 像素、最长短边比不超过 8；FLUX 使用 64px 以上的 16px 整倍数尺寸，应用限制最多 4×1024×1024 像素。默认推荐尺寸满足这些限制。

多图始终保留主图、参考图的完整内容与顺序。服务拒绝多图时任务失败，不会静默丢弃参考图。局部替换仍由 Sharp 回填选区并保护框外原像素；融合允许改变整体主体与遮挡，保持原有产品行为。

FLUX 的生成、轮询、下载共用当前任务的取消与超时信号。取消后本地停止请求和发布版本，但供应商任务可能继续并计费。轮询使用平台返回的区域地址，429 仅重试轮询，不重新提交生成。图片下载不转发 Key，模型日志仅保存提示词及元数据。

## 日日新 SenseNova

官方文档：<https://platform.sensenova.cn/docs>。图片模型走 OpenAI Images 协议，但有两处与该协议的默认行为不同，适配层已单独处理：

- **水印与提示词扩写必须逐次显式下发。** 平台的 `watermark` 默认 `true`、`prompt_extend` 默认 `true`，文档明确说明默认值未来可能变化，生产调用应每次显式指定。本项目把两者做成模型配置里的默认值（「日日新专用参数」）+ 工作台里逐次可切换的开关，请求时总是显式发送 `watermark` 与 `prompt_extend`，不依赖平台默认。默认值取 `watermark: false`（beta 期间无水印免费）、`promptExtend: true`。
- **输出尺寸与格式。** `size` 默认 `auto`，宽高需为 32 的倍数、短边 ≥512、长边 ≤4096、宽高比不超过 3:1。编辑请求固定使用 `size: "auto"`，由平台按主图决定输出尺寸，从而保证比例与原图一致；生成请求使用工作台选中的尺寸。`output_format` 支持 `png`/`jpeg`/`webp`，请求值会原样下发，响应里的 `output_format` 回显优先用于确定落库 MIME，避免平台降级时贴错扩展名。
- **多图。** 接口固定 `n=1`，因此工作台的多张候选按 `count=1` 逐张调度（并发 2，与其它非原生批量协议一致）。编辑接口的 `images` 数组第一位是被编辑的主图，其后最多 5 张参考图；本项目的 `/generate` 用 `inputImageId` 传主图、`referenceImageIds` 传参考图，服务端去重、剔除主图自身并截断到 5 张，版本关联里主图记为 `source`、参考图记为 `reference`。
- **尺寸预设。** 预设按文档推荐分辨率排序：`2048x2048`、`2720x1536`、`1536x2720`、`1664x2496`、`2496x1664`、`4096x4096`，其后保留既有的 3:4 / 4:3 / 4:5 / 5:4 / 16:9 / 9:16 / 21:9 / 9:21 尺寸（同样满足 32 倍数与 3:1 限制）。
- **视觉识别。** `sensenova-6.8-flash` / `sensenova-6.8-flash-lite` 使用 `https://token.sensenova.cn/v1` 与标准 `/chat/completions`；旧的 `api.sensenova.cn` 域名只作为兼容保留（走 `/llm/chat-completions` 与 `max_new_tokens`）。6.8 Flash 始终开启思考，文档不建议同时启用 `thinking` 与 `response_format=json_object`，因此该端点不发送 `json_object`，改由提示词约束只返回 JSON。
- **图片输入规范化。** 参考图会先转成平台合法画布（32 倍数、短边 ≥512、长边 ≤4096、比例 ≤3:1、≤10MB），必要时补边而非裁剪，PNG 优先、超限回退 JPEG。

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
