# Layerive：给后续 AI 的项目说明

> **维护契约（必须遵守）**：只要改动了项目的功能、架构、数据结构、API、模型适配、运行方式、文件位置或重要约束，必须在同一次改动中更新本文件。先核对相关实现，再更新受影响章节；不要仅凭 README 推断。纯格式调整且不改变行为时可不更新。  
> 更新时请同步修改本文的“最后核对”日期和相应内容；若现有描述不再可信，优先修正文档而不是保留过期说明。

**最后核对**：2026-10-02（已核对提取与删除五种场景、整图清理、多区域像素保留、保护人物及协议/取消回归）
**项目定位**：Layerive 是一个仅本地运行的、以“项目 + 图片版本树”为中心的 AI 图片创作工作台。它将文生图、基于图片的编辑、融合、文字编辑、局部编辑、删除元素、去除背景、扩图、去水印、对话记录和项目备份统一保存到本机。

## 1. 运行与边界

- 技术栈：React 19 + TypeScript + Vite 前端；Node.js 原生 `http` 服务端；`node:sqlite` / SQLite 数据库；Sharp 负责图片规范化、选区裁剪和局部编辑的框外像素保留；Electron 将同一套本地产品打包为桌面应用。
- Node 版本要求：`>= 22.13.0`（依赖内置 `node:sqlite`）。
- 开发：`npm run dev` 同时启动 Vite `127.0.0.1:5173` 和后端 `127.0.0.1:8788`；Vite 将 `/api`、`/files`、`/gallery-files` 代理至后端；后端新增的顶层路径前缀必须同步加进 `vite.config.ts` 的 proxy，否则开发模式下会被 SPA fallback 回 `index.html`。
- 生产：先 `npm run build`，再 `npm start`。后端从 `dist/` 托管前端，同时提供 API 和本地图片文件。
- 桌面开发：`npm run desktop:dev` 先构建相同的前端，再由 Electron 启动本地服务和原生窗口；`npm run desktop:dist` 构建安装包。Electron 专属代码只在 `electron/main.cjs`，不得复制 `src/`、`server/` 或 `public/` 到另一个桌面项目。
- CI 发布：推送 `v*` tag 触发 `.github/workflows/build.yml`，矩阵包含 Windows x64、macOS arm64 / x64、Ubuntu x64；各任务先在运行器架构执行 `npm ci` → `npm run build` → `npm test`，再执行 `npm ci --cpu=<arch>` → `electron-builder --<arch> --publish never`，按目标架构安装 Sharp 原生依赖。独立 release 任务发布非草稿 GitHub Release，三端均未签名。桌面服务位于资源目录 `app/server`，所需 Sharp、`@img`、`detect-libc`、`semver` 由 `extraResources` 放在同级 `app/node_modules`；新增或升级图像依赖时必须核对该运行时依赖清单，不能只依赖 `app.asar` 内的模块。
- 检查：`npm run lint`（TypeScript no-emit）；`npm run build`（先类型检查再构建）；`npm run test` 使用 Node 内置测试和本地模拟模型运行全部服务端测试（也可单独运行 `npm run test:local-edit` / `npm run test:generate` / `npm run test:request-guard`）：`test:local-edit` 验证图片处理、日日新输入图规范化、三种视觉协议、四种图片协议的有序双图局部替换、单张与批量任务、拒绝多图时不降级、删除元素、框外像素保留及取消；`cleanup.test.mjs` 验证四种整图清理场景、四种图片及三种视觉协议、多区域并集与保护区像素、拒绝/取消及版本关联；`extraction.test.mjs` 验证五种提取场景、三种视觉协议、商品展示约束、多候选、拒绝/取消及版本关联；`test:generate` 验证批量生成的并发上限、限流退避重试、多图意图自动判断与提示词拆分、部分成功时提示词与图片对齐、去除背景的主体规划 / 透明参数 / Alpha 校验、文字编辑输出继承修改后的识别缓存（含多候选和全部删除）、变量批量处理与批量文生图的逐张返回/失败续跑/取消保留、日日新编辑请求及多图版本 ZIP 下载；`project-data.test.mjs` 验证导入路径穿越防护、草稿图片 ID 重映射、缺文件素材与文字缓存兼容及默认模型回退；`backup-restore.test.mjs` 验证恢复前拒绝损坏、路径穿越和模式不兼容数据库，恢复后的项目目录重建及安全备份；`restore-concurrency.test.mjs` 验证恢复会取消并等待在途生成，再由桌面宿主重启；`model-connection.test.mjs` 验证模型端点错误不会被标记为连接成功；`test:request-guard` 验证本机访问限制（跨站调用被拒、响应不带 CORS 授权、Vite 代理与非浏览器调用仍可用）。测试仅使用生成的图片和 `work/*-test-*` 内的独立数据/配置，不读取真实用户数据或调用真实模型；测试文件不打入桌面服务资源。
- Windows 双击启动入口：`Layerive.bat`。该文件使用固定的工作目录，移动仓库后需要同步更新。
- 项目不依赖登录、云端数据库或第三方后端。模型请求会发送给用户配置的模型服务；其他项目数据留在本机。
- 许可：项目以 LGPL-3.0-or-later 发布，根目录 `LICENSE` 为 GNU LGPL v3.0 全文（参考 Wei-Shaw/sub2api 的做法）；`package.json` 的 `license` 字段与之保持一致。对外分发或商用前应遵守该许可条款。

## 2. 功能清单（改动时必须同步维护）

这是当前已实现的功能基线。新增、移除、合并或显著改变任一功能时，必须更新本节，以及受影响的流程、API 和数据模型说明。

### 项目与数据管理

- 项目库：卡片 / 列表切换、搜索、最近更新时间排序、收藏、创建、重命名、复制与软删除项目。重命名有两个入口：项目库卡片 / 列表行的铅笔按钮弹出重命名对话框，工作台顶栏的项目名输入框失焦即保存（输入框右侧的铅笔图标提示其可编辑）。两者都只改名称，不影响图片、对话与版本。
- 项目持久化：保存项目描述、封面、当前图片/版本、默认图片模型和工作台草稿。工作台草稿每次变更先写入 `localStorage` 的 `layerive-draft:<projectId>` 恢复副本，服务端保存成功后删除；网络失败时阻止内部离开工作台，刷新 / 关窗后可从该副本恢复。当前标签页的顶层视图与工作台 `projectId` 另存于 `sessionStorage` 的 `layerive-current-view`，浏览器后台丢弃标签页并重载后会恢复原工作台；若项目已不存在则回退项目库。
- 素材上传：无论项目是否已有图片，均可继续上传 PNG、JPEG、WebP（单文件最大 10MB）；服务端会解析并保存原图宽高。新上传图片会立即成为当前画布和下一次编辑的输入素材，并自动匹配当前模型最接近的支持比例。也支持在工作台任意位置（含画布）直接 Ctrl+V 粘贴剪贴板图片，走同一上传流程；文本框内的粘贴始终以文本优先，上传进行中会忽略重复粘贴。
- 项目导出 / 导入：导出单项目 ZIP，导入时生成新的项目及关联 ID。
- 完整备份 / 恢复：备份 SQLite、项目图片、画廊配图和模型配置；导出与导入统一限制 ZIP 至 10,000 个条目、单条 512MB、总解压后 2GB。恢复会进入维护状态，取消并等待在途任务完成，再在隔离目录校验 ZIP 路径、数据库完整性、外键、必要表及字段；随后 checkpoint 并创建含同样内容的安全备份，最后替换数据并重启服务。服务启动时会为全部未删除项目重建标准素材目录，因此空项目也可在恢复后继续上传和生成。

### 图片创作与编辑

