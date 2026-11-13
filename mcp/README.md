# Layerive MCP

把 Layerive 工作台包成 MCP 服务，让对话式客户端（DSH、Claude Desktop 等）直接生成和编辑图片。

它不复制任何业务逻辑：项目、版本、图片、模型都仍是 Layerive 那一份数据，网页和 MCP 看到的是同一个工作台。

## 启动

```bash
cd /home/Layerive/mcp
npm install          # 只装 @modelcontextprotocol/server 与 zod
node server.mjs      # stdio 传输
```

环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `LAYERIVE_URL` | `http://127.0.0.1:8788` | 后端地址。后端必须在本机回环上（见下） |

后端要先用 `systemctl start layerive.service` 起来；`/api/health` 返回 `{"ok":true}` 即可用。

## 工具

| 工具 | 用途 |
| --- | --- |
| `list_projects` | 列出项目（id、名称、版本数、默认模型） |
| `create_project` | 新建项目 |
| `project_status` | 项目的版本历史、每版输出尺寸与路径 |
| `list_models` | 模型列表：协议、可选尺寸、输出格式、**可用 Key 数量**（永远不含 Key 值） |
| `key_pool_status` | 每个 Key 的冷却状态、成功/失败次数（只返回掩码） |
| `test_model` | 只读连接探测（不生图、不扣费），返回延迟与本次用的 Key 序号 |
| `generate_image` | 生成/改图并等它完成，返回输出尺寸与地址 |
| `task_status` | 查询单个生成任务的状态与错误原因 |
| `upload_image` | 上传本地图片（≤10MB）到某个项目作为改图输入 |
| `import_image` | 把本地图片存进图片库（不建项目、不动任何项目） |
| `open_library_image` | 把图片库里的图片打开成项目：第一次新建项目并复制一份图片进去，之后重复打开回到同一个项目 |
| `delete_library_image` | 从图片库删除图片；已经打开成项目的副本不受影响 |
| `list_library` | 图片库列表（独立于项目，按时间倒序）——项目里的图片不会出现在这里 |
| `list_images` | 列出单个项目内的图片，用于挑 `input_image_id` |
| `size_options` | 可选尺寸、比例 token 与 `original` 的含义 |
| `list_plugins` | 列出图片操作插件与每个插件对模型能力的要求 |
| `outpaint_image` | 扩图：把画布扩到目标尺寸，原内容保留，新增区域自然延展 |
| `enhance_image` | 高清增强：提升清晰度与细节，保持主体、文字、构图不变 |
| `remove_watermark` | 去水印：视觉模型先定位水印再覆盖式移除 |
| `remove_element` | 去元素：`selection` 需给 `rect`；`people`/`clutter`/`text`/`room` 全图自动 |
| `edit_text` | 改字：按段替换图中的文字，文字用 `recognize_text` 先识别 |
| `recognize_text` | 识别图中的可编辑文字，返回分段与位置（不改图、不扣生图费用） |
| `local_edit` | 局部修改：在 `rect` 区域内按指令或参考图改写 |
| `fusion_image` | 融合：把参考图按 `point` 位置融进主图 |
| `extract_asset` | 提取主体：框选一块区域提取成独立素材（服务端自己裁剪） |

## 尺寸怎么传

`generate_image` 的 `size` 三选一：

- **固定尺寸**：`2048x2048`、`1664x2496` 等，取自模型声明的 `sizeOptions`（`list_models` 可查）。
- **比例 token**：`1:1`、`4:3`、`3:4`、`3:2`、`2:3`、`16:9`、`9:16`、`21:9`、`9:21`。服务端按该图片协议的像素预算、边长上限与步进合成具体画布，所以同一个比例在不同协议下会得到不同但合法的像素尺寸。
- **`original`**：按输入图自己的比例生成，需要 `input_image_id`。比例会被保留，同时满足平台的硬限制（例如日日新的像素区间与 3 倍比例上限），因此可能被等比放大。

不传则用模型的默认尺寸。

## 改图

必须传 `input_image_id`。用 `list_images` 找项目内的 id，用 `upload_image` 直接传到某个项目；或者用 `import_image` 存进图片库、再 `open_library_image` 打开成项目。图片库与项目是两个独立集合：导入不会建项目，项目里的图片也不会出现在图片库里。

