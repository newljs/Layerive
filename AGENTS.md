# Layerive：给后续 AI 的项目说明

> **维护契约（必须遵守）**：只要改动了项目的功能、架构、数据结构、API、模型适配、运行方式、文件位置或重要约束，必须在同一次改动中更新本文件。先核对相关实现，再更新受影响章节；不要仅凭 README 推断。纯格式调整且不改变行为时可不更新。  
> 更新时请同步修改本文的“最后核对”日期和相应内容；若现有描述不再可信，优先修正文档而不是保留过期说明。

**最后核对**：2026-09-05  
**项目定位**：Layerive 是一个仅本地运行的、以“项目 + 图片版本树”为中心的 AI 图片创作工作台。它将文生图、基于图片的编辑、文字编辑、局部编辑、扩图、去水印、对话记录和项目备份统一保存到本机。

## 1. 运行与边界

- 技术栈：React 19 + TypeScript + Vite 前端；Node.js 原生 `http` 服务端；`node:sqlite` / SQLite 数据库。
- Node 版本要求：`>= 22.13.0`（依赖内置 `node:sqlite`）。
- 开发：`npm run dev` 同时启动 Vite `127.0.0.1:5173` 和后端 `127.0.0.1:8788`；Vite 将 `/api`、`/files` 代理至后端。
- 生产：先 `npm run build`，再 `npm start`。后端从 `dist/` 托管前端，同时提供 API 和本地图片文件。
- 检查：`npm run lint`（TypeScript no-emit）；`npm run build`（先类型检查再构建）。目前没有自动化测试套件。
- Windows 双击启动入口：`Layerive.bat`。该文件使用固定的工作目录，移动仓库后需要同步更新。
- 项目不依赖登录、云端数据库或第三方后端。模型请求会发送给用户配置的模型服务；其他项目数据留在本机。

## 2. 功能清单（改动时必须同步维护）

这是当前已实现的功能基线。新增、移除、合并或显著改变任一功能时，必须更新本节，以及受影响的流程、API 和数据模型说明。

### 项目与数据管理

- 项目库：卡片 / 列表切换、搜索、最近更新时间排序、收藏、创建、重命名、复制与软删除项目。
- 项目持久化：保存项目描述、封面、当前图片/版本、默认图片模型和工作台草稿。
- 素材上传：无论项目是否已有图片，均可继续上传 PNG、JPEG、WebP（单文件最大 10MB）；服务端会解析并保存原图宽高。新上传图片会立即成为当前画布和下一次编辑的输入素材，并自动匹配当前模型最接近的支持比例。也支持在工作台任意位置（含画布）直接 Ctrl+V 粘贴剪贴板图片，走同一上传流程；文本框内的粘贴始终以文本优先，上传进行中会忽略重复粘贴。
- 项目导出 / 导入：导出单项目 ZIP，导入时生成新的项目及关联 ID。
- 完整备份 / 恢复：备份 SQLite、项目图片和模型配置；恢复前创建安全备份并重启服务。

### 图片创作与编辑