- 文生图：以提示词生成图片；可配置尺寸、1–4 张数量、质量、PNG/JPEG/WebP 输出和透明背景。尺寸、格式、透明背景和最大数量均由当前图片模型自身声明，多张结果作为同一版本的候选图保存和展示，不再提供「每张不同」开关：数量大于 1 且提示词非空时，工作台所选视觉模型自动判断用户是要同提示词的多个普通候选，还是明确要求分别生成不同内容；仅后一种情况拆成互不相同的子提示词逐张生成，消息中按序记录各图提示词。
- 图生图 / 提示词改图：选择上传图或历史图片作为输入，以文本继续生成或修改。
- 融合模式：点击画布工具栏最后一个功能按钮「融合模式」，收起右侧项目对话并扩大画布，画布右侧以工具侧栏集中显示「基础融合 / 换装 / 动作迁移 / 合影」2×2 图标卡片（每次进入默认基础融合）、当前模式说明和参考图列表；顶部退出入口、底部拖拽指引与补充要求固定，中间内容独立滚动，退出融合后恢复对话。支持上传或 Ctrl+V 粘贴静态 PNG/JPEG/WebP（单张最大 10MB）、从当前项目未删除版本中选择已生成图片、移出参考列表；上传参考图不会改变主图、输入图或封面。把参考图拖到主图范围内松开即创建单图异步融合任务，落点按主图百分比坐标记录；也支持先点击参考图再点击主图落点，键盘可在主图按 Enter/空格以中心为落点。可填写 ≤1000 字符的补充要求。视觉模型同时理解两图、落点和子模式，基础融合推断添加/替换内容与合理位置，换装检查参考服装及目标人物，动作迁移保留主图身份并迁移姿态，合影保留主图人物并加入参考人物；无法执行或无法确定意图时以 `fusion.notApplicable` 停止，不调用图片模型。双图编辑要求图片模型的 `edit_prompt` 能力及所选服务实际支持多图输入；主图为图1、参考为图2，输出尺寸匹配主图最接近的支持比例。任务可取消，失败/取消保留主图及参考列表，成功保存为 `fusion` 版本并关联两张输入图。融合允许调整主体及遮挡，不使用局部编辑的框外像素回填。参考图 ID、子模式与补充要求随项目草稿保存，复制和导入时重映射图片 ID；切换到其他画布操作时退出融合模式。
- 批量模式（右侧面板顶部有「对话 / 批量」两个模式标签，点「批量」默认进入批量文生图子模式；原独立弹窗和画布浮动入口均已移除）：面板内有「批量改图 / 批量文生图」两个子模式，共用「变量模板 / 提示词列表」两种录入方式，均为 2–50 张、逐张增量写入同一版本。开始局部修改、删除元素、去除背景、提取素材、编辑文字、扩图、变清晰或去水印等单图画布操作时，会自动切回对话模式。
  - 批量改图：始终以画布当前展示的图片作为统一参考图，在单个 `contenteditable` 模板编辑区内把光标放到目标位置并点击“插入变量”；前端写入内部 `{{变量N}}` 标记，并在同一文字流内显示为不可编辑、可整体删除的标签。一个模板最多插入 10 个变量，同名标签重复出现时复用同一列。设置 2–50 张数量后，变量值区域按“图片行 × 变量列”同步生成输入矩阵（缩小再放大数量会恢复此前已填内容），所有单元格必须填写，允许不同图片或不同变量复用相同值。每个子项始终从同一参考图出发，服务端同时替换该行全部变量，并在完整提示词外追加“仅替换变量、保持画风/构图/身体/姿势/背景/光影/色彩和其他区域一致”的批次约束，按图片行顺序串行调用图片编辑模型。提示词列表页可导入 TXT 或直接粘贴，每行一条完整提示词（可编辑文本框回显、行数即生成数量，2–50 条，单条上限 1000 字符），每行不再叠加变量批次约束，直接以该行提示词对画布图片逐张改图。
  - 批量文生图：无输入图的纯提示词批量（要求模型具备文生图能力），同样支持变量模板与提示词列表录入；提供「统一风格提示词」（默认带入项目风格提示词、可单独修改，≤2000 字符），服务端把它追加到每条最终提示词末尾，不叠加参考图批次约束。
  - 共同行为：每完成一张立即写入同一个版本并由轮询接口返回，画布下方实时展示缩略图、已完成/失败/剩余数量和按已处理项平均耗时计算的预估剩余时间；单项失败继续下一项，支持取消且保留已完成图片。
- 项目风格提示词：只自动叠加到无输入图的文生图请求。
- 图片改字：视觉模型识别图片文字为分段内容；用户可修改、删除或框选区域手动新增文字，再由视觉模型规划图片编辑提示词。点击“提交并改图”后立即关闭编辑弹窗并回到项目对话，从视觉规划阶段开始展示等待状态；创建失败时自动恢复弹窗和编辑内容。任务成功后，每张输出图都会按本次替换、删除和新增结果保存当前文字快照（包括空快照），用同一视觉模型配置继续改字时直接读取，不再重复识别。
- 局部编辑：支持从画布图片内外起拖并越界框选，最终取图片内有效百分比选区。选区浮窗支持文字要求，或上传 / Ctrl+V 粘贴参考图（静态 PNG/JPEG/WebP，最大 10MB）。有参考图时文字可留空：视觉模型同时理解原图、选区与参考图，推断替换意图、定位两图主体并规划明确的双图替换提示词；后台将规范化的完整原图（图1）和完整参考图（图2）按顺序传给图片模型，直接在指定位置替换主体，不裁剪拼贴参考主体。提示词要求保留参考主体的身份、颜色、形状、纹理及辨识特征，按原图姿态、透视、画风和光照适配尺寸与连接处，不引入参考图背景、原有阴影或无关内容；需所选图片服务实际支持多图编辑，不静默降级为单图。参考图模式最终仅回填选区内生成结果，边界向内羽化，框外保留原图解码后的像素，并以原图尺寸保存 PNG；纯文字方式继续使用原有模型输出。定位失败或目标超出选区时停止。视觉规划、双图生成、框外保留均在可取消任务中运行。选区浮窗的操作行提供「批量修改」入口：点击后在浮窗右侧展开批量面板，每行一条指令（2–50 条、单条 ≤1000 字符，可粘贴多行），复用 `/local-edit-batch`（任务 `operation_type` 仍为 `batch_edit`、版本 `operation_type` 为 `local_edit`）逐张运行同一条局部修改流水线并把全部输出追加到同一版本；若浮窗已附参考图，所有指令共用该参考图（此时强制 PNG 输出）。进度复用画布下方的批量进度面板（`localEdit` 标记区分文案），支持取消并保留已完成图片。
- 删除元素：进入类似融合/提取的右侧工具栏，收起项目对话，提供「框选删除（默认）/ 去除路人 / 清理杂物 / 全图文字清理 / 房屋空间整理」。默认模式维持拖动圈选、松开立即创建可取消任务：视觉模型同时查看原图及放大的选区细节，优先识别最具体的独立部件/成对物品，置信度 ≥0.65 且至少 90% 位于选区内才调用图片模型；只回填选区、向内羽化、保留框外像素。其余四种场景无需框选，分析整图自动列出多个删除目标与保留内容：去路人保留主角/同行者和背景，支持点击人物身体标记要保留的人（最多 20 个，点位为整图百分比，可移除；不标记则自动识别，不明确时停止）；清杂物保留主要主体、必要附件及正常家具/装饰；全图文字清理删除文字/数字/字幕/水印/logo 而保留载体与非文字图形；房屋整理保留空间结构、装修、主要家具并清理临时杂物，不重装或移动家具。整图模式可附 ≤1000 字符补充要求，显式点击开始自动清理。视觉规划输出 ≤100 个带坐标/置信度的目标、保留主体和保护矩形，规划不适用、无目标、坐标无效或保护主体冲突时停止；图片生成后仅回填目标矩形的并集并向内羽化，保护矩形内与目标区域外保留原图解码像素。全部模式强制单张原尺寸 PNG，planning / generating / preserving 共用 300 秒可取消任务，保存为 remove_element 版本并关联原图；上传原图首次删除补建起始版本并作为父节点。失败/取消保留当前场景输入，退出侧栏不取消任务，成功返回对话展示结果。
- 图片变清晰：对当前图片调用图片模型的改图能力，提升细节和清晰度，同时约束模型保持原图的主体、文字、构图、比例、颜色和风格不变。
- 扩图：选择目标尺寸，以原图为核心自然补全新增画布区域。
- 去水印：视觉模型先判断 / 定位水印；确认存在后调用图片编辑模型修复遮挡区域。
- 去除背景：一键对当前整图进行语义抠图。视觉模型按主体面积、位置、清晰度、前景层级和互动关系判断最可能应保留的主要人物 / 动物 / 物体组，保留构成同一主要事件的对象及必要附件，排除远处、微小、模糊或无互动的陪衬元素，再由图片编辑模型只保留该主体并输出透明背景。该操作强制单图 PNG、`transparent=true`，只允许声明支持透明背景且支持 PNG 的 `edit_prompt` 图片模型；服务端在落库前用 Sharp 检查结果同时包含足量透明像素和可见主体，白底、纯色底、无透明通道或空透明图会以 `backgroundRemoval.*` 稳定错误码终止且不创建版本。
- 提取素材：点击后进入类似融合的画布右侧工具栏，收起项目对话；提供「框选提取（默认）/ 服装提取 / 饰品提取 / 表面图案 / 背景提取」五种快捷场景，每次进入默认框选提取。顶部退出入口与底部补充说明（≤1000 字符）/ 提取按钮固定，中间场景与截图预览独立滚动；支持框选或显式选择整图。用户可从图片内外起拖并越界框选，最终取与图片相交的有效区域。canvas 截图维持上限 2048px、最小边 256px、比例超 2:1 边缘补边、超大转 JPEG 的输入规范。视觉模型结合场景、框选内容和说明识别意图：默认模式保留主体原样；服装和饰品分离穿戴者及杂物，整理为居中、适度留白、浅色背景、柔和光影的商品展示，保留设计/材质/颜色/标识，仅对少量遮挡保守补全；表面图案去除载体并校正为平面素材；背景模式保留选区环境、移除前景主体并补全遮挡。没有合适目标、意图不明或无法可靠还原时停止，不调用图片模型。截图存为 extract 素材，视觉规划与图片编辑在同一可取消任务中完成（planning / generating）；失败或取消保留选区和说明，退出面板不取消任务，成功回到对话展示输出。输出关联原图和截图，上传原图首次提取补建起始版本。
- 提示词画廊：入口在工作台顶栏（模型选择旁带中文文案的「提示词画廊」胶囊按钮，窄屏自动收起副标题），对话与批量模式都可用。按分类浏览内置模板：对话模式把完整提示词填入对话框、风格提示词设为项目风格；批量模式把完整提示词追加为批量提示词列表的一行（自动切到列表页，满 50 条时拒绝追加），风格提示词在批量文生图时写入「统一风格提示词」、其余场景写项目风格。支持手动添加 / 编辑 / 删除“我的收藏”条目（可上传配图，纯文本亦可），上传图片后可调用视觉模型提炼完整提示词与风格描述；在工作台对画布主图、候选条、消息画廊中的图片点击右键，可一键收藏到画廊（视觉模型自动提炼提示词，失败时仅收图、提示词留空）。用户画廊数据存于 SQLite `gallery_entries` 表与 `data/gallery/` 目录，随完整备份 / 恢复。
- 暗色模式：`src/theme.tsx` 的 ThemeProvider 以 `data-theme` 属性切换 `html` 主题，偏好存于 localStorage（`layerive-theme`），暗色样式统一写在 `styles.css` 末尾的 `html[data-theme='dark']` 覆盖块；首页、工作台、模型配置三处顶栏均有切换按钮。
- 多语种切换：界面支持简体中文（默认）与 English，零依赖自研 i18n 模块 `src/i18n/`。`LanguageProvider` 挂在 `main.tsx` 的 ThemeProvider 内，偏好存于 localStorage（`layerive-language`），切换时同步 `document.documentElement.lang`、`document.title` 并经 preload 通知 Electron 重建原生菜单（启动期就绪前的桌面对话框保持中文回退）。`LanguageToggle` 按钮与暗色切换按钮并排出现在三处顶栏。全部 UI 文案以 `zh-CN.ts` 扁平字典为唯一 key 来源（`TranslationKey` 类型由此推导），`en-US.ts` 用 `Record<TranslationKey, DictValue>` 在编译期强制两语言 key 一致；带参数文案用 `{name}` 占位，`params.count` 存在且值为 `{ one, other }` 时按英文单复数取词。组件内经 `useLanguage()` 的 `t()` 取词；非 React 模块（如 `api.ts`）用模块级 `tf(key, fallback, params)`。服务端固定短语另有 `msg.*`（写库消息码）与 `err.*`（HTTP 错误码）命名空间。发给视觉 / 图像模型的规划提示词、画廊条目的 prompt / stylePrompt 属于内容而非 UI，不翻译；历史已入库消息无码时回退原文。

