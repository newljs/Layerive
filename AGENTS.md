# Layerive：给后续 AI 的项目说明

> **维护契约（必须遵守）**：只要改动了项目的功能、架构、数据结构、API、模型适配、运行方式、文件位置或重要约束，必须在同一次改动中更新本文件。先核对相关实现，再更新受影响章节；不要仅凭 README 推断。纯格式调整且不改变行为时可不更新。  
> 更新时请同步修改本文的“最后核对”日期和相应内容；若现有描述不再可信，优先修正文档而不是保留过期说明。

**最后核对**：2026-09-13
**项目定位**：Layerive 是一个仅本地运行的、以“项目 + 图片版本树”为中心的 AI 图片创作工作台。它将文生图、基于图片的编辑、文字编辑、局部编辑、扩图、去水印、对话记录和项目备份统一保存到本机。

## 1. 运行与边界

- 技术栈：React 19 + TypeScript + Vite 前端；Node.js 原生 `http` 服务端；`node:sqlite` / SQLite 数据库；Sharp 负责局部替换的图片解码、裁剪与合成；Electron 将同一套本地产品打包为桌面应用。
- Node 版本要求：`>= 22.13.0`（依赖内置 `node:sqlite`）。
- 开发：`npm run dev` 同时启动 Vite `127.0.0.1:5173` 和后端 `127.0.0.1:8788`；Vite 将 `/api`、`/files`、`/gallery-files` 代理至后端；后端新增的顶层路径前缀必须同步加进 `vite.config.ts` 的 proxy，否则开发模式下会被 SPA fallback 回 `index.html`。
- 生产：先 `npm run build`，再 `npm start`。后端从 `dist/` 托管前端，同时提供 API 和本地图片文件。
- 桌面开发：`npm run desktop:dev` 先构建相同的前端，再由 Electron 启动本地服务和原生窗口；`npm run desktop:dist` 构建安装包。Electron 专属代码只在 `electron/main.cjs`，不得复制 `src/`、`server/` 或 `public/` 到另一个桌面项目。
- CI 发布：推送 `v*` tag 触发 `.github/workflows/build.yml`，矩阵包含 Windows x64、macOS arm64 / x64、Ubuntu x64；各任务执行 `npm ci --cpu=<arch>` → `npm run build` → `electron-builder --<arch> --publish never`，按目标架构安装 Sharp 原生依赖。独立 release 任务发布非草稿 GitHub Release，三端均未签名。桌面服务位于资源目录 `app/server`，所需 Sharp、`@img`、`detect-libc`、`semver` 由 `extraResources` 放在同级 `app/node_modules`；新增或升级图像依赖时必须核对该运行时依赖清单，不能只依赖 `app.asar` 内的模块。
- 检查：`npm run lint`（TypeScript no-emit）；`npm run build`（先类型检查再构建）；`npm run test` 使用 Node 内置测试和本地模拟模型运行全部服务端测试（也可单独运行 `npm run test:local-edit` / `npm run test:generate`）：前者验证图片处理、日日新输入图规范化、三种视觉协议、局部编辑任务及取消，后者验证批量生成的并发上限、限流退避重试、多图意图自动判断与提示词拆分、变量批量改图的逐张返回/失败续跑/取消保留、日日新编辑请求及多图版本 ZIP 下载。测试仅使用生成的图片和 `work/*-test-*` 内的独立数据/配置，不读取真实用户数据或调用真实模型；测试文件不打入桌面服务资源。
- Windows 双击启动入口：`Layerive.bat`。该文件使用固定的工作目录，移动仓库后需要同步更新。
- 项目不依赖登录、云端数据库或第三方后端。模型请求会发送给用户配置的模型服务；其他项目数据留在本机。
- 许可：项目以 LGPL-3.0-or-later 发布，根目录 `LICENSE` 为 GNU LGPL v3.0 全文（参考 Wei-Shaw/sub2api 的做法）；`package.json` 的 `license` 字段与之保持一致。对外分发或商用前应遵守该许可条款。

## 2. 功能清单（改动时必须同步维护）

这是当前已实现的功能基线。新增、移除、合并或显著改变任一功能时，必须更新本节，以及受影响的流程、API 和数据模型说明。

### 项目与数据管理