- 文生图：以提示词生成图片；可配置尺寸、数量、质量、PNG/JPEG/WebP 输出和透明背景（格式 / 提供商能力受限）。
- 图生图 / 提示词改图：选择上传图或历史图片作为输入，以文本继续生成或修改。
- 项目风格提示词：只自动叠加到无输入图的文生图请求。
- 图片改字：视觉模型识别图片文字为分段内容；用户可修改、删除或框选区域手动新增文字，再由视觉模型规划图片编辑提示词。
- 局部编辑：用户以百分比坐标框选区域并输入要求；视觉模型生成“仅改框内”的编辑提示词。
- 图片变清晰：对当前图片调用图片模型的改图能力，提升细节和清晰度，同时约束模型保持原图的主体、文字、构图、比例、颜色和风格不变。
- 扩图：选择目标尺寸，以原图为核心自然补全新增画布区域。
- 去水印：视觉模型先判断 / 定位水印；确认存在后调用图片编辑模型修复遮挡区域。
- 提取素材：在画布上框选内容区域，前端用 canvas 截取该区域作为截图随请求上传（上限 2048px、最小边不足 256px 自动放大、宽高比超 2:1 时用边缘像素补边、超大自动转 JPEG，以满足模型平台 256–4096px 且比例 ≤2:1 的输入限制）；服务端保存截图为 `extract` 素材后，视觉模型识别用户想提取的主体（忽略圈入的边缘干扰和补边痕迹，可附加文字提示），生成“仅保留该主体、内容与原图一致”的改图提示词，再由图片编辑模型输出独立素材图。
- 提示词画廊：按分类浏览内置模板，可将完整提示词填入对话框或将风格提示词设为项目风格。支持手动添加 / 编辑 / 删除“我的收藏”条目（可上传配图，纯文本亦可），上传图片后可调用视觉模型提炼完整提示词与风格描述；在工作台对画布主图、候选条、消息画廊中的图片点击右键，可一键收藏到画廊（视觉模型自动提炼提示词，失败时仅收图、提示词留空）。用户画廊数据存于 SQLite `gallery_entries` 表与 `data/gallery/` 目录，随完整备份 / 恢复。
- 暗色模式：`src/theme.tsx` 的 ThemeProvider 以 `data-theme` 属性切换 `html` 主题，偏好存于 localStorage（`layerive-theme`），暗色样式统一写在 `styles.css` 末尾的 `html[data-theme='dark']` 覆盖块；首页、工作台、模型配置三处顶栏均有切换按钮。

### 版本、对话与任务

- 版本树：上传图首次编辑时补建起始版本；每次成功生成 / 编辑均产生可分支的版本节点与输出图片。
- 历史操作：选择历史版本查看、从历史版本继续创作、查看可缩放 / 可平移的完整版本树。
- 对比：提供并排和滑块式前后图片对比。
- 版本删除：软删除版本；有子版本时需确认强制删除，后代会连接至被删节点的父节点。
- 对话记录：保存用户提示词、模型名、参数、生成结果、系统事件、失败与取消信息。
- 异步任务：生成请求立即返回任务 ID，前端轮询任务状态；支持取消，服务重启会将未完成任务标记为失败。

### 模型管理

- 图片模型：新增、编辑、删除、连接测试、设置默认模型，并按能力控制工作台可用操作。
- 视觉识别模型：新增、编辑、删除、连接测试、设置默认识别模型；供改字、局部编辑、去水印、提取素材规划使用。
- 已适配图像提供商：OpenAI 兼容、SenseNova、Gemini、Grok；另有仅服务端兼容的本地 `mock` 演示路径。
- 已适配视觉请求：SenseNova、OpenAI 兼容，以及 Dots（`askdiandian.com`）格式兼容。

## 3. 目录职责

```text
src/                        React 单页应用
  main.tsx                  React 挂载入口
  App.tsx                   顶层视图路由与全局项目/模型状态
  theme.tsx                 暗色模式 ThemeProvider（data-theme + localStorage）
  HomeView.tsx              项目库、创建、导入、备份恢复入口
  WorkspaceView.tsx         三栏工作台、图片操作、任务轮询、版本树/对比
  ModelConfigView.tsx       图片模型、视觉识别模型配置界面
  api.ts                    前端唯一的 HTTP API 封装及下载/上传辅助函数
  types.ts                  前后端共享的数据形状（前端侧）
  sizes.ts                  按提供商的尺寸、格式、校验规则
  gallery.raw.json          提示词画廊源数据
  gallery.ts                由脚本生成、供 UI 使用；不要手改
  styles.css                全站样式
server/
  index.mjs                 HTTP 路由、生成任务、模型调用、项目与备份逻辑
  db.mjs                    SQLite 初始化、目录常量、DTO 转换
  models.mjs                config/models.json 的读写、脱敏与模型规范化
  png.mjs                   演示图和缩略图的 PNG 工具
  zip.mjs                   无额外依赖的 ZIP 读写
scripts/
  dev.mjs                   并行启动前端和后端
  parse-gallery.mjs         从外部 GPT-Image2-Skill 参考资料生成画廊源 JSON
  build-gallery-ts.mjs      从 gallery.raw.json 生成 src/gallery.ts
  build-gallery-images.py   构建画廊图片素材
  make-icons.mjs            生成 PWA 图标
public/                     静态图标、PWA manifest、画廊缩略图
data/                       运行时 SQLite、项目图片、画廊配图（data/gallery）、恢复安全备份（被 Git 忽略）
config/models.json          运行时模型配置，可能含 API Key（被 Git 忽略）
dist/                       构建产物（被 Git 忽略）
work/                       临时工作目录（被 Git 忽略）
```