### 版本、对话与任务

- 版本树：上传图首次编辑时补建起始版本；每次成功生成 / 编辑均产生可分支的版本节点与输出图片。
- 历史操作：选择历史版本查看、从历史版本继续创作、查看可缩放 / 可平移的完整版本树。历史列表中的多图版本以候选缩略图拼图、数量角标和“多图 · N 张”标签区分；可从版本卡片或当前画布工具栏把该版本全部输出图下载为 ZIP，包内按 `V<版本号>-<两位序号>.<扩展名>` 命名。
- 对比：提供并排和滑块式前后图片对比。
- 版本删除：软删除版本；有子版本时需确认强制删除，后代会连接至被删节点的父节点；正在增量写入的批量版本必须先取消或等待结束，不能删除。
- 对话记录：保存用户提示词、模型名、参数、生成结果、系统事件、失败与取消信息。
- 异步任务：生成请求立即返回任务 ID，前端轮询任务状态；支持取消，服务重启会将未完成任务标记为失败。批量任务（批量改图 / 批量文生图 / 批量局部修改）复用一个 `generation_tasks` 主任务并增量发布图片；启动恢复会按任务关联处理所有仍为 `generating` 的版本（包含 `local_edit`）：已有输出保留为 `partial`，空版本自动软删除。复制或导入项目时，未完成任务会转为失败，关联版本按已有输出转换为 `partial` 或删除，不能留下没有执行器的生成任务。

### 模型管理

- 图片模型：新增、编辑、删除、连接测试、设置默认模型，并按能力控制工作台可用操作。图片预设（日日新、OpenAI、Gemini、Grok、自定义）只填充推荐初值；图片 API 协议独立选择 OpenAI Images、Gemini Interactions 或 Grok Images。每个模型保存可选尺寸、输出格式、透明背景和单次最大图片数，工作台和服务端均据此约束参数。
- 视觉识别模型：新增、编辑、删除、连接测试、设置默认识别模型；可选择 Anthropic Messages、Chat Completions 或 Responses API 格式（新建默认 Chat Completions），供改字、局部编辑、去水印、去除背景、提取素材规划使用。工作台顶部可为当前项目切换视觉识别模型，选择保存在项目 `draft.visionModelId` 中；旧项目或已删除的选择回退到全局识别默认模型。API Key 输入框可切换显示 / 隐藏。
- 模型日志：工作台右上角、模型配置按钮旁有项目级「模型日志」入口。弹窗展示最近 100 次视觉理解与图片模型调用的阶段、模型、状态、请求摘要、视觉模型返回的独立思考 / 推理字段（供应商未返回时明确标示）、结构化产出、生成提示词、耗时和错误；执行中每 2.5 秒刷新。日志只保存文本和元数据，禁止保存 API Key、请求图片 Base64 或模型返回的图片字节。
- 已适配图像提供商：OpenAI 兼容、SenseNova、Gemini、Grok；另有仅服务端兼容的本地 `mock` 演示路径。
- 已适配视觉请求：Anthropic Messages、OpenAI Chat Completions、OpenAI Responses，并保留 SenseNova 和 Dots（`askdiandian.com`）旧配置兼容。

## 3. 目录职责