- 项目库：卡片 / 列表切换、搜索、最近更新时间排序、收藏、创建、重命名、复制与软删除项目。
- 项目持久化：保存项目描述、封面、当前图片/版本、默认图片模型和工作台草稿。
- 素材上传：无论项目是否已有图片，均可继续上传 PNG、JPEG、WebP（单文件最大 10MB）；服务端会解析并保存原图宽高。新上传图片会立即成为当前画布和下一次编辑的输入素材，并自动匹配当前模型最接近的支持比例。也支持在工作台任意位置（含画布）直接 Ctrl+V 粘贴剪贴板图片，走同一上传流程；文本框内的粘贴始终以文本优先，上传进行中会忽略重复粘贴。
- 项目导出 / 导入：导出单项目 ZIP，导入时生成新的项目及关联 ID。
- 完整备份 / 恢复：备份 SQLite、项目图片和模型配置；恢复前创建安全备份并重启服务。

### 图片创作与编辑

- 文生图：以提示词生成图片；可配置尺寸、1–4 张数量、质量、PNG/JPEG/WebP 输出和透明背景（格式 / 提供商能力受限）。多张结果作为同一版本的候选图保存和展示，不再提供「每张不同」开关：数量大于 1 且提示词非空时，工作台所选视觉模型自动判断用户是要同提示词的多个普通候选，还是明确要求分别生成不同内容；仅后一种情况拆成互不相同的子提示词逐张生成，消息中按序记录各图提示词。
- 图生图 / 提示词改图：选择上传图或历史图片作为输入，以文本继续生成或修改。
- 变量批量改图：选择一张上传图或历史图片作为统一参考图，在弹窗的单个 `contenteditable` 模板编辑区内把光标放到目标位置并点击“插入变量”；前端写入内部 `{{变量N}}` 标记，并在同一文字流内显示为不可编辑、可整体删除的标签。一个模板最多插入 10 个变量，同名标签重复出现时复用同一列。设置 2–50 张数量后，变量值区域按“图片行 × 变量列”同步生成输入矩阵（缩小再放大数量会恢复此前已填内容），所有单元格必须填写，允许不同图片或不同变量复用相同值。每个子项始终从同一参考图出发，服务端同时替换该行全部变量，并在完整提示词外追加“仅替换变量、保持画风/构图/身体/姿势/背景/光影/色彩和其他区域一致”的批次约束，按图片行顺序串行调用图片编辑模型。每完成一张立即写入同一个 `batch_edit` 版本并由轮询接口返回，画布下方实时展示缩略图、已完成/失败/剩余数量和按已处理项平均耗时计算的预估剩余时间；单项失败继续下一项，支持取消且保留已完成图片。
- 项目风格提示词：只自动叠加到无输入图的文生图请求。
- 图片改字：视觉模型识别图片文字为分段内容；用户可修改、删除或框选区域手动新增文字，再由视觉模型规划图片编辑提示词。点击“提交并改图”后立即关闭编辑弹窗并回到项目对话，从视觉规划阶段开始展示等待状态；创建失败时自动恢复弹窗和编辑内容。
- 局部编辑：支持从画布图片内外起拖并越界框选，最终取图片内有效百分比选区。选区浮窗支持文字要求，或上传 / Ctrl+V 粘贴参考图（静态 PNG/JPEG/WebP，最大 10MB）。有参考图时文字可留空：视觉模型同时理解原图、选区与参考图，推断替换意图并返回两图主体坐标；后台裁剪参考主体、等比缩放并粘贴至目标位置，图片模型再按场景融合轮廓、背景、光影、透视和连接处。参考图模式最终仅回填选区内生成结果，边界向内羽化，框外保留原图解码后的像素，并以原图尺寸保存 PNG；纯文字方式继续使用原有模型输出。定位失败或目标超出选区时停止，不盲目拼贴。视觉规划、合成、生成、框外保留均在可取消任务中运行。
- 图片变清晰：对当前图片调用图片模型的改图能力，提升细节和清晰度，同时约束模型保持原图的主体、文字、构图、比例、颜色和风格不变。
- 扩图：选择目标尺寸，以原图为核心自然补全新增画布区域。
- 去水印：视觉模型先判断 / 定位水印；确认存在后调用图片编辑模型修复遮挡区域。
- 提取素材：用户可在整个中间画布从图片内外起拖，且拖拽越过图片或画布边缘不会取消；最终选区取与图片相交的有效区域，前端用 canvas 截取该区域作为截图随请求上传（上限 2048px、最小边不足 256px 自动放大、宽高比超 2:1 时用边缘像素补边、超大自动转 JPEG，以满足模型平台 256–4096px 且比例 ≤2:1 的输入限制）；服务端保存截图为 `extract` 素材后，视觉模型识别用户想提取的主体（忽略圈入的边缘干扰和补边痕迹，可附加文字提示），生成“仅保留该主体、内容与原图一致”的改图提示词，再由图片编辑模型输出独立素材图。
- 提示词画廊：按分类浏览内置模板，可将完整提示词填入对话框或将风格提示词设为项目风格。支持手动添加 / 编辑 / 删除“我的收藏”条目（可上传配图，纯文本亦可），上传图片后可调用视觉模型提炼完整提示词与风格描述；在工作台对画布主图、候选条、消息画廊中的图片点击右键，可一键收藏到画廊（视觉模型自动提炼提示词，失败时仅收图、提示词留空）。用户画廊数据存于 SQLite `gallery_entries` 表与 `data/gallery/` 目录，随完整备份 / 恢复。
- 暗色模式：`src/theme.tsx` 的 ThemeProvider 以 `data-theme` 属性切换 `html` 主题，偏好存于 localStorage（`layerive-theme`），暗色样式统一写在 `styles.css` 末尾的 `html[data-theme='dark']` 覆盖块；首页、工作台、模型配置三处顶栏均有切换按钮。