`README_ZH.md` 是用户说明，`README.md` 是英文版；它们不是实现真相。功能改动若影响用户使用，也应酌情同步 README。

## 4. 前端结构与状态

`App.tsx` 用内存状态在以下视图切换，不使用前端路由库：

1. `home`：项目列表、导入/导出/完整备份、模型设置入口。
2. `workspace`：指定 `projectId` 的创作工作台。
3. `models`：图片模型和视觉识别模型的增删改、测试、设为默认。

`WorkspaceView.tsx` 是核心 UI。它加载 `ProjectBundle`，把项目 `draft` 作为可恢复的工作台草稿；草稿修改会在 900ms 防抖后 PATCH 回服务端。该组件还：

- 每 1.5 秒轮询正在生成的任务；完成后重新读取项目 Bundle。
- 监听 document 的 `paste` 事件：剪贴板含图片时复用上传流程（画布可直接 Ctrl+V 贴图）；文本框内文本优先，上传进行中忽略重复粘贴。
- 维护当前查看图片、下一次编辑的输入图片、模型、尺寸、输出格式、数量、透明背景等本地状态。
- 使用百分比坐标 `{ x, y, width, height }` 记录文字/局部编辑/提取素材选区；服务端和视觉模型提示词均以此为准。
- 提取素材在圈选完成后立即用 canvas 生成截图预览（`cropImageRegion()`），提交时随请求发送截图 base64；局部修改与提取素材、扩图等模式互斥，切换时自动关闭其他模式。
- 在版本树中按父子关系布局；从历史节点继续编辑会成为新的分支。

前端不要直接访问 SQLite、`data/` 或模型配置文件；新增服务端能力时，先在 `src/api.ts` 增加封装和类型，再由组件调用。

## 5. 核心数据模型与不变量

数据库在 `data/app.db`，启动时由 `server/db.mjs` 创建表并启用外键和 WAL。数据库模式没有迁移框架；变更表结构时必须实现对旧本地数据库安全的迁移/兼容策略，并更新本文件。

| 表 | 用途 | 关键关系 / 约束 |
| --- | --- | --- |
| `projects` | 项目元数据与工作台草稿 | 维护封面、当前版本/图片、默认模型、收藏和软删除时间 |
| `messages` | 对话和系统事件 | 按项目保存用户提示词、生成结果、错误与取消记录 |
| `generation_tasks` | 异步生成任务 | 保存模型快照（去掉 API Key）、参数、输入、状态和错误 |
| `image_versions` | 可分支版本节点 | `parent_version_id` 指向父版本；删除为软删除 |
| `images` | 上传和生成图片元数据 | 文件实际位于 `data/projects/<projectId>/...` |
| `version_inputs` | 版本输入图片关系 | 关联编辑/生成版本和源图片 |
| `gallery_entries` | 用户自建提示词画廊条目 | 配图存于 `data/gallery/`；source 为 manual / project；删除条目时同步删除配图 |

重要不变量：

- 上传图片先作为未版本化素材保存；服务端用 `readImageDimensions()` 读取 PNG/JPEG/WebP 的宽高并写入 `images.width` / `images.height`。第一次拿它编辑时，`ensureUploadVersion()` 会补建 `upload` 起始版本。
- 每个成功生成任务都会创建一个版本、写入所有输出图片、选第一张作为 `selected_image_id`，并更新项目的当前图片/版本/封面。
- 项目 Bundle 会隐藏软删除版本所属的图片，未版本化上传图片仍可见。
- 删除版本只软删除记录，**不会删除图片文件**。如被后续版本引用，须显式强制删除，后代会重新连接到被删节点的父节点。
- 服务重启时所有仍为 `generating` 的任务会被标为失败，不能尝试恢复执行。

