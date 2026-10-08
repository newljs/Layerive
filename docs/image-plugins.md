# 内置图片操作插件（API v1）

最后核对：2026-10-04。

第二阶段已将全部九项专项图片操作迁移为随应用一起发布的内置插件：局部修改、删除元素、素材提取、融合、去除背景、去水印、变清晰、扩图和文字编辑。局部批量修改复用局部修改插件的规划与结果处理。功能入口、场景、模型协议、编辑约束和历史操作类型保持兼容。

本阶段没有外部 JavaScript 安装器、热加载、市场或权限沙箱。文生图、普通提示词改图、通用批量调度与首次文字识别/缓存查询仍是宿主基础能力。

第三阶段增加了声明式插件。现有九项代码插件保持原路径；新的标准操作只需新增 `server/plugins/recipes/<目录>/plugin.json`，服务启动时扫描目录、校验并注册，前端通过 `/api/plugins` 自动生成按钮、表单、任务进度和版本名称。当前附带第十项操作“黑白照片上色”（`layerive.colorize`），用于验证该扩展路径。

## 新增声明式插件（推荐）

复制 `server/plugins/recipes/colorize/plugin.json` 到新目录，修改 ID、版本、operation、route、双语元数据、参数和 workflow，然后重启服务、刷新页面。不改 `server/index.mjs`、`server/plugins/index.mjs`、`WorkspaceView.tsx` 或前端注册表；也不需要为纯 JSON 插件重新构建前端。发行时仍需把目录随应用资源一起打包。它是应用资源扩展方式，尚未提供最终用户的安装/卸载、启停或热加载功能；插件文件不属于用户项目备份。

| 声明 | 规则 |
| --- | --- |
| id / version / apiVersion | 唯一命名空间 ID、三段版本号、API 1 |
| operation / route | 分别使用 `recipe_` / `recipe-` 前缀，避免覆盖宿主路由；必须唯一 |
| timeoutMs | 1000–300000 毫秒；所有阶段共用一个任务信号 |
| requirements | image 固定 `["edit_prompt"]`；vision 与 workflow.vision 一致；存在 image 参数时 multipleImages 为 with-reference，否则 none |
| ui.name / description | 插件内容元数据，必须同时提供 zh / en；应用通用控件文案仍来自主 i18n 字典 |
| ui.icon | sparkle / image / edit / background / extract |
| ui.fields | 最多 12 项；key 唯一；label 必须双语；支持 required 与 default |
| text | 必须声明 maxLength（1–2000），可选文本框 |
| select | 1–20 个唯一 value 与双语 label，默认值必须属于选项 |
| boolean | 只接受布尔值，false 也是合法值 |
| number | 必须声明有限数值 min / max；请求值必须为范围内数值 |
| image | 至多 3 项；值为同项目图片 ID，不接受模型 URL / 本地路径 / Base64；不能选择主图自身，无默认值 |
| workflow.vision | 可选的视觉规划指令；宿主追加有序图片说明、参数及严格 applicable / edit_prompt JSON 契约 |
| workflow.prompt | 图片编辑约束；宿主追加参数和视觉规划；不执行模板代码、脚本、表达式或任意网络请求 |
| workflow.output | format 为 png/jpeg/webp，transparent 为布尔值（true 必须 PNG），dimensions 为 any/source |

流程固定为输入/模型能力校验 → 原图与可选参考图规范化 → 可选视觉规划 → 原图片适配器 → Sharp 输出校验/转码 → 原版本事务。图片按原图、字段顺序参考图排列；视觉规划拒绝或不合法时不调用图片模型。source 尺寸规则要求结果宽高等于规范化原图，尺寸不符直接失败，不自动拉伸；transparent=true 同时验证足量透明像素与可见像素；false 拒绝任何 Alpha <250 的明显透明像素，避免把空透明图或异常透明背景作为上色成功结果。当前校验不判断图片语义质量。

`GET /api/plugins` 为声明式条目额外返回 `kind: recipe` 与 `ui`（无 workflow 提示词）。新增 `errors` 数组报告启动时被跳过的目录；无效 JSON、字段、重复 ID/operation/route 被隔离，不阻断原有插件。根目录缺失/不可读同样记录 errors，保留九项代码插件可用。只读取固定资源目录中的普通子目录及 ≤64KB 的普通 plugin.json，拒绝符号链接，不动态导入 JS。目录变更需重启；界面的重试按钮仅重新获取当前服务清单。

`POST /api/projects/:id/plugins/:pluginId/run` 参数为 `{ imageId, modelId, visionModelId?, fields, params?, parentVersionId? }`。未知字段、类型/长度/范围错误、跨项目参考图与不支持的模型输出规则会在调用模型前拒绝。运行期使用 `plugin.notApplicable`、`plugin.invalidPlan`、`plugin.invalidOutput` 稳定错误码。