只传 `prompt` 而不传 `input_image_id` 就是纯文生图 —— 这时服务端会忽略 `original` 并回退到模型默认尺寸，因为「原图比例」没有原图可依。

多图参考：日日新的编辑接口支持「主图 + 最多 5 张参考图」（主图是被改的那张，参考图提供要借鉴的内容）。用 `reference_image_ids` 按顺序传项目内的图片 id，服务端会剔除与主图重复的 id、去重并截断到 5 张；没有 `input_image_id` 时传参考图会返回 400 `generate.referenceNeedsInput`。版本关联里主图记 `source`、参考图记 `reference`。

## 日日新专用参数

`generate_image` 另有三个只对日日新（`sensenova` + `openai_images`）生效的字段，其它协议会忽略：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `watermark` | 关（取模型 `defaultParams.watermark`） | 官方要求每次请求显式下发；关掉即无水印输出（公测期免费） |
| `prompt_extend` | 开（取模型 `defaultParams.promptExtend`） | 平台自动扩写提示词，失败时自动回退原提示词 |
| `reference_image_ids` | 无 | 见上节「多图参考」 |

`output_format` 在日日新下也真正生效（`png` / `jpeg` / `webp`），落库 MIME 以平台回显的 `output_format` 为准。`count` 大于 1 时服务端逐张调度，因为日日新接口固定 `n=1`。

## 图片操作插件

`list_plugins` 能看到服务端全部内置插件；下面这些工具是它们的薄包装，调的是网页同一套插件（`POST /api/projects/:id/plugins/:id/run`），所以行为和界面完全一致：

- 都要传 `project` 与 `image_id`；`model` 不传就用默认图片模型。
- 一次调用会等到任务结束（默认 300 秒，`timeout_seconds` 可调），返回版本号与输出图片地址；超时则给出任务 id，用 `task_status` 接着查。
- 矩形一律用图片百分比：`{x, y, width, height}`，取值 0–100，左上角为原点。
- 改字是两步：先 `recognize_text` 拿到分段，再 `edit_text` 只传要改的那几段（`original_text` + 新的 `text`），没变的段可以省略。
- `extract_asset` 只需要 `rect`，裁剪与补边由 MCP 自己做（比例过于细长时会拉伸补边，避免平台比例校验失败）。
- `remove_background` 没有暴露：当前模型 `transparentBackground: false`，插件必然报 `backgroundRemoval.requiresTransparentModel`。换到支持透明 PNG 的模型后再加。
- 输出尺寸默认跟着**源图比例**走：MCP 会挑模型声明里最接近源图长宽比的那个尺寸再提交，和网页下拉一致。不这么做的话服务端会退回模型默认画布，把 16:9 的图输出成方形。

```text
recognize_text(project, image_id)            → 分段列表
edit_text(project, image_id, segments=[{original_text:"旧标题", text:"新标题"}])
```

## 密钥

MCP **不接收也不返回 API Key**。Key 只存在服务端的 `config/models.json`（权限 0600），由 `withKeyPool` 在服务端轮换：

- 401/403 冷却 5 分钟，429 按 `Retry-After` 或指数退避（上限 60 秒），5xx 冷却 15 秒。
- 成功即清零失败计数。
- 单 Key 时直通，不引入额外重试。

想确认轮换是否生效，用 `key_pool_status` 看每个 Key 的成功次数分布。

## 为什么要带 `Host` 头

Layerive 的 `assertLocalUiRequest` 拒绝非回环 `Host`（防 DNS rebinding），而 MCP 进程本身就在本机跑，所以请求固定带 `Host: 127.0.0.1:<port>` 来满足这条校验 —— 这不放宽任何防护，只是把「我是本机进程」如实告诉后端。

## 在 DSH 里注册

`/root/.dsh/cordis.patch.yml`：

```yaml
- insert:
    - id: layerive-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: layerive
        transport: stdio
        command: /home/.nvm/versions/node/v22.19.0/bin/node
        args:
          - /home/Layerive/mcp/server.mjs
        env:
          PATH: /home/.nvm/versions/node/v22.19.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
          LAYERIVE_URL: http://127.0.0.1:8788
        # 一次生图可能等两三分钟，预算要覆盖完整等待
        toolCallTimeoutMs: 600000
```

改完 DSH 会热加载这份 patch，不需要重启。