## 6. 一次图片创作的后端流程

所有图片任务最终通过 `startGeneration()` → `runGenerationTask()` 处理：

```text
前端 POST 操作
  → 校验项目、模型能力、输入图片与参数
  → 写 user message + generation_tasks(generating)
  → 异步调用供应商（总超时 120 秒）
  → 成功：写 image_versions、images、assistant result、更新项目指针
  → 失败/取消：只更新 task 并写 assistant error/canceled message
前端轮询 GET /tasks/:taskId，完成后重新 GET 项目 Bundle
```

- `operation: auto`：有输入图时为 `edit_prompt`，否则为 `text_to_image`。
- 选择上传图片作为改图输入时，前端通过 `closestSizeForDimensions()` 把生成尺寸切换为当前提供商允许的最接近宽高比；固定尺寸模型只能保证比例尽量一致，不能保证输出像素值与原图完全相同。
- 项目风格提示词只追加到无输入图的文生图，避免重绘已有图片的风格。
- `edit_text` 与 `local_edit` 先调用视觉模型生成严格 JSON 的编辑提示词，再调用图片生成模型。
- `outpaint` 直接构建保留原图、仅扩展新增区域的提示词；`enhance` 直接构建提升清晰度、但不改变原图内容的改图提示词。
- `remove_watermark` 先让视觉模型判断并定位水印；若未发现水印则拒绝提交编辑。
- `extract_asset` 请求体内携带前端 canvas 截图（base64），服务端先保存为 `source_type='extract'` 的未版本化素材（存于 `data/projects/<projectId>/extracts/`），再让视觉模型聚焦主体生成改图提示词，最后以截图为输入图调用编辑模型；版本挂在原图片所在版本的下游。
- 模型必须声明能力。局部编辑、改字、扩图、去水印、提取素材映射为图片模型的 `edit_prompt` 能力；视觉识别模型仅用于理解与规划，不能出图。

## 7. 模型适配和安全注意事项

模型配置在 `config/models.json`，由 `server/models.mjs` 管理。向前端返回模型时使用 `publicModel()`，API Key 显示为掩码；保存掩码值时保留原 Key。

| 提供商 | 图像适配实现 | 备注 |
| --- | --- | --- |
| `openai` | Images `generations` / `edits` | 编辑走 multipart；文生图走 JSON |
| `sensenova` | 复用 OpenAI 适配的专用 JSON 分支 | 图像生成默认 `watermark: false`、`prompt_extend: true` |
| `gemini` | `/interactions` | 尺寸映射为 aspect ratio，返回图片块 |
| `grok` | Images `generations` / `edits` | 输入图以 data URL 放入 JSON |
| `mock` | 本地演示 PNG | 仅服务端兼容路径；配置 UI 的常规提供商集合不包含它 |

- 视觉模型目前仅允许 `sensenova` 或 `openai` 兼容协议；另有对 `askdiandian.com` 的 Dots 请求格式兼容。
- `normalizeBaseUrl()` 会移除末尾的 `images/generations` 或 `images/edits`，避免重复拼接路径。
- 不要读取、输出、提交或写入示例真实 API Key；`config/` 和 `data/` 已被 Git 忽略。
- 新增供应商或参数时，必须同时检查：`types.ts`、`ModelConfigView.tsx`、`sizes.ts`、`models.mjs`、`index.mjs` 的调用适配和模型测试逻辑。

## 8. HTTP API 概览

所有 JSON 错误为 `{ error }`；生成与编辑接口返回 `202` 和 `{ taskId, status, userMessageId }`。