```text
src/                        React 单页应用
  main.tsx                  React 挂载入口
  App.tsx                   顶层视图路由与全局项目/模型状态
  theme.tsx                 暗色模式 ThemeProvider（data-theme + localStorage）
  i18n/zh-CN.ts             简体中文字典（全部 UI 文案 key 的唯一来源）
  i18n/en-US.ts             英文字典（Record<TranslationKey, DictValue>，编译期强制与中文 key 一致）
  i18n/index.tsx            LanguageProvider、useLanguage/t/tf 与顶栏 LanguageToggle
  HomeView.tsx              项目库、创建、导入、备份恢复入口
  WorkspaceView.tsx         三栏工作台、图片操作、任务轮询、版本树/对比
  ModelConfigView.tsx       图片模型、视觉识别模型配置界面
  api.ts                    前端唯一的 HTTP API 封装及下载/上传辅助函数
  types.ts                  前后端共享的数据形状（前端侧）
  sizes.ts                  根据图片模型声明的尺寸生成比例选项及校验规则
  gallery.raw.json          提示词画廊源数据（分类含 zh / en 名称）
  gallery.ts                由脚本生成、供 UI 使用；不要手改
  styles.css                全站样式
server/
  index.mjs                 HTTP 路由、生成任务、模型调用、项目与备份逻辑
  db.mjs                    SQLite 初始化、目录常量、DTO 转换
  models.mjs                config/models.json 的读写、脱敏与模型规范化
  png.mjs                   演示图和缩略图的 PNG 工具
  local-edit.mjs            Sharp 图片规范化（含日日新请求副本）、坐标校验、选区细节裁剪、单区/多区域并集回填与保护区像素保留
  cleanup.mjs               整图删除场景、保留人物点位校验、视觉规划/多目标保护校验与删除提示词
  cleanup.test.mjs          整图删除隔离回归：四场景、四图片/三视觉协议、多区域像素保护、拒绝/取消与版本关联
  extraction.mjs            五种素材提取场景、意图识别与商品展示提示词规则
  extraction.test.mjs       隔离提取回归：五种场景、三种视觉协议、多候选、拒绝/取消与原图版本关联
  fusion.mjs                融合子模式、落点/要求校验、双图视觉规划规则和规划结果校验
  fusion.test.mjs           隔离融合集成测试：四种图片协议、三种视觉协议、拒绝/取消、输入关系与复制导入
  local-edit.test.mjs       局部编辑的隔离图片处理与 HTTP 集成回归测试
  backup-restore.test.mjs   备份恢复前校验、安全快照与重启信号回归测试
  restore-concurrency.test.mjs 恢复与在途生成互斥的回归测试
  model-connection.test.mjs 模型连接测试错误状态回归测试
  project-data.test.mjs     项目导入、草稿 ID、缺文件缓存和默认模型回归测试
  zip.mjs                   无额外依赖的 ZIP 读写
electron/
  main.cjs                  桌面窗口、原生菜单与本地服务生命周期；运行时将用户数据根目录传给 server/
  preload.cjs               沙箱 preload：经 contextBridge 把界面语言变化转发主进程以重建菜单
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

`App.tsx` 用组件状态在以下视图切换，不使用前端路由库；每次切换把当前视图写入当前标签页的 `sessionStorage`，启动时恢复并用项目列表校验其中的 `projectId`，从而在刷新或浏览器后台标签页回收后回到原工作台：

1. `home`：项目列表、导入/导出/完整备份、模型设置入口。
2. `workspace`：指定 `projectId` 的创作工作台。
3. `models`：图片模型和视觉识别模型的增删改、测试、设为默认。

全局语言状态由 `src/i18n/index.tsx` 的 `LanguageProvider` 提供（挂载于 `main.tsx`），context 暴露 `{ language, setLanguage, t, tf }`；组件渲染内一律用 `t()`（受 `TranslationKey` 类型约束），动态码（服务端 `err.*` / `msg.*`）与非 React 模块用 `tf(key, fallback, params)`，查不到 key 时回退 fallback（通常是服务端中文原文或用户内容）。新增 UI 文案时必须在 `zh-CN.ts` 加 key 并同步补齐 `en-US.ts`，类型检查会拦截遗漏；日期时间统一用 `localeFor(language)`（`zh-CN` / `en-US`）构造 `Intl.DateTimeFormat`，不要再硬编码 locale。

`WorkspaceView.tsx` 是核心 UI。它加载 `ProjectBundle`，把项目 `draft` 作为可恢复的工作台草稿；草稿修改会立即写入项目专属 localStorage 恢复副本，并在 900ms 防抖后 PATCH 回服务端，成功后清理副本。该组件还：

- 中间画布工具栏分两行：第一行显示当前版本，并保留缩放、对比和下载；第二行 `.canvas-edit-menu` 以图标 + 文案的横向菜单集中放置融合模式、局部修改、删除元素、提取素材、去除背景、扩图、变清晰、去水印和编辑文字。菜单项保持单行且不压缩，空间不足时只在第二行横向滚动，不能再把英文文案挤压或与上层操作混排。
- `.canvas-edit-area` / `.canvas-edit-body` 包裹画布；融合时 `.workspace-body.fusion-layout` 收起项目对话（保持挂载与状态），画布使用腾出的空间，退出融合后恢复对话。融合入口位于 `.canvas-edit-menu` 的最后（编辑文字之后）；进入后工具栏按钮改用关闭图标和「退出融合」文案。右侧 `.fusion-library` 桌面宽 280px，顶部 `.fusion-library-header` 固定显示紫色「退出融合」按钮及返回项目对话的说明，中间 `.fusion-library-content` 为唯一滚动区域，底部 `.fusion-library-footer` 固定显示拖拽/选中指引和带计数的补充要求输入框；生成中也可退出融合回到项目对话，任务继续运行并可在对话中取消。右侧 `.fusion-submenu` 为 2×2 图标卡片，附当前模式说明；参考图区含数量、虚线上传入口、粘贴快捷键、项目历史选择、棋盘背景缩略图及选中状态，主图上方不显示融合子菜单。窄屏融合时 `.workspace-shell.fusion-workspace` 保持视口高度，防止内容把首尾操作区撑出屏幕；退出后恢复常规工作台布局。融合任务的进度与取消按钮显示在该右侧栏，收起对话后仍可取消。融合图列表只存图片 ID 到 `draft.fusionImageIds`，另有 `draft.fusionType` / `draft.fusionInstruction`；融合上传调用 `/images` 的 `referenceOnly: true`，不复用会切换主图的常规上传。融合时工作台图片粘贴优先进入参考列表，文字输入仍优先粘贴文本；主图落点根据实际 `<img>` 内容边界计算，不把画框、空白区或缩放容器当作图片。
- 图片任务进行中，草稿快照与自动 PATCH 不携带顶层 `currentImageId`，避免此前防抖排队的保存把快速完成任务的新图片指针写回旧主图；任务结束并切换至输出图后恢复保存当前图片。草稿的输入图和融合参考列表仍照常保存，刷新时从服务端项目指针恢复画布。
- 右侧对话面板以「对话 / 批量」模式标签切换（组件状态，不入草稿；直接点「批量」默认进入批量文生图）：对话模式保留原消息列表与输入区；批量模式整体替换为批量面板，表单内容在 `.batch-panel-scroll` 内独立滚动，「开始生成」按钮和校验错误常驻底部 `.batch-panel-footer`，不随内容滚走。面板内含「批量改图（需画布图片 + `edit_prompt` 能力）/ 批量文生图（需 `text_to_image` 能力）」子模式、变量模板编辑器、提示词列表（含 TXT 导入）、变量值矩阵；尺寸、格式和透明背景均由当前图片模型声明控制，批量文生图另有「统一风格提示词」输入框（初始值取项目风格提示词）。提示词画廊按钮位于工作台顶栏（模型选择旁），两种模式都可用；`useGalleryPrompt` / `useGalleryStyle` 按当前面板和子模式把条目写入聊天输入框、批量提示词列表、项目风格或批量统一风格。
- 每 1.5 秒轮询正在生成的任务；完成后重新读取项目 Bundle。图片改字点击提交时会先用任务 ID 为空的 `activeTask` 表示视觉规划阶段，立即关闭文字编辑弹窗、在项目对话中展示等待状态并自动滚动到最新消息；服务端返回真实任务 ID 后开始轮询，提交失败则清除等待状态并重新打开原弹窗。
- 批量任务（批量改图 / 批量文生图 / 批量局部修改）共用约 900ms 的独立进度轮询分支；每当已处理数量增加就重新读取 Bundle，使新增图片、生成中的版本和项目当前图片立即可用。批量进度保留在画布下方，按任务的 `textBatch` / `localEdit` 标记区分文案，显示词条状态、缩略图、剩余数量与 ETA，任务结束后仍可查看或手动收起；切换到非该批次产出的历史版本时自动收起，避免候选列表与当前画布不一致。批量模板编辑器是命令式渲染的 `contenteditable`，只在面板/标签页/参考图变化时按状态重建，输入过程不重渲染以免光标跳动。
- 局部编辑提交后立刻显示等待状态，取得任务 ID 后收起浮窗，并按任务 `stage` 显示视觉定位 / 双图生成 / 框外还原进度（旧任务 compositing 阶段仍可展示）。失败或取消时在同一工作台会话恢复选区、文字与参考图；成功后清空。参考图只在本次操作中使用，不替换当前画布或项目草稿；切换画布图片会清除旧参考图并使未完成的文件读取失效。局部编辑浮窗有选区时，图片粘贴优先进入参考图，文本框仍保持文本优先。
- 监听 document 的 `paste` 事件：剪贴板含图片时复用上传流程（画布可直接 Ctrl+V 贴图）；文本框内文本优先，上传进行中忽略重复粘贴。
- 维护当前查看图片、下一次编辑的输入图片、图片模型、视觉识别模型、尺寸、输出格式、数量、透明背景等本地状态。工作台选择的视觉模型随项目草稿保存，并通过请求体 `visionModelId` 传给所有视觉理解操作；视觉请求进行中禁止切换，避免界面选择与已提交请求不一致。
- 使用百分比坐标 `{ x, y, width, height }` 记录文字/局部编辑/删除元素/提取素材选区；局部编辑、删除元素的框选模式和提取素材通过画布级 Pointer Events 与指针捕获支持从图片外起拖及越界拖拽，再将结果限制为图片内 0–100% 的有效交集；选区显示层必须以 `inset: 0` 对齐图片内容边缘，不能因容器已有边框而再次向内缩进；服务端和视觉模型提示词均以此为准。框选删除在有效选区松开时直接提交，无二次确认面板；失败或取消保留仍打开的模式与选区，不强制重开用户已退出的面板。
- 删除元素同样共用融合布局，以 `.cleanup-library` 展示五种场景；每次进入默认 selection，场景/说明/保留人物点位只保存在组件状态。框选模式使用原画布 Pointer Events、松开即提交；其余模式不接受删除框选，people 模式的主图点击按真实 img 边界添加百分比点位，画布标记与侧栏标签均可移除。首尾操作固定，中间独立滚动；场景切换清理选区/点位/说明，换图清理面板。生成中可退出并在对话继续取消，失败/取消不强制重新打开已退出的侧栏。
- 提取素材共用融合模式的 `fusion-layout` / `fusion-workspace` 扩展画布布局，通过 `.extract-library` 显示五种场景；场景只保存在组件状态，每次进入重置为 selection。圈选完成或点击「使用整张图片」后用 canvas 生成截图预览（`cropImageRegion()`），异步预览在选区/图片/模式改变后失效，提交随请求发送截图 base64 和 `mode`。规划/生成期间侧栏显示阶段与取消入口，退出可在对话中继续取消；切换画布图片清理选区和面板。局部修改、删除元素、提取素材与扩图等模式互斥，变清晰/去水印也会退出提取侧栏。
- 在版本树中按父子关系布局；从历史节点继续编辑会成为新的分支。
- 顶栏模型日志弹窗通过 `/api/projects/:id/model-logs` 读取项目最近调用；左侧按时间倒序列出记录，右侧展示提示词、推理 / 分析、请求与产出数据。弹窗打开期间独立刷新，不影响任务轮询。

前端不要直接访问 SQLite、`data/` 或模型配置文件；新增服务端能力时，先在 `src/api.ts` 增加封装和类型，再由组件调用。

## 5. 核心数据模型与不变量

浏览器本地版数据库在 `data/app.db`；桌面版数据库在 Electron `userData/data/app.db`。启动时由 `server/db.mjs` 创建表并启用外键和 WAL。`LAYERIVE_DATA_ROOT` 和 `LAYERIVE_CONFIG_ROOT` 可分别覆盖数据和模型配置目录，Electron 必须传入其 `userData` 子目录，确保升级不覆盖用户项目、图片或 API Key。数据库模式没有迁移框架；变更表结构时必须实现对旧本地数据库安全的迁移/兼容策略，并更新本文件。

| 表 | 用途 | 关键关系 / 约束 |
| --- | --- | --- |
| `projects` | 项目元数据与工作台草稿 | 维护封面、当前版本/图片、默认模型、收藏和软删除时间 |
| `messages` | 对话和系统事件 | 按项目保存用户提示词、生成结果、错误与取消记录 |
| `generation_tasks` | 异步生成任务 | 保存模型快照（去掉 API Key）、参数、输入、状态和错误 |
| `model_execution_logs` | 项目级模型执行日志 | 每次视觉 / 图片模型调用一条；保存阶段、脱敏请求摘要、文本产出、可用推理字段、耗时与错误，可选关联 `task_id`；不保存图片字节或 API Key |
| `image_versions` | 可分支版本节点 | `parent_version_id` 指向父版本；删除为软删除 |
| `images` | 上传和生成图片元数据 | 文件实际位于 `data/projects/<projectId>/...` |
| `version_inputs` | 版本输入图片关系 | 关联编辑/生成版本和源图片 |
| `text_recognitions` | 图片文字识别缓存 | 以图片、视觉模型 ID 和模型配置指纹缓存成功的文字分段；同一配置直接复用，切换或修改视觉模型则重新识别 |
| `gallery_entries` | 用户自建提示词画廊条目 | 配图存于 `data/gallery/`；source 为 manual / project；删除条目时同步删除配图 |

重要不变量：

- 上传图片先作为未版本化素材保存；服务端用 `readImageDimensions()` 读取 PNG/JPEG/WebP 的宽高并写入 `images.width` / `images.height`。第一次拿它编辑时，`ensureUploadVersion()` 会补建 `upload` 起始版本。
- 局部替换参考图保存在项目 `local-edits/`，`images.source_type` 为 `local_reference`，保持未版本化并带所属 `task_id`；新任务不再创建 `local_composite`。成功版本的 `version_inputs` 关联原图与参考图，父节点始终来自原图；参考素材不成为画布当前版本。历史 `local_composite` 素材与输入关系继续兼容保留。它们作为普通项目图片随复制、导出导入及备份保留，失败任务已保存的参考素材也会留存。`generation_tasks.input_json` 可附加 `stage`、`localEdit`（选区、意图、双图百分比坐标、规范化尺寸及视觉模型 ID；整图删除额外保存 cleanupMode / instruction / keepPoints / targets / keepRects / keepSubjects / confidence，不存图片字节）、`backgroundRemoval`（视觉模型 ID、保留主体、排除内容、判断依据和置信度）、`effectivePrompt`，或 `extraction`（mode、选区、说明、视觉模型 ID、识别主体；不存截图字节），或批量任务（`batch_edit` / `batch_generate`）的 `versionId` / `versionNumber` / `batch`（变量模式存模板与变量名数组，提示词列表模式存 `prompts` 数组；批量文生图任务额外带 `textBatch: true` 且无输入图；批量局部修改的 `batch` 额外带 `local: true` 且 `prompts` 为指令数组、逐项映射为 `{ 指令: 行内容 }`，任务同时带 `localEdit` 选区字段；均含总数、当前序号，以及逐项的变量值映射、状态、图片 ID、耗时和错误）；不存 API Key，不新增表或列，读取进度时兼容旧任务的单变量结构。
- 每个成功生成任务都会创建一个版本、写入所有输出图片、选第一张作为 `selected_image_id`，并更新项目的当前图片/版本/封面。前端点击候选条或消息画廊中的任意候选图时，同时更新 `currentImageId` 和 `inputImageId`，确保画布所见候选就是下一次继续创作的输入。
- 所有图片生成和编辑任务都把 `params.count` 规范为 1–4，并再限制为模型配置的 `maxCount`；服务端会把尺寸、输出格式和透明背景收敛为该模型声明的合法值。`callImageProviderBatch()` 以提示词数组为输入：单提示词时支持原生批量的协议优先使用 `n` 请求，兼容接口若忽略或拒绝 `n`，会按缺口补发单图请求（首波全部为限流错误时不再补发）；多提示词（拆分模式）一律逐条发 `count=1` 请求，输出顺序与提示词一一对应。所有扇出经 `mapWithConcurrency()` 限制为并发 2，单个请求对 429 / 限流类错误最多退避重试 2 次（约 1.5s / 4s，优先响应 `Retry-After`）。成功返回的图片统一写入同一版本，前端候选条与对话画廊展示全部结果；单图接口的多张生成意味着多次计费请求。
- 项目 Bundle 会隐藏软删除版本所属的图片，未版本化上传图片仍可见。
- 删除版本只软删除记录，**不会删除图片文件**。如被后续版本引用，须显式强制删除，后代会重新连接到被删节点的父节点。
- 服务重启时所有仍为 `generating` 的任务会被标为失败，不能尝试恢复执行。
- 服务端面向用户的固定文案（HTTP 错误与写库消息）都带稳定码：`httpError(status, code, message, params)` 抛出的错误经全局兜底返回 `{ error, code, params }`（中文 `error` 文本保持权威，便于旧客户端与测试）；任务失败 / 取消写入 `generation_tasks.error_json` 的内容为 `{ message, code?, params? }`，assistant 取消 / 错误消息与系统事件的 content JSON 同样可附 `code` / `params`。前端按 `err.*` / `msg.*` 字典本地化，查不到码回退中文原文；历史数据无码，保持中文展示。`friendlyModelMessage()` 返回 `{ text, code, params }`（安全审核 / 限流 / 额度 / 图片被拒各一类，未命中时 `code` 为 `null` 并原样透传平台信息）。
- `model_execution_logs` 的 `running` 记录在服务重启时标记为失败；日志随项目复制、单项目导出 / 导入和完整备份保留，复制或导入时仍在执行的日志改为已取消。日志文本单字段最多保存约 120,000 字符，超出会截断。日志 `phase` 保持中文存储，属诊断记录，不做界面翻译。

## 6. 一次图片创作的后端流程

所有图片任务最终通过 `startGeneration()` → `runGenerationTask()` 处理：

```text
前端 POST 操作
  → 校验项目、模型能力、输入图片与参数
  → 写 user message + generation_tasks(generating)
  → 异步调用供应商（常规总超时 120 秒 + 每多一张 +30 秒；多图意图判断或去除背景的视觉规划另 +60 秒；局部编辑含规划与图像处理总超时 300 秒）
  → 成功：写 image_versions、images、assistant result、更新项目指针
  → 失败/取消：只更新 task 并写 assistant error/canceled message