### 版本、对话与任务

- 版本树：上传图首次编辑时补建起始版本；每次成功生成 / 编辑均产生可分支的版本节点与输出图片。
- 历史操作：选择历史版本查看、从历史版本继续创作、查看可缩放 / 可平移的完整版本树。历史列表中的多图版本以候选缩略图拼图、数量角标和“多图 · N 张”标签区分；可从版本卡片或当前画布工具栏把该版本全部输出图下载为 ZIP，包内按 `V<版本号>-<两位序号>.<扩展名>` 命名。
- 对比：提供并排和滑块式前后图片对比。
- 版本删除：软删除版本；有子版本时需确认强制删除，后代会连接至被删节点的父节点；正在增量写入的批量版本必须先取消或等待结束，不能删除。
- 对话记录：保存用户提示词、模型名、参数、生成结果、系统事件、失败与取消信息。
- 异步任务：生成请求立即返回任务 ID，前端轮询任务状态；支持取消，服务重启会将未完成任务标记为失败。变量批量改图复用一个 `generation_tasks` 主任务并增量发布图片；重启后已完成的批量结果保留为 `partial` 版本，未产生图片的空版本自动软删除。

### 模型管理

- 图片模型：新增、编辑、删除、连接测试、设置默认模型，并按能力控制工作台可用操作。
- 视觉识别模型：新增、编辑、删除、连接测试、设置默认识别模型；可选择 Anthropic Messages、Chat Completions 或 Responses API 格式（新建默认 Chat Completions），供改字、局部编辑、去水印、提取素材规划使用。工作台顶部可为当前项目切换视觉识别模型，选择保存在项目 `draft.visionModelId` 中；旧项目或已删除的选择回退到全局识别默认模型。API Key 输入框可切换显示 / 隐藏。
- 已适配图像提供商：OpenAI 兼容、SenseNova、Gemini、Grok；另有仅服务端兼容的本地 `mock` 演示路径。
- 已适配视觉请求：Anthropic Messages、OpenAI Chat Completions、OpenAI Responses，并保留 SenseNova 和 Dots（`askdiandian.com`）旧配置兼容。

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
  local-edit.mjs            Sharp 图片规范化（含日日新请求副本）、坐标校验、参考主体裁剪合成、框外像素保留
  local-edit.test.mjs       局部编辑的隔离图片处理与 HTTP 集成回归测试
  zip.mjs                   无额外依赖的 ZIP 读写
electron/
  main.cjs                  桌面窗口、原生菜单与本地服务生命周期；运行时将用户数据根目录传给 server/
scripts/
  dev.mjs                   并行启动前端和后端
  parse-gallery.mjs         从外部 GPT-Image2-Skill 参考资料生成画廊源 JSON
  build-gallery-ts.mjs      从 gallery.raw.json 生成 src/gallery.ts
  build-gallery-images.py   构建画廊图片素材
  make-icons.mjs            生成 PWA 图标