| 路径 | 主要方法 | 用途 |
| --- | --- | --- |
| `/api/health` | GET | 本地服务健康检查 |
| `/api/projects` | GET / POST | 项目列表、创建 |
| `/api/projects/:id` | GET / PATCH / DELETE | Bundle 查询、项目/草稿更新、项目软删除 |
| `/api/projects/:id/images` | POST | 上传 PNG/JPEG/WebP（最大 10MB） |
| `/api/projects/:id/generate` | POST | 文生图、图生图、提示词改图 |
| `/api/projects/:id/{recognize-text,edit-text,local-edit,outpaint,enhance,remove-watermark,extract-asset}` | POST | 专项图片操作 |
| `/api/projects/:id/tasks`、`/tasks/:taskId`、`/tasks/:taskId/cancel` | GET / GET / POST | 查询和取消生成任务 |
| `/api/projects/:id/versions/:versionId` | DELETE | 软删除版本，可加 `?force=1` |
| `/api/projects/:id/duplicate`、`/export` | POST / GET | 深复制项目、导出项目 ZIP |
| `/api/projects/import` | POST | 导入项目 ZIP（base64 请求体） |
| `/api/backup`、`/api/backup/restore` | GET / POST | 完整备份、恢复并重启服务 |
| `/api/models...` | GET / POST / PATCH / DELETE | 模型管理、默认设置、连接测试 |
| `/api/gallery` | GET / POST | 用户画廊条目列表、新增（可附 base64 配图） |
| `/api/gallery/analyze` | POST | 视觉模型从 base64 图片提炼标题 / 提示词 / 风格提示词 |
| `/api/gallery/from-image` | POST | 把项目内图片（projectId + imageId）收藏进画廊并自动提炼提示词 |
| `/api/gallery/:id` | PATCH / DELETE | 编辑（可替换 / 移除配图）、删除画廊条目 |
| `/gallery-files/<file>` | GET | 画廊配图访问（存于 `data/gallery/`） |
| `/files/<projectId>/<path>` | GET | 本地图片及按需缩略图访问 |

新增或改变 API 时，必须同步更新 `src/api.ts`、前端调用处、`src/types.ts`（需要时）、此表及 README 中受影响说明。

## 9. 导入、导出、删除与恢复

- 单项目导出格式为 ZIP，含 `project.json` 和可选 `files/` 图片；导入会生成新的项目及所有关联 ID，缺失的图片文件会被保留为占位关系并提示。
- 项目“复制”也会复制磁盘图片和全部关系数据，并重映射 ID。
- 完整备份含数据库、所有项目图片、`data/gallery/` 画廊配图和 `config/models.json`，因此可能含 API Key。恢复前会在 `data/backups/<timestamp>/` 留一份安全备份（含项目图片与画廊配图），然后替换数据并启动新的服务进程。
- 这些操作具有高数据风险。修改其逻辑前，必须先评估 SQLite WAL、一致性、失败回滚、路径穿越防护，以及 Windows 文件锁行为。

## 10. 修改指南

1. 先阅读相关文件和该功能的 API 路由；不要仅修改 UI 假装功能完成。
2. 保持 `src/types.ts`、`src/api.ts`、服务端响应和数据库 DTO 的字段命名一致（前端为 camelCase，数据库列为 snake_case）。
3. 增加图片操作时，复用异步任务机制、版本关系、消息记录和任务轮询；不要在请求中长时间阻塞 HTTP 响应。
4. 改动数据库、版本删除、导入导出或恢复前，保护用户现有 `data/`；不要使用会清空整个工作区的 Git/删除命令。
5. 改动样式前先确定组件实际使用的 class；全局样式均在 `src/styles.css`。
6. 修改画廊源数据后运行 `node scripts/build-gallery-ts.mjs`，并提交/保留生成的 `src/gallery.ts` 与源 JSON 的一致性。`parse-gallery.mjs` 依赖仓库外的 `GPT-Image2-Skill` 目录，不应作为日常构建步骤假定可用。
7. 完成后至少运行 `npm run lint`；涉及构建、静态资源或入口时运行 `npm run build`。涉及真实模型时不要擅自发送用户图片或消耗用户额度，除非任务明确要求。
8. **完成任何影响本说明范围的改动后，必须同步更新本 `AGENTS.md`。**