通用表单支持项目素材选择和静态图片上传，上传复用 referenceOnly 路径，保持主图/封面不变。上传素材沿用现有 fusion_reference 存储类型，执行后的输入关系使用 plugin_reference。任务 JSON 在 `recipe.fields` 只保存普通参数，图片 ID 单独放在 `recipe.referenceImageIds`；复制/导入会重映射该字段，输入关系仍用 version_inputs。表单内可查看进度/取消，关闭表单不会取消任务，可在对话中继续取消；保持面板打开时失败/取消保留填写内容，成功后自动关闭。当前通用表单参数仅存在组件会话中，关闭或刷新后回到默认值，不宣称持久化草稿；运行中任务仍可在刷新后恢复轮询，已保存结果可在缺少插件时查看（名称回退 operation）。

上色插件提供自然/复古风格、保留颗粒、补充说明和可选色彩参考。视觉模型判断是否适用，输出保留人物身份、结构、文字和明暗关系；不确定的历史颜色由模型推断，不承诺还原真实原色。生成数量/尺寸使用当前工作台模型参数，输出固定 PNG、非透明。

## 文件与职责

| 文件 | 职责 |
| --- | --- |
| server/plugins/catalog.json | 前后端共用的 ID、版本、操作类型、旧路由、超时和模型能力需求 |
| server/plugins/index.mjs | 显式注册内置实现；请求参数不能指定模块文件 |
| server/plugins/registry.mjs | 注册校验、索引、能力检查、规划/后处理的取消与输出检查 |
| server/plugins/recipe.mjs、recipes.mjs | 声明校验、通用规划/输出流水线、资源目录发现及故障隔离 |
| server/plugins/recipes/*/plugin.json | 独立的 JSON 插件声明；当前包含 colorize |
| server/plugins/host.mjs | 项目/任务范围内的服务接口；凭据留在宿主模型快照中 |
| server/plugins/{local-edit,remove-element,extract-asset,fusion}.mjs | 操作输入校验、规划与结果要求 |
| server/plugins/{edit-text,remove-background,remove-watermark,outpaint,enhance}.mjs | 文字规划与输出快照、透明主体校验、水印规划、扩图及清晰度提示词 |
| server/plugins/preserve-output.mjs | 请求宿主执行单区或多区像素保护的共用后处理 |
| server/index.mjs | HTTP、材料文件、模型适配/重试、任务生命周期、SQLite 事务和版本发布 |
| src/plugins/catalog.ts、registry.ts | 清单读取、工作台面板/按钮定义、历史任务类型映射 |
| src/plugins/*Panel.tsx | 六个独立面板（含扩图与文字编辑）；无面板的三项操作只注册按钮；复用原 DOM、样式、国际化和交互回调 |
| src/plugins/RecipeCatalog.tsx、RecipeTools.tsx、RecipeDialog.tsx、PluginOperationName.tsx | API 清单、动态入口、通用表单与本地化操作名称 |
| src/WorkspaceView.tsx | 共享画布、框选/粘贴、互斥操作状态、草稿、任务轮询与版本展示 |

工作台保留共享状态和事件编排。声明式插件共享一次性接入的通用入口，新增标准操作无需逐个接线；增加新的框选/拖拽等画布交互仍需扩展宿主或使用独立代码面板。

## 执行契约

插件导出一个对象：

| 字段/方法 | 契约 |
| --- | --- |
| id / version / apiVersion | 稳定命名空间 ID / 三段版本号 / 当前为 1 |
| operation / route | 持久化操作类型 / 兼容路由名；注册时都必须唯一 |
| requirements | image 为所需基础图片能力数组；vision 为是否使用视觉模型；multipleImages 描述多图条件 |
| timeoutMs | 单任务总超时，包括规划、生成、后处理 |
| create(host, input) | 校验请求，返回 host.generation(request, state)；此阶段不得调用远程模型 |
| taskInput(state) | 返回可持久化的初始阶段/文本元数据；禁止图片字节、Base64、密钥和模型配置对象 |
| prepare(host, sourceImage, state) | 在任务 AbortSignal 下规划，返回 image、prompt，可附 inputs、outputMetadata 和后处理数据 |
| processOutput(host, prepared, output) | 可选；对每张结果后处理，返回 bytes / mimeType，支持 width / height |
| generationPhase | 可选的图片模型日志阶段文案 |

宿主流程：

1. 解析插件、验证项目与维护状态，运行 create。
2. 检查图片模型能力并规范化参数，补建首次上传版本，写消息与任务。
3. 在共用 AbortController 下运行 prepare；失败或拒绝则停止，不调用图片模型。
4. 宿主按原有图片协议、并发、限流重试和候选图规则生成。
5. 对每张输出运行 processOutput，随后检查取消状态。
6. 宿主写文件、事务发布版本/输出/输入关系及支持的输出元数据、更新项目指针与任务。

prepare 返回的 image 沿用模型适配层输入形式。双图使用主图对象的 referenceImages 数组；顺序固定为主图、参考图，不能丢弃参考图静默降级。inputs 为附加版本关系数组，例如 [{ imageId, role: 'fusion_reference' }]；宿主再次验证图片属于当前项目后写入，source 关系由宿主自动写入。

局部修改有参考图时返回 source / rect 并使用 preserveOutput。删除元素返回 source / rect，或 source / regions / protectedRegions。融合不使用像素回填。纯文字局部修改保持旧行为，不额外回填。

multipleImages 是插件需求说明，不表示用户配置的兼容服务已通过能力验证。现有图片服务仍通过实际协议请求判断是否支持多图，失败则报告错误。

`outputMetadata.textRecognition` 是目前唯一支持的输出元数据，使用 `host.textRecognitionSnapshot(model, segments)` 构造。包含模型 ID、配置指纹、名称和规范化文字分段；成功事务为每张输出写入识别缓存（包括空快照）。插件不访问数据库，不提供任意 SQL 或事务回调；失败/取消不写输出缓存。增加其他元数据种类时，需先扩展宿主的存储契约。

去背景的 Alpha 校验已由插件 `processOutput` 执行；强制单图、PNG、透明参数与主体/透明像素占比校验保持原规则。扩图和变清晰不调用视觉模型。九项插件任务统一使用 300 秒总预算；普通生成仍沿用按图片数量计算的超时。

## 宿主接口

host 自带 projectId；执行期另有 taskId、signal。接口兼容现有辅助函数参数，但内部把项目和任务强制绑定到当前上下文。

- readModels()、visionModelOrThrow(config, id)：获取不含 API Key 的配置副本与视觉模型元数据。
- hasModelCredentials(model)：读取宿主计算的可用凭据标记，本地空 Key 仍合法。
- callVision(model, image, instruction, signal, logContext, options)：宿主用创建时捕获的真实配置调用模型并记录日志；不接受插件传入的凭据或服务地址覆盖。
- imageOrThrow(projectId, imageId)、readImage(image)、providerInputBytes(image)：按当前项目查询/读取素材。
- ensureUploadVersion(projectId, image)、saveExtractMaterial(bytes, mimeType, dimensions)、saveLocalEditMaterial(projectId, taskId, image, type)：素材持久化与原图版本补建。
- listMaterials(types)：读取本任务指定类型的素材关系；局部批量保留原有累计素材关联策略。
- updateTask(patch)、updateTaskInput(taskId, patch)：更新当前任务阶段与文本元数据；localEdit 字段保留旧有合并语义。
- preserveOutsideRegion / preserveOutsideRegions：共用 Sharp 像素处理。
- parseVisionJson、httpError：解析视觉输出与使用现有稳定错误码。
- imageOptions(model)：读取图片模型支持的尺寸、格式、透明背景和数量。
- textRecognitionSnapshot(model, segments)：按宿主捕获的真实配置生成文字缓存指纹与规范化快照，忽略插件传来的模型地址覆盖。

这些接口用于分离职责，不构成不可信代码隔离。内置插件不得导入数据库或模型配置文件，不得自行访问真实模型网络端点。

## 新增复杂代码插件

1. 在 catalog.json 声明插件元数据；复制最接近的插件作为起点（融合适合双图，提取适合单图视觉规划）。
2. 实现 create / taskInput / prepare；有需要再实现 processOutput。在 plugins/index.mjs 显式注册。
3. 后端自动支持 POST /api/projects/:id/plugins/:pluginId/run，以及清单中的旧路由别名；无需添加主生成器分支。
4. 在 src/plugins 中实现面板、在 registry.ts 注册按钮和任务类型；需要新交互时在 WorkspaceView 接入共享画布。API 调用使用 api.runImagePlugin(projectId, pluginId, input)。
5. 增加两种语言文案、错误码及必要任务/历史显示映射。
6. 新增持久化图片/版本 ID 字段时，必须同步检查 remapTaskInputJson、项目草稿重映射和复制/导入测试。不要把 ID 藏在任意字符串中。
7. 用隔离模拟服务验证成功、规划拒绝、模型失败、取消、输出要求、历史关系和复制导入；更新 AGENTS.md。

server/plugins.test.mjs 的 example.product-photo 展示了一个未在主执行器出现的操作，使用同一注册、规划和后处理机制。

## 数据与旧接口兼容

- 九项原专项路由均映射到同一插件入口；局部批量路由不变。`/generate` 若明确传入已注册专项 operation，也转入插件校验，避免绕过去背景等输出规则；普通 auto/text_to_image/edit_prompt 行为不变。
- 新 GET /api/plugins 返回公开元数据；POST /api/projects/:id/plugins/:pluginId/run 返回原 GenerateResult。
- 新任务在 generation_tasks.input_json.plugin 保存 { id, version, apiVersion }；任务查询附带可空 plugin。旧任务缺少该字段时仍可读取。
- 原 operation_type、阶段、错误码、参数和 localEdit / fusion / extraction JSON 结构保留；SQLite 没有新增表或列。
- 复制/导入保留插件版本信息，原 ID 重映射和版本关系继续有效；历史图片查看不需要执行插件。
- 服务重启仍将未完成任务转为失败，不恢复执行历史插件版本。版本信息用于追踪，不承诺旧版本代码重放。
- Electron 的现有 server/** 资源规则包含嵌套插件与清单；前端构建把共用清单打入 dist，无新增运行时依赖。

改字和去水印不再等待视觉规划结束才返回任务 ID：输入校验成功即返回 202，规划使用任务信号且支持取消。无水印、视觉请求失败等运行期错误通过任务查询返回原错误码；输入不合法仍同步返回 4xx。改字在当前工作台会话失败/取消时恢复编辑弹窗与已填内容。初次识别文字仍通过 `/recognize-text` 返回识别结果。对话中改字记录修改项、去水印记录操作摘要；实际模型提示词保存在 `effectivePrompt` 和模型日志中。

## 验证

运行 npm run lint、npm run build、npm test。原有回归覆盖服务端基线；plugins.test.mjs 验证扩展契约、取消、能力与凭据边界，plugin-api.test.mjs 验证九项原操作与上色插件的通用/别名入口等价、未知插件拒绝、访问限制与复制/导入，以及改字/去水印/去背景规划取消、拒绝不出图、失败不发布版本与同步输入校验。generation.test.mjs 继续覆盖文字快照多候选/全部删除和透明结果拒绝。

测试只使用本地生成的图片及 work/*-test-* 隔离目录，不读取用户数据库或调用真实模型。模拟服务回归确认软件行为兼容，不能代替实际模型的生成质量评估。

2026-10-03 本次迁移验证：改动前 18 项基线测试通过；迁移后全量 23 项测试通过，lint / build 通过。浏览器使用隔离数据库和本地模拟模型检查了融合子模式及生成、素材提取场景及整图预览/生成、局部框选与批量表单/提交、删除场景与人物点位增删/框选生成、版本结果与刷新恢复；浏览器错误日志为空。生产构建仍提示单个 JS 包超过 500 KB。Electron 资源匹配规则已核对，本次未重新制作三端安装包。

2026-10-03 第二阶段验证：全量 28 项测试通过，新增取消/拒绝/失败子用例与九插件入口对照通过，文字快照随复制/导入保留且失败不新增缓存；lint / build 通过。隔离浏览器检查了改字生成与缓存继承、规划取消后弹窗/输入恢复、扩图面板与提交、变清晰、水印规划/生成、去背景生成和版本展示；刷新能恢复工作台，浏览器错误日志为空。保留原有大包体积警告，未调用真实模型或重新制作安装包。

2026-10-04 第三阶段验证：全量 34 项测试通过，lint / build 通过。声明式插件测试覆盖无需修改注册代码的目录发现、坏清单和重复 ID 隔离、字段/默认值/跨项目参考图拒绝、有序多图、跳过视觉、规划拒绝、输出格式/尺寸/透明校验与取消；复制/导入重映射参考图。隔离浏览器验证上色入口与自动表单、参考图选择和上传、规划进度、成功版本名称、取消后保留参数及中英文切换，浏览器错误日志为空。测试仅使用模拟模型，不代表真实上色质量；保留原有大包体积警告，未重新制作安装包。

2026-10-04 全面检查：修复任务终态刷新失败后停止轮询、旧请求/重叠轮询、通用弹窗粘贴图片影响底层画布、父版本跨项目引用、插件根目录不可读启动失败、非透明输出放行及 null 规划错误；另修复 Windows 项目导入目录临时占用的有限重试。37 项服务端测试、lint/build 通过。浏览器注入一次终态项目刷新 503 后确认自动恢复，验证弹窗焦点、文本/图片粘贴和刷新恢复。详细记录见 review-2026-10-04.md。