public/                     静态图标、PWA manifest、画廊缩略图
data/                       浏览器本地版的运行时 SQLite、项目图片、画廊配图（data/gallery）、恢复安全备份（被 Git 忽略）
config/models.json          浏览器本地版的运行时模型配置，可能含 API Key（被 Git 忽略）
dist/                       构建产物（被 Git 忽略）
release/                    Electron 构建产物（被 Git 忽略）
work/                       临时工作目录（被 Git 忽略）
```

`README_ZH.md` 是用户说明，`README.md` 是英文版；它们不是实现真相。功能改动若影响用户使用，也应酌情同步 README。

## 4. 前端结构与状态

`App.tsx` 用内存状态在以下视图切换，不使用前端路由库：

1. `home`：项目列表、导入/导出/完整备份、模型设置入口。
2. `workspace`：指定 `projectId` 的创作工作台。
3. `models`：图片模型和视觉识别模型的增删改、测试、设为默认。

`WorkspaceView.tsx` 是核心 UI。它加载 `ProjectBundle`，把项目 `draft` 作为可恢复的工作台草稿；草稿修改会在 900ms 防抖后 PATCH 回服务端。该组件还：

- 每 1.5 秒轮询正在生成的任务；完成后重新读取项目 Bundle。图片改字点击提交时会先用任务 ID 为空的 `activeTask` 表示视觉规划阶段，立即关闭文字编辑弹窗、在项目对话中展示等待状态并自动滚动到最新消息；服务端返回真实任务 ID 后开始轮询，提交失败则清除等待状态并重新打开原弹窗。
- 变量批量改图使用约 900ms 的独立进度轮询分支；每当已处理数量增加就重新读取 Bundle，使新增图片、生成中的版本和项目当前图片立即可用。批量进度保留在画布下方，显示词条状态、缩略图、剩余数量与 ETA，任务结束后仍可查看或手动收起。
- 局部编辑提交后立刻显示等待状态，取得任务 ID 后收起浮窗，并按任务 `stage` 显示视觉定位 / 合成 / 生成 / 框外还原进度。失败或取消时在同一工作台会话恢复选区、文字与参考图；成功后清空。参考图只在本次操作中使用，不替换当前画布或项目草稿；切换画布图片会清除旧参考图并使未完成的文件读取失效。局部编辑浮窗有选区时，图片粘贴优先进入参考图，文本框仍保持文本优先。
- 监听 document 的 `paste` 事件：剪贴板含图片时复用上传流程（画布可直接 Ctrl+V 贴图）；文本框内文本优先，上传进行中忽略重复粘贴。
- 维护当前查看图片、下一次编辑的输入图片、图片模型、视觉识别模型、尺寸、输出格式、数量、透明背景等本地状态。工作台选择的视觉模型随项目草稿保存，并通过请求体 `visionModelId` 传给所有视觉理解操作；视觉请求进行中禁止切换，避免界面选择与已提交请求不一致。
- 使用百分比坐标 `{ x, y, width, height }` 记录文字/局部编辑/提取素材选区；局部编辑和提取素材通过画布级 Pointer Events 与指针捕获支持从图片外起拖及越界拖拽，再将结果限制为图片内 0–100% 的有效交集；选区显示层必须以 `inset: 0` 对齐图片内容边缘，不能因容器已有边框而再次向内缩进；服务端和视觉模型提示词均以此为准。
- 提取素材在圈选完成后立即用 canvas 生成截图预览（`cropImageRegion()`），提交时随请求发送截图 base64；局部修改与提取素材、扩图等模式互斥，切换时自动关闭其他模式。
- 在版本树中按父子关系布局；从历史节点继续编辑会成为新的分支。

前端不要直接访问 SQLite、`data/` 或模型配置文件；新增服务端能力时，先在 `src/api.ts` 增加封装和类型，再由组件调用。

## 5. 核心数据模型与不变量

浏览器本地版数据库在 `data/app.db`；桌面版数据库在 Electron `userData/data/app.db`。启动时由 `server/db.mjs` 创建表并启用外键和 WAL。`LAYERIVE_DATA_ROOT` 和 `LAYERIVE_CONFIG_ROOT` 可分别覆盖数据和模型配置目录，Electron 必须传入其 `userData` 子目录，确保升级不覆盖用户项目、图片或 API Key。数据库模式没有迁移框架；变更表结构时必须实现对旧本地数据库安全的迁移/兼容策略，并更新本文件。

| 表 | 用途 | 关键关系 / 约束 |
| --- | --- | --- |
| `projects` | 项目元数据与工作台草稿 | 维护封面、当前版本/图片、默认模型、收藏和软删除时间 |
| `messages` | 对话和系统事件 | 按项目保存用户提示词、生成结果、错误与取消记录 |
| `generation_tasks` | 异步生成任务 | 保存模型快照（去掉 API Key）、参数、输入、状态和错误 |
| `image_versions` | 可分支版本节点 | `parent_version_id` 指向父版本；删除为软删除 |
| `images` | 上传和生成图片元数据 | 文件实际位于 `data/projects/<projectId>/...` |
| `version_inputs` | 版本输入图片关系 | 关联编辑/生成版本和源图片 |
| `text_recognitions` | 图片文字识别缓存 | 以图片、视觉模型 ID 和模型配置指纹缓存成功的文字分段；同一配置直接复用，切换或修改视觉模型则重新识别 |
| `gallery_entries` | 用户自建提示词画廊条目 | 配图存于 `data/gallery/`；source 为 manual / project；删除条目时同步删除配图 |

重要不变量：

- 上传图片先作为未版本化素材保存；服务端用 `readImageDimensions()` 读取 PNG/JPEG/WebP 的宽高并写入 `images.width` / `images.height`。第一次拿它编辑时，`ensureUploadVersion()` 会补建 `upload` 起始版本。
- 局部替换参考图和初步合成图保存在项目 `local-edits/`，`images.source_type` 分别为 `local_reference` / `local_composite`，保持未版本化并带所属 `task_id`。成功版本的 `version_inputs` 同时关联原图、参考图和合成图，父节点始终来自原图；中间图不成为画布当前版本。它们作为普通项目图片随复制、导出导入及备份保留，失败任务已保存的参考素材也会留存。`generation_tasks.input_json` 可附加 `stage`、`localEdit`（选区、意图、双图百分比坐标、规范化尺寸及视觉模型 ID）、`effectivePrompt`，或变量批量改图的 `versionId` / `versionNumber` / `batch`（模板、变量名数组、总数、当前序号，以及逐项的变量值映射、状态、图片 ID、耗时和错误）；不存 API Key，不新增表或列，读取进度时兼容旧任务的单变量结构。
- 每个成功生成任务都会创建一个版本、写入所有输出图片、选第一张作为 `selected_image_id`，并更新项目的当前图片/版本/封面。前端点击候选条或消息画廊中的任意候选图时，同时更新 `currentImageId` 和 `inputImageId`，确保画布所见候选就是下一次继续创作的输入。
- 所有图片生成和编辑任务都把 `params.count` 规范为 1–4。`callImageProviderBatch()` 以提示词数组为输入：单提示词时 OpenAI / Grok 优先使用原生 `n` 批量请求，兼容接口若忽略或拒绝 `n`，会按缺口补发单图请求（首波全部为限流错误时不再补发）；多提示词（拆分模式）一律逐条发 `count=1` 请求，输出顺序与提示词一一对应。所有扇出经 `mapWithConcurrency()` 限制为并发 2，单个请求对 429 / 限流类错误最多退避重试 2 次（约 1.5s / 4s，优先响应 `Retry-After`）。成功返回的图片统一写入同一版本，前端候选条与对话画廊展示全部结果；单图接口的多张生成意味着多次计费请求。
- 项目 Bundle 会隐藏软删除版本所属的图片，未版本化上传图片仍可见。
- 删除版本只软删除记录，**不会删除图片文件**。如被后续版本引用，须显式强制删除，后代会重新连接到被删节点的父节点。
- 服务重启时所有仍为 `generating` 的任务会被标为失败，不能尝试恢复执行。

## 6. 一次图片创作的后端流程

所有图片任务最终通过 `startGeneration()` → `runGenerationTask()` 处理：

```text
前端 POST 操作
  → 校验项目、模型能力、输入图片与参数
  → 写 user message + generation_tasks(generating)
  → 异步调用供应商（常规总超时 120 秒 + 每多一张 +30 秒、多图意图判断另 +60 秒；局部编辑含规划与图像处理总超时 300 秒）
  → 成功：写 image_versions、images、assistant result、更新项目指针
  → 失败/取消：只更新 task 并写 assistant error/canceled message
