# Layerive 宣传片｜少写提示词，让改图更简单

138 秒（2 分 18 秒），1920 × 1080，30 fps，中文大字幕，原创合成电子配乐，无配音。基于原 60 秒工程延展，复用真实演示结果。

## 预览

需要 Node.js 22+，在本工程目录运行：

```powershell
npm ci
npm run dev -- --no-open
```

打开终端给出的本地地址并选择 `LayerivePromo`。主合成为 4140 帧；`Scenes` 文件夹中有 11 个独立可编辑章节，双击主时间线章节也可进入。中文字体使用 Windows Microsoft YaHei；其他系统需配置可用中文字体并重新检查换行。

## 内容

- 0–18 秒：详细提示词、保留要求与反复修改的痛点。
- 18–28 秒：Layerive 用操作表达意图。
- 28–40 秒：删除海报中的船只。
- 40–52 秒：删除人物帽子，最后 4 秒同尺度头部对比。
- 52–66 秒：直接修改识别文字，展示真实表单。
- 66–78 秒：从海报提取公交车素材。
- 78–92 秒：圈选区域并用参考图替换头像。
- 92–110 秒：参考图融合与人物换装。
- 110–118 秒：变量模板批量生成城市海报。
- 118–130 秒：开源、本地部署、模型自主接入。
- 130–138 秒：品牌口号与 GitHub 地址。

## 修改与验证

- `src/LayerivePromo.tsx`：总时间线与配乐，12 帧淡化转场计入总时长。
- `src/Root.tsx`：主合成与独立章节注册。
- `src/scenes/`：每个章节的文案、动画与操作时点。
- `src/Scene.tsx`、`src/visuals.tsx`：背景、品牌与复用视觉元素。
- `public/art/`、`public/shots/`：真实截图裁切与页面素材。
- `public/asset-manifest.json`：原始截图和裁切区域记录。
- `creative-brief.md`：完整创意与分镜。

```powershell
npm run lint
npm run build
```

## 导出与打包

需要 MP4 时运行，或使用 Studio 右下角 Render：

```powershell
npx remotion render LayerivePromo output/Layerive-少写提示词-138s.mp4 --codec=h264 --crf=18
```

源码打包：

```powershell
python scripts/package-source.py
```

输出到工程同级的 `Layerive-Remotion工程-138s.zip`，包含源码、素材、配乐与锁定依赖清单，不包含 node_modules、构建缓存、QA 帧和视频输出。

## 素材与配乐

`scripts/prepare-hat-assets.py` 使用 Python + Pillow，从工程同级 `layerive页面截图/` 裁切帽子素材；成品素材已随工程包含，正常预览无需此目录。截图原对比左侧为修改后、右侧为修改前，视频已统一为左前右后。

配乐由 `scripts/make-soundtrack.py` 通过 Python + NumPy 合成，无第三方录音采样，138 秒、48 kHz 立体声。需要重新制作母带时：

```powershell
python scripts/make-soundtrack.py
python scripts/master-soundtrack.py
```

作品仅做裁切、布局与放大，没有重新生成或润色模型结果；鼠标、选区与对话为操作示意，生成等待经过剪辑。本地部署指工作台和项目数据位于本机，模型请求仍发往用户配置的服务。模型自主接入受协议兼容与模型能力约束。

项目地址：https://github.com/newljs/Layerive。Layerive 主项目许可为 LGPL-3.0-or-later。本工程独立运行，不读取应用数据和模型配置，不调用真实模型。