前端轮询 GET /tasks/:taskId，完成后重新 GET 项目 Bundle
```

- `operation: auto`：有输入图时为 `edit_prompt`，否则为 `text_to_image`。
- `/fusion` 校验项目内两张不同图片、四种子模式、0–100% 落点、补充要求与模型能力后立即返回 202；`startGeneration()` 的融合上下文在 `runGenerationTask()` 内规范化两张静态图片（EXIF 转正、sRGB、最多 4000 万像素，参考图最长边 ≤4096），调用视觉模型返回严格 `applicable` / `intent` / `edit_prompt` JSON，再把原主图和参考图按顺序送入图片模型。任务总超时 300 秒，两阶段共用 AbortController；任务 JSON `fusion` 保存 mode / point / instruction / referenceImageId / visionModelId / intent，不存图片字节或 API Key。成功事务写入两条 `version_inputs`（source / fusion_reference），旧 SQLite 表结构无需迁移。融合参考上传素材的 `images.source_type='fusion_reference'`，文件保存在项目 `uploads/`，不自动建立上传版本；从列表移出只改草稿，不删除项目素材。任务取消、重启、备份恢复与普通生成共用生命周期。
- 选择上传图片作为改图输入时，前端通过 `closestSizeForDimensions()` 把生成尺寸切换为当前图片模型声明的最接近宽高比；固定尺寸模型只能保证比例尽量一致，不能保证输出像素值与原图完全相同。
- 日日新 U1.5 Lite 的所有带图编辑在发往平台前会由 Sharp 生成临时请求副本：按 EXIF 方向转正并转为 sRGB，以工作台选中的合法尺寸作为画布（无合法尺寸时自动限制到 512–4096px、32px 整倍数及最大 3:1），等比缩放并用边缘像素补边，不改写项目原图；PNG 超过 10MB 时回退高质量 JPEG。`/images/edits` 固定传 `size: "auto"`，由规范化参考图决定输出比例。平台仍拒绝输入时，任务错误会保留经过截断与空白清理的原始平台信息，不能再用旧的统一尺寸文案覆盖具体原因。
- 项目风格提示词只追加到无输入图的文生图，避免重绘已有图片的风格。
- `/generate` 的多图意图判断在 `runGenerationTask()` 内使用工作台所选视觉模型（`visionModelId`，缺省回退全局识别默认模型）：数量大于 1 且提示词非空时把任务 `stage` 置为 `planning`，要求模型返回 `different` 与恰好 N 条可选子提示词。仅当 `different=true`、条数正确且互不重复时进入 `different` 模式并逐条生成；普通候选、含糊判断、条数不足或重复提示词均保守回退 `same` 模式，继续按原提示词生成 N 张。判断结果写入 `generation_tasks.input_json.promptMode`；不同提示词模式会为每个成功输出保留原始提示词索引，若部分请求失败则任务与版本为 `partial`，消息中的 `prompts` 只和实际输出图片一一对应。单张或空提示词不调用视觉模型；多图请求提交时即校验视觉模型存在，视觉请求硬失败则任务失败。旧消息的 `splitPrompts` 仅为历史展示兼容，新请求忽略该字段。
- `/batch-edit` 不走 `/generate` 的多图意图判断，也不使用图片接口原生 `n`：`startBatchEdit()` 校验模板中的全部变量及其等长值列表，先创建一个 `generating` 批量版本和主任务；`runBatchEditTask()` 再按图片行同时替换多个变量，形成完整提示词，并以 `count=1` 串行调用同一模型和同一参考图。旧调用方仅传一个变量的 `values` 数组时仍兼容。每张输出文件写完后用独立 SQLite 事务追加 `images`、更新任务 JSON；第一张同时设置版本选中图和项目指针。全部完成后写一条结果消息；混合成功/失败为 `partial`，全失败时软删除空版本，取消时保留已有输出。
- `/batch-generate` 复用批量任务的增量发布框架但不带输入图：`startBatchGenerate()` 校验模型 `text_to_image` 能力与模板 / 提示词列表（校验逻辑与 `/batch-edit` 共用），预建 `batch_generate` 版本与主任务；`runBatchGenerateTask()` 逐行替换变量或直接取列表提示词，可选 `stylePrompt`（≤2000 字符）以「，」追加到每条最终提示词末尾，不叠加参考图批次约束，`count=1` 串行调用文生图接口。任务 JSON 带 `textBatch: true`；增量发布、partial / 取消 / 空版本处理与 `/batch-edit` 一致。`/batch-edits/:taskId` 进度接口同时兼容两种 `operation_type`，并返回 `textBatch` 标记。
- `edit_text`、`local_edit` 与 `remove_element` 先调用视觉模型生成严格 JSON 的编辑提示词，再调用图片生成模型。文字编辑允许替换、清空删除及手动框选新增；文字编辑、局部修改和删除元素提交时按源图片宽高匹配当前图片模型最接近的支持比例，不能回落到模型默认的 1:1。
- `local_edit` 在校验后立即返回 202，视觉规划移入 `runGenerationTask()`。带 `reference: { data, mimeType, name? }` 时，后台用 Sharp 按 EXIF 方向规范化两图，最多解码 4000 万像素；参考图等比缩小至最长边不超过 4096px。视觉模型看到的图片与坐标计算使用同一份规范化数据，返回 `intent` / `target_rect` / `reference_rect` / `edit_prompt`。坐标必须有限且处于各自全图 0–100% 内，目标至少 80% 位于选区内，再限制为交集，否则终止。校验后的两图百分比坐标、替换意图和参考主体特征写入双图编辑提示词；图片模型收到同一份规范化完整原图和参考图，由内部 `referenceImages` 传递图2，不产生裁剪或合成图。生成后将结果缩放回原图尺寸，只拷贝选区像素并在内部最多 12px 羽化，以 PNG 避免框外二次有损压缩。自然融合质量仍依赖所选模型，选区应为主体衔接留出空间。
- `remove_element` 复用局部编辑的 300 秒任务和像素保留链路，不保存参考素材。旧调用缺省 mode=selection、仍要求 rect，原双图视觉规划与 ≥0.65 置信度/90% 选区覆盖校验保持一致。people / clutter / text / room 使用规范化的完整原图单图视觉规划，忽略输入 rect，以整图为分析范围；validateCleanupPlan 要求整体及每个目标 confidence ≥0.65 且 ≤1、合法百分比坐标、1–100 个目标、非空保留内容和 edit_prompt。people 必须提供保留人物矩形并覆盖所有用户 keepPoints；删除框包含点位或与任一保护矩形大幅重叠（≥目标面积 80%）时以 cleanup.protectedConflict 停止。无目标以 cleanup.noTargets 停止，不创建删除版本。最终提示词明确追加场景、目标和保留约束。输出经 preserveOutsideRegions 以每个删除矩形向内羽化权重的最大值组成并集，保护矩形权重置零，再按原尺寸 PNG 保存；矩形定位和遮挡补全效果依赖模型。失败/取消保留原图，原图首删时补建 upload 父版本。
- 局部编辑各阶段共享 AbortController；视觉请求另有 120 秒上限。所有生成任务写完输出文件后再次检查取消，再用无异步间隙的 SQLite 事务写版本、输入关系、图片记录、结果消息、任务状态和项目指针，避免取消时发布成功版本。文件写入失败 / 取消可能留下未被数据库引用的输出文件，但不会发布部分成功记录或覆盖原图。
- `recognize-text` 首次成功识别某张图片后，将分段结果持久化至 `text_recognitions`；再次打开“编辑文字”时，若工作台所选视觉模型 ID 和其 provider / API 格式 / Base URL / 模型名均未变化，则直接复用缓存，不再发送识别请求。`edit_text` 任务把修改后的完整文字快照与视觉模型指纹记录在 `generation_tasks.input_json.textEdit`，成功时为每张输出图写入对应 `text_recognitions`；替换后的文字成为新的 `originalText`，删除项不再返回，手动新增项保留框选坐标，全部删除时缓存合法的空数组。切换视觉模型会读取该模型自己的缓存或重新识别；缓存会随项目复制、导出导入和完整备份保留。
- `outpaint` 直接构建保留原图、仅扩展新增区域的提示词；`enhance` 直接构建提升清晰度、但不改变原图内容的改图提示词。
- `remove_watermark` 先让视觉模型判断并定位水印；若未发现水印则拒绝提交编辑。
- `extract_asset` 请求体携带 canvas 截图（base64）、百分比 rect、可选 mode（selection / clothing / accessory / pattern / background，缺省 selection）、hint（≤1000 字符）及 visionModelId。先校验场景、视觉模型、图片模型 edit_prompt 能力及截图，再保存未版本化 extract 素材（projects/<id>/extracts/），立即返回 202。后台视觉规划依据场景生成 subject / edit_prompt（applicable:false 时以 extract.notApplicable 停止，缺有效目标/提示词以 extract.invalidPlan 停止），最终提示词强制追加场景规则以防退化成普通主体提取；planning / generating 共用 AbortController、300 秒任务预算。保持当前模型数量/尺寸/格式，强制 transparent=false（服饰采用商品展示背景）。成功版本挂在原图版本下游，version_inputs 同时关联截图 source 与原图 original；失败/取消不发布提取版本。
- 模型必须声明能力。局部编辑、删除元素、去除背景、改字、扩图、去水印、提取素材映射为图片模型的 `edit_prompt` 能力；视觉识别模型仅用于理解与规划，不能出图。去除背景额外要求图片模型声明 `transparentBackground=true` 且输出格式包含 PNG。

## 7. 模型适配和安全注意事项

模型配置在 `config/models.json`（或 `LAYERIVE_CONFIG_ROOT/models.json`），由 `server/models.mjs` 管理。常规模型列表向前端返回时使用 `publicModel()`，API Key 显示为掩码；保存掩码值时保留原 Key。用户点击显隐按钮时，前端才通过 `POST /api/models/:id/api-key` 按需读取该模型的真实 Key；响应禁止缓存，不得把真实 Key 加回常规模型列表响应。

**本机访问限制（不要放宽）**：服务只监听 `127.0.0.1`，这挡得住局域网，挡不住浏览器——用户打开的任意网页都能请求 `127.0.0.1`。因此 `/api/`、`/files/`、`/gallery-files/` 一律先过 `assertLocalUiRequest()`：`Sec-Fetch-Site` 为 `cross-site` 的请求、Origin 主机名不是 `127.0.0.1` / `localhost` / `[::1]` 的请求，以及 Host 不是本机名的请求（DNS rebinding）都返回 403；不带浏览器 fetch 元数据的调用（curl、测试、Electron 健康检查）没有环境凭据，继续放行。所有响应都不再发送 `Access-Control-Allow-Origin`，跨源页面即使发出请求也读不到响应体。前端全部使用同源相对路径，`npm run dev` 经 Vite 代理到达，桌面版由本机页面发起，三种运行方式都不需要 CORS 授权。放宽任何一条都会让外部网页能够下载 `/api/backup`——那个 ZIP 里带着 `config/models.json` 和其中的 API Key。前端应用外壳（非 `/api/` 的 GET）不受此限制，以免从别处点链接打开应用时被拦。

| 图片 API 协议 | 图像适配实现 | 备注 |
| --- | --- | --- |
| `openai_images` | Images `generations` / `edits` | 编辑走 multipart；文生图走 JSON；日日新预设使用该协议时走专用 JSON 分支，生成默认 `watermark: false`、`prompt_extend: true`，编辑输入自动规范化并使用 `size: auto` |
| `gemini_interactions` | `/interactions` | 尺寸映射为 aspect ratio，返回图片块 |
| `grok_images` | Images `generations` / `edits` | 输入图以 data URL 放入 JSON |
| `mock` | 本地演示 PNG | 仅服务端兼容路径；配置 UI 的常规提供商集合不包含它 |

- 图片模型保存 `provider` 预设和独立的 `imageApiFormat`。预设只提供默认服务地址、模型、尺寸和输出能力，不得从 Base URL 推断并覆盖用户已保存的预设或协议。旧配置读取时按原 `provider` 补齐协议和能力字段；下一次保存写入新字段。`sizeOptions` 为最多 20 个合法 `宽x高` 值，`outputFormats` 只可含 PNG/JPEG/WebP，`maxCount` 为 1–4；服务端必须在每条图片任务开始时再次规范化这些值。
- 视觉模型以独立的 `apiFormat` 字段选择 `anthropic_messages`、`chat_completions` 或 `responses`。该字段缺失的旧配置不会被重写：`askdiandian.com` 自动沿用 Anthropic Messages，其余配置沿用 Chat Completions；旧 `provider` 字段继续原样保留，视觉请求根据 Base URL 识别 SenseNova 专用端点，避免隐藏的旧提供商值干扰用户修改后的地址。
- 项目工作台发起的视觉请求可携带 `visionModelId`。`visionModelOrThrow()` 优先严格解析该 ID；未携带时才沿用全局 `active_vision_model`，以兼容旧前端和其他调用方。请求的模型已删除时返回 400，不得静默切换到另一个模型。
- `visionEndpoint()` 根据 Base URL 和 API 格式补全 `/v1/messages`、`/chat/completions` 或 `/responses`；若用户已填写完整端点则不会重复拼接。
- `callVision()` 同时接受单张图片或按顺序排列的图片数组；Anthropic Messages、Chat Completions（含 SenseNova 两条兼容路径）、Responses 均按各自协议发送多张图片。局部替换固定图1为原图、图2为参考图；不支持多图理解的模型会使该任务失败，不降级为只看一张。
- `callVision()` 可按调用传入 `maxOutputTokens`，分别映射到各视觉协议的输出上限字段；四种整图清理使用 8192，以容纳多目标及保护区规划，其余调用保持原有默认值。
- 图片适配器通过内部 `referenceImages` 保留有序多图输入，融合和参考图局部修改（含批量）固定传原图+参考图：OpenAI Images 多图用 multipart `image[]`（原单图仍为 `image`），SenseNova JSON 用 `images` 并逐张生成规范化请求副本，Gemini Interactions 追加有序 image 块，Grok 多图用 `images` 数组（原单图仍用 `image`）。日志只额外记录 `inputImageCount`，不得存二进制或 Base64。自定义兼容网关/模型不一定支持多图，不得丢弃参考图静默降级。
- `callVision()` 会从 Chat Completions 的 `reasoning_content` / `reasoning`、Anthropic 的 thinking / reasoning 内容块和 Responses 的 reasoning 输出中提取供应商显式返回的推理文本写入模型日志；不得把普通结构化结果伪装成隐藏思维链。图片模型日志在 `callImageWithRetry()` 层记录一次逻辑调用（含限流重试总耗时与尝试次数），仅记录输出数量、格式、尺寸和字节数等元数据。
- SenseNova 视觉模型有两条不同的兼容路径：旧融合模态服务 `api.sensenova.cn/v1` 使用 `/llm/chat-completions` 和 `max_new_tokens`；Token Plan 的 `sensenova-6.8-flash-lite` 等模型使用 `token.sensenova.cn/v1/chat/completions`、标准 `max_tokens` 与 OpenAI Vision 图片块。不得仅按 `sensenova.cn` 域名笼统选择旧路径。
- `normalizeBaseUrl()` 会移除末尾的 `images/generations` 或 `images/edits`，避免重复拼接路径。
- 不要读取、输出、提交或写入示例真实 API Key；`config/` 和 `data/` 已被 Git 忽略。
- 新增供应商或参数时，必须同时检查：`types.ts`、`ModelConfigView.tsx`、`sizes.ts`、`models.mjs`、`index.mjs` 的调用适配和模型测试逻辑。

## 8. HTTP API 概览

所有 JSON 错误为 `{ error }`，校验类错误额外携带 `code`（稳定错误码，前端映射 `err.*` 字典）与 `params`（插值参数）；生成与编辑接口返回 `202` 和 `{ taskId, status, userMessageId }`。

| 路径 | 主要方法 | 用途 |
| --- | --- | --- |
| `/api/health` | GET | 本地服务健康检查 |
| `/api/projects` | GET / POST | 项目列表、创建 |
| `/api/projects/:id` | GET / PATCH / DELETE | Bundle 查询、项目/草稿更新、项目软删除 |
| `/api/projects/:id/images` | POST | 上传 PNG/JPEG/WebP（最大 10MB）；可传 `referenceOnly: true` 保存静态融合参考素材并保持主图/封面不变 |
| `/api/projects/:id/fusion` | POST | `imageId`、`referenceImageId`（同项目且不同）、`modelId`、`visionModelId?`、`mode: basic / outfit / pose / group`（默认 basic）、`point: {x,y}`（主图百分比落点）、`instruction?`（≤1000 字符）、`params?`；202 单图融合任务，阶段 planning / generating，成功为 fusion 版本 |
| `/api/projects/:id/generate` | POST | 文生图、图生图、提示词改图；数量大于 1 且提示词非空时可传 `visionModelId`，服务端自动判断普通候选或分别生成 |
| `/api/projects/:id/batch-edit` | POST | 创建批量改图任务：变量模式传 `imageId`、`modelId`、含 1–10 个 `{{变量名}}` 的 `template`、`quantity`（2–50）、`variables: [{ name, values }]`（每个 values 长度等于 quantity）；提示词列表模式改为传 `prompts: string[]`（2–50 条、单条 ≤1000 字符，数量由行数决定），以及可选 `parentVersionId` / `params`；兼容旧单变量 `values`，返回任务和预建版本 ID |
| `/api/projects/:id/batch-generate` | POST | 创建批量文生图任务（无输入图）：`modelId`、同上的 `template` / `quantity` / `variables` 或 `prompts` 录入方式、可选 `stylePrompt`（≤2000 字符，追加到每条提示词）与 `parentVersionId` / `params`；要求模型具备 `text_to_image` 能力，返回任务和预建 `batch_generate` 版本 ID，进度走 `/batch-edits/:taskId` |
| `/api/projects/:id/batch-edits/:taskId` | GET | 查询逐项批量进度（兼容 `batch_edit` / `batch_generate`）、即时输出图片、完成/失败/剩余数量、`textBatch` / `localEdit` 标记及 ETA |
| `/api/projects/:id/{recognize-text,edit-text,local-edit,remove-element,remove-background,outpaint,enhance,remove-watermark,extract-asset}` | POST | 专项图片操作；使用视觉能力的请求可传 `visionModelId`；`remove-background` 强制单张透明 PNG，并校验 Alpha |
| `/api/projects/:id/extract-asset` | POST | imageId、modelId、visionModelId?、rect、crop: {data,mimeType,padded?}、mode?: selection / clothing / accessory / pattern / background（默认 selection）、hint?（≤1000 字符）、parentVersionId? / params?；202 可取消任务，阶段 planning / generating，成功为 extract_asset 版本并关联原图/截图 |
| `/api/projects/:id/local-edit` | POST | `imageId`、`modelId`、`visionModelId?`、百分比 `rect`、`instruction`、`params?`；可附 `reference: { data, mimeType, name? }`，有参考图时 instruction 可为空；校验后即返回 202，后台规划双图替换并保留框外像素，新任务阶段 planning / generating / preserving |
| `/api/projects/:id/remove-element` | POST | imageId、modelId、visionModelId?、mode?: selection / people / clutter / text / room（默认 selection）；selection 要求百分比 rect，其他模式整图分析、可传 instruction（≤1000 字符），people 可传 keepPoints: [{x,y}]（≤20 个整图百分比点位）；可选 parentVersionId / params；202 可取消任务，阶段 planning / generating / preserving，单张原尺寸 PNG，其他模式只回填目标区域并保护保留主体 |
| `/api/projects/:id/local-edit-batch` | POST | 批量局部修改：`imageId`、`modelId`、`visionModelId?`、百分比 `rect`、`instructions: string[]`（2–50 条、单条 ≤1000 字符）、可选 `reference` / `parentVersionId` / `params`；每个子项独立运行局部修改流水线（含各自视觉规划；有参考图时传有序完整双图并保存参考素材），逐张追加到同一 `local_edit` 版本，返回任务和预建版本 ID，进度走 `/batch-edits/:taskId` |
| `/api/projects/:id/tasks`、`/tasks/:taskId`、`/tasks/:taskId/cancel` | GET / GET / POST | 查询和取消生成任务 |
| `/api/projects/:id/tasks/:taskId` | GET | 单任务响应含可选 `stage: planning / generating / preserving`（兼容历史 compositing；旧任务可为 null）与 `errorCode` / `errorParams`（错误码及插值参数，配合 `msg.*` 字典本地化） |
| `/api/projects/:id/model-logs?limit=100` | GET | 查询当前项目最近模型调用日志，`limit` 范围 1–200；返回脱敏请求摘要、结构化产出、供应商显式推理字段、最终提示词、耗时与错误 |
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

- 单项目导出格式为 ZIP（当前 `project.json` 格式版本为 2），含可选 `files/` 图片、文字识别缓存和项目模型日志；所有 ZIP 写入和读取统一限制为最多 10,000 条、单条 512MB、解压后总计 2GB，避免导出应用自身不能导入的文件。导入会先校验全部 ZIP 条目和元数据图片路径为不含绝对路径 / `..` 的安全相对路径，在独立暂存目录写入并以 SQLite 事务创建项目。导入会生成新的项目及所有关联 ID，草稿、消息、任务与模型日志中的任务引用也会重映射；缺失的图片文件保留素材关系和文字缓存并提示。旧版本导出包缺少缓存或模型日志字段时仍可正常导入。
- 项目“复制”也会复制磁盘图片和全部关系数据，并重映射 ID；草稿、任务 JSON 中的输入图、批量版本及批量项输出图片 ID 也必须同步重映射。
- 融合参考列表 `draft.fusionImageIds` 与任务 `input_json.fusion.referenceImageId` 在项目复制和导入时也必须重映射；版本的主图与参考图输入关系随标准 `version_inputs` 一起复制/导入。
- 完整备份含数据库、所有项目图片、`data/gallery/` 画廊配图和 `config/models.json`，因此可能含 API Key。恢复会先进入维护状态，拒绝新请求，取消并等待在途任务完成；再解压到隔离目录，拒绝路径穿越和未知条目，以 SQLite `integrity_check`、外键检查以及当前全部必要表/字段校验备份。随后 checkpoint 当前数据库，在当前 `DATA_ROOT/backups/<timestamp>/` 留一份含数据库、项目、画廊与模型配置的安全备份，最后替换数据并启动新的服务进程。服务启动时根据数据库为所有未删除项目重建标准目录。桌面版由 Electron 接管恢复后的服务重启，不能由脱离的服务进程接管。
- 这些操作具有高数据风险。修改其逻辑前，必须先评估 SQLite WAL、一致性、失败回滚、路径穿越防护，以及 Windows 文件锁行为。

## 10. 修改指南

1. 先阅读相关文件和该功能的 API 路由；不要仅修改 UI 假装功能完成。
2. 保持 `src/types.ts`、`src/api.ts`、服务端响应和数据库 DTO 的字段命名一致（前端为 camelCase，数据库列为 snake_case）。
3. 增加图片操作时，复用异步任务机制、版本关系、消息记录和任务轮询；不要在请求中长时间阻塞 HTTP 响应。
4. 改动数据库、版本删除、导入导出或恢复前，保护用户现有 `data/`；不要使用会清空整个工作区的 Git/删除命令。
5. 改动样式前先确定组件实际使用的 class；全局样式均在 `src/styles.css`。
6. 新增或修改 UI 文案时，必须在 `src/i18n/zh-CN.ts` 添加 key 并同步补齐 `src/i18n/en-US.ts`（`Record<TranslationKey>` 类型检查会拦截遗漏）；服务端新抛错用 `httpError(status, code, message, params)` 带稳定码，并同步在前端字典补 `err.*` 词条，写库的固定消息同理补 `msg.*`。
6. 修改画廊源数据后运行 `node scripts/build-gallery-ts.mjs`，并提交/保留生成的 `src/gallery.ts` 与源 JSON 的一致性。`parse-gallery.mjs` 依赖仓库外的 `GPT-Image2-Skill` 目录，不应作为日常构建步骤假定可用。
8. 完成后至少运行 `npm run lint`；涉及构建、静态资源或入口时运行 `npm run build`。涉及真实模型时不要擅自发送用户图片或消耗用户额度，除非任务明确要求。
9. **完成任何影响本说明范围的改动后，必须同步更新本 `AGENTS.md`。**