前端轮询 GET /tasks/:taskId，完成后重新 GET 项目 Bundle
```

- `operation: auto`：有输入图时为 `edit_prompt`，否则为 `text_to_image`。
- 选择上传图片作为改图输入时，前端通过 `closestSizeForDimensions()` 把生成尺寸切换为当前提供商允许的最接近宽高比；固定尺寸模型只能保证比例尽量一致，不能保证输出像素值与原图完全相同。
- 日日新 U1.5 Lite 的所有带图编辑在发往平台前会由 Sharp 生成临时请求副本：按 EXIF 方向转正并转为 sRGB，以工作台选中的合法尺寸作为画布（无合法尺寸时自动限制到 512–4096px、32px 整倍数及最大 3:1），等比缩放并用边缘像素补边，不改写项目原图；PNG 超过 10MB 时回退高质量 JPEG。`/images/edits` 固定传 `size: "auto"`，由规范化参考图决定输出比例。平台仍拒绝输入时，任务错误会保留经过截断与空白清理的原始平台信息，不能再用旧的统一尺寸文案覆盖具体原因。
- 项目风格提示词只追加到无输入图的文生图，避免重绘已有图片的风格。
- `/generate` 的多图意图判断在 `runGenerationTask()` 内使用工作台所选视觉模型（`visionModelId`，缺省回退全局识别默认模型）：数量大于 1 且提示词非空时把任务 `stage` 置为 `planning`，要求模型返回 `different` 与恰好 N 条可选子提示词。仅当 `different=true`、条数正确且互不重复时进入 `different` 模式并逐条生成；普通候选、含糊判断、条数不足或重复提示词均保守回退 `same` 模式，继续按原提示词生成 N 张。判断结果写入 `generation_tasks.input_json.promptMode`，成功消息写 `promptMode`，仅 `different` 模式的 `prompts` 与 `outputImageIds` 按序对齐。单张或空提示词不调用视觉模型；多图请求提交时即校验视觉模型存在，视觉请求硬失败则任务失败。旧消息的 `splitPrompts` 仅为历史展示兼容，新请求忽略该字段。
- `/batch-edit` 不走 `/generate` 的多图意图判断，也不使用图片接口原生 `n`：`startBatchEdit()` 校验模板中的全部变量及其等长值列表，先创建一个 `generating` 批量版本和主任务；`runBatchEditTask()` 再按图片行同时替换多个变量，形成完整提示词，并以 `count=1` 串行调用同一模型和同一参考图。旧调用方仅传一个变量的 `values` 数组时仍兼容。每张输出文件写完后用独立 SQLite 事务追加 `images`、更新任务 JSON；第一张同时设置版本选中图和项目指针。全部完成后写一条结果消息；混合成功/失败为 `partial`，全失败时软删除空版本，取消时保留已有输出。
- `edit_text` 与 `local_edit` 先调用视觉模型生成严格 JSON 的编辑提示词，再调用图片生成模型。文字编辑允许替换、清空删除及手动框选新增；文字编辑和局部修改提交时按源图片宽高匹配当前图片模型最接近的支持比例，不能回落到模型默认的 1:1。
- `local_edit` 在校验后立即返回 202，视觉规划移入 `runGenerationTask()`。带 `reference: { data, mimeType, name? }` 时，后台用 Sharp 按 EXIF 方向规范化两图，最多解码 4000 万像素；参考图等比缩小至最长边不超过 4096px。视觉模型看到的图片与坐标计算使用同一份规范化数据，返回 `intent` / `target_rect` / `reference_rect` / `edit_prompt`。坐标必须有限且处于各自全图 0–100% 内，目标至少 80% 位于选区内，再限制为交集，否则终止。裁剪主体等比放入目标框，矩形裁剪残留背景交由模型在选区内修复。生成后将结果缩放回原图尺寸，只拷贝选区像素并在内部最多 12px 羽化，以 PNG 避免框外二次有损压缩。自然融合质量仍依赖所选模型，选区应为主体衔接留出空间。
- 局部编辑各阶段共享 AbortController；视觉请求另有 120 秒上限。所有生成任务写完输出文件后再次检查取消，再用无异步间隙的 SQLite 事务写版本、输入关系、图片记录、结果消息、任务状态和项目指针，避免取消时发布成功版本。文件写入失败 / 取消可能留下未被数据库引用的输出文件，但不会发布部分成功记录或覆盖原图。
- `recognize-text` 首次成功识别某张图片后，将分段结果持久化至 `text_recognitions`；再次打开“编辑文字”时，若工作台所选视觉模型 ID 和其 provider / API 格式 / Base URL / 模型名均未变化，则直接复用缓存，不再发送识别请求。切换视觉模型会读取该模型自己的缓存或重新识别；缓存会随项目复制、导出导入和完整备份保留。
- `outpaint` 直接构建保留原图、仅扩展新增区域的提示词；`enhance` 直接构建提升清晰度、但不改变原图内容的改图提示词。
- `remove_watermark` 先让视觉模型判断并定位水印；若未发现水印则拒绝提交编辑。
- `extract_asset` 请求体内携带前端 canvas 截图（base64），服务端先保存为 `source_type='extract'` 的未版本化素材（存于 `data/projects/<projectId>/extracts/`），再让视觉模型聚焦主体生成改图提示词，最后以截图为输入图调用编辑模型；版本挂在原图片所在版本的下游。
- 模型必须声明能力。局部编辑、改字、扩图、去水印、提取素材映射为图片模型的 `edit_prompt` 能力；视觉识别模型仅用于理解与规划，不能出图。

## 7. 模型适配和安全注意事项

模型配置在 `config/models.json`（或 `LAYERIVE_CONFIG_ROOT/models.json`），由 `server/models.mjs` 管理。常规模型列表向前端返回时使用 `publicModel()`，API Key 显示为掩码；保存掩码值时保留原 Key。用户点击显隐按钮时，前端才通过 `POST /api/models/:id/api-key` 按需读取该模型的真实 Key；响应禁止缓存，并拒绝来源不是本机页面的跨站请求，不得把真实 Key 加回常规模型列表响应。

| 提供商 | 图像适配实现 | 备注 |
| --- | --- | --- |
| `openai` | Images `generations` / `edits` | 编辑走 multipart；文生图走 JSON |
| `sensenova` | 复用 OpenAI 适配的专用 JSON 分支 | 生成默认 `watermark: false`、`prompt_extend: true`；编辑输入自动规范化并使用 `size: auto` |
| `gemini` | `/interactions` | 尺寸映射为 aspect ratio，返回图片块 |
| `grok` | Images `generations` / `edits` | 输入图以 data URL 放入 JSON |
| `mock` | 本地演示 PNG | 仅服务端兼容路径；配置 UI 的常规提供商集合不包含它 |

- 视觉模型以独立的 `apiFormat` 字段选择 `anthropic_messages`、`chat_completions` 或 `responses`。该字段缺失的旧配置不会被重写：`askdiandian.com` 自动沿用 Anthropic Messages，其余配置沿用 Chat Completions；旧 `provider` 字段继续原样保留，视觉请求根据 Base URL 识别 SenseNova 专用端点，避免隐藏的旧提供商值干扰用户修改后的地址。
- 项目工作台发起的视觉请求可携带 `visionModelId`。`visionModelOrThrow()` 优先严格解析该 ID；未携带时才沿用全局 `active_vision_model`，以兼容旧前端和其他调用方。请求的模型已删除时返回 400，不得静默切换到另一个模型。
- `visionEndpoint()` 根据 Base URL 和 API 格式补全 `/v1/messages`、`/chat/completions` 或 `/responses`；若用户已填写完整端点则不会重复拼接。
- `callVision()` 同时接受单张图片或按顺序排列的图片数组；Anthropic Messages、Chat Completions（含 SenseNova 两条兼容路径）、Responses 均按各自协议发送多张图片。局部替换固定图1为原图、图2为参考图；不支持多图理解的模型会使该任务失败，不降级为只看一张。
- SenseNova 视觉模型有两条不同的兼容路径：旧融合模态服务 `api.sensenova.cn/v1` 使用 `/llm/chat-completions` 和 `max_new_tokens`；Token Plan 的 `sensenova-6.8-flash-lite` 等模型使用 `token.sensenova.cn/v1/chat/completions`、标准 `max_tokens` 与 OpenAI Vision 图片块。不得仅按 `sensenova.cn` 域名笼统选择旧路径。
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
| `/api/projects/:id/generate` | POST | 文生图、图生图、提示词改图；数量大于 1 且提示词非空时可传 `visionModelId`，服务端自动判断普通候选或分别生成 |
| `/api/projects/:id/batch-edit` | POST | 创建变量批量改图任务：`imageId`、`modelId`、含 1–10 个 `{{变量名}}` 的 `template`、`quantity`（2–50）、`variables: [{ name, values }]`（每个 values 长度等于 quantity），以及可选 `parentVersionId` / `params`；兼容旧单变量 `values`，返回任务和预建版本 ID |
| `/api/projects/:id/batch-edits/:taskId` | GET | 查询逐项批量进度、即时输出图片、完成/失败/剩余数量及 ETA |
| `/api/projects/:id/{recognize-text,edit-text,local-edit,outpaint,enhance,remove-watermark,extract-asset}` | POST | 专项图片操作；使用视觉能力的请求可传 `visionModelId` |
| `/api/projects/:id/local-edit` | POST | `imageId`、`modelId`、`visionModelId?`、百分比 `rect`、`instruction`、`params?`；可附 `reference: { data, mimeType, name? }`，有参考图时 instruction 可为空；校验后即返回 202，后台规划与合成 |
| `/api/projects/:id/tasks`、`/tasks/:taskId`、`/tasks/:taskId/cancel` | GET / GET / POST | 查询和取消生成任务 |
| `/api/projects/:id/tasks/:taskId` | GET | 单任务响应含可选 `stage: planning / compositing / generating / preserving`，旧任务为 null |
| `/api/projects/:id/versions/:versionId` | DELETE | 软删除版本，可加 `?force=1` |
| `/api/projects/:id/versions/:versionId/download` | GET | 将未软删除的多图版本全部现存输出图片打包为 ZIP；单图版本返回 400 |
| `/api/projects/:id/duplicate`、`/export` | POST / GET | 深复制项目、导出项目 ZIP |
| `/api/projects/import` | POST | 导入项目 ZIP（base64 请求体） |
| `/api/backup`、`/api/backup/restore` | GET / POST | 完整备份、恢复并重启服务 |
| `/api/models...` | GET / POST / PATCH / DELETE | 模型管理、默认设置、连接测试；`POST /api/models/:id/api-key` 仅供本机配置页按需回显已保存密钥 |
| `/api/gallery` | GET / POST | 用户画廊条目列表、新增（可附 base64 配图） |
| `/api/gallery/analyze` | POST | 视觉模型从 base64 图片提炼标题 / 提示词 / 风格提示词，可传 `visionModelId` |
| `/api/gallery/from-image` | POST | 把项目内图片（projectId + imageId）收藏进画廊并自动提炼提示词，可传 `visionModelId` |
| `/api/gallery/:id` | PATCH / DELETE | 编辑（可替换 / 移除配图）、删除画廊条目 |
| `/gallery-files/<file>` | GET | 画廊配图访问（存于 `data/gallery/`） |
| `/files/<projectId>/<path>` | GET | 本地图片及按需缩略图访问 |

新增或改变 API 时，必须同步更新 `src/api.ts`、前端调用处、`src/types.ts`（需要时）、此表及 README 中受影响说明。

## 9. 导入、导出、删除与恢复

- 单项目导出格式为 ZIP（当前 `project.json` 格式版本为 2），含可选 `files/` 图片和文字识别缓存；导入会生成新的项目及所有关联 ID，缺失的图片文件会被保留为占位关系并提示。旧版本导出包缺少缓存字段时仍可正常导入。
- 项目“复制”也会复制磁盘图片和全部关系数据，并重映射 ID；任务 JSON 中的输入图、批量版本及批量项输出图片 ID 也必须同步重映射。
- 完整备份含数据库、所有项目图片、`data/gallery/` 画廊配图和 `config/models.json`，因此可能含 API Key。恢复前会在当前 `DATA_ROOT/backups/<timestamp>/` 留一份安全备份（含项目图片与画廊配图），然后替换数据并启动新的服务进程。
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
