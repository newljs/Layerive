> 🇨🇳 中文版：[README_ZH.md](README_ZH.md)

<div align="center">

<img src="public/favicon.svg" width="96" height="96" alt="Layerive Logo" />

# Layerive

**A local workspace that keeps images, conversations, and edit history together by project.**

Layerive is built for image work that takes more than one prompt. Start from text or an existing image, then edit, replace a region, change text, outpaint, or extract an asset. Each result becomes a version in the project, while images, conversations, and model settings remain on your machine.

[![Runs locally](https://img.shields.io/badge/Runs%20locally-No%20sign--in-6d55f7)](#local-data-and-privacy)
[![Storage](https://img.shields.io/badge/Storage-SQLite%20%2B%20local%20files-2e8c78)](#local-data-and-privacy)
[![Tech](https://img.shields.io/badge/React%2019%20%C2%B7%20Vite%20%C2%B7%20SQLite-TypeScript-3178c6)](#tech-stack)

[Get started](#getting-started) · [Features](#features) · [Configure models](#configure-real-models) · [Workflow](#workflow) · [Privacy](#local-data-and-privacy) · [FAQ](#faq)

</div>

---

## What it is for

Prompt-to-image pages are good at generating a new image. They are less convenient when the job is to change one line of text, replace a subject, edit a selected region, or extend the canvas. Those changes often require repeated prompt revisions, and the model may still alter parts of the image that were meant to stay unchanged.

Layerive exposes these tasks as tools in the workspace: recognize and edit text, select a region and describe a change or provide a reference image, choose a target ratio for outpainting, extract an asset, enhance an image, or remove a watermark. Enhancement and watermark removal can be started from their dedicated actions; text and regional edits work from recognized content or a selection. A vision model interprets the image and selection, while the image model performs the edit. You do not have to work out a long editing prompt or repeatedly regenerate the whole image for a local change.

The work stays in one project. Each generation or edit creates a version that can be revisited, compared, or used as the start of a new branch. Layerive does not require a hosted project or a fixed model provider. Apart from requests sent to services you configure, images, conversations, and version data stay local.

## Features

### Project and asset management

- The project library provides card and list views, search, favorites, duplication, renaming, and soft deletion.
- Each project stores its description, cover, current image, default model, and unfinished workspace state.
- Projects can be imported or exported individually as ZIP files. Full local backup and restore are also available.

### Image creation and editing

- **Text to image** — generate 1–4 images from one prompt. Multiple results belong to the same version, and any candidate can be selected for further editing. Providers that return one image per call are split into multiple requests and may bill each request separately.
- **Image to image and prompt-based editing** — start from an uploaded, pasted, or historical image and describe the next change. The app chooses the supported output size closest to the source aspect ratio.
- **Image enhancement** — ask the image model to improve clarity and detail while keeping the subject, text, composition, and style as stable as possible.
- **Regional editing** — drag a selection from inside or outside the image, even beyond the workspace edge. Describe a change, or upload/paste a reference image in the selection panel (PNG/JPEG/WebP, up to 10MB). For example, select a person's head and upload a dog photo: the vision model infers the replacement intent and locates both subjects, the backend crops and places the reference subject, and the image model blends it naturally. Instructions are optional with a reference. Reference edits restore original pixels outside the selection and save a PNG at the source dimensions. Leave room inside the selection for connecting edges; blend quality depends on the model. Progress and cancellation cover planning, compositing, generation and saving. Text-only regional editing remains available.
- **Asset extraction** — start inside or outside the image and drag beyond its edge to select content (e.g. a cinema screen). The app screenshots the selection's valid intersection with the source image, a vision model focuses on the intended subject and ignores accidentally included edges (like nearby seats), then the image editor produces a faithful standalone asset. An optional hint can clarify your intent.
- **Outpainting** — choose a size or ratio supported by the current model, preview the expanded canvas, then submit an image-edit request.
- **Watermark removal** — a vision model checks for and locates a watermark before the image model repairs the affected region.
- **Edit in-image text** — a vision model splits visible text into editable regions. Replace text, clear it to remove it, or manually select a region to add content; output uses the closest supported size matching the source image's aspect ratio. Clicking submit closes the editor immediately and returns to the project conversation while vision planning and generation continue. If submission fails, the editor reopens with the original edits intact.
- **Reuse recognition results** — successful text recognition is stored locally per image and vision-model configuration. Reopening text editing reuses it; switching or changing the vision model triggers a fresh recognition.
- **Project style prompts** — define a shared style for text-to-image generations while keeping the source-image context for edits.
- **Prompt gallery** — browse built-in templates or maintain a personal library of prompts and reference images. A vision model can derive prompts from an uploaded image, and workspace images can be added from their context menu.
- **Dark mode** — available from the home, workspace, and model-configuration headers, with the preference stored locally.

### Versions, conversation, and comparison

- Every generation, edit, image-enhancement, regional-edit, and outpaint operation creates a new version. You can upload additional images even after a project already has images, then use each new upload as the input for later edits.
- Open the complete version tree, zoom and pan it, select a node to jump to it on the canvas, and branch from any version.
- The workspace keeps the prompt, selected model, version number, and output images for every turn. Prompts can be reused, and any result can become the next input.
- Compare images side by side or with a before/after slider, including against a selected historical image.

### Model integrations

Image models can be added, edited, tested, deleted, and set as defaults independently. Each project also remembers the default image model selected at creation time.

The workspace header lets you choose image-generation and vision-recognition models independently. The vision choice is saved per project and is used for text recognition/editing, regional-edit planning, watermark removal, asset extraction, and prompt distillation. Recognition caches remain isolated by the selected vision model.

| Provider | Integration | Typical use |
| --- | --- | --- |
| SenseNova | Dedicated request adapter | Text-to-image, image-to-image, prompt editing; official watermark output is disabled by default |
| OpenAI-compatible | Images API or compatible gateway | Text-to-image, image-to-image, and prompt editing; exact support depends on the upstream model |
| Gemini | Native Gemini image API | Gemini Nano Banana and other supported image models |
| Grok | Native xAI image API | Grok Imagine image models |

- Configure a separate **vision model** for image text editing and regional-edit planning.
- Vision models support Anthropic Messages, Chat Completions, and Responses API formats while retaining compatibility with existing SenseNova and `dots3-note` configurations.
- Each model declares its own capabilities: text-to-image, image-to-image, prompt editing, or image understanding. The workspace only presents operations and sizes supported by the selected model.
- A built-in demo model lets you try projects, conversations, and versioning without an API key.

## Getting started

### Requirements

- Node.js **22.13+**
- npm **10+**

### Development

```bash
npm install
npm run dev
```

Development mode starts the frontend and local API service. Open [http://127.0.0.1:5173](http://127.0.0.1:5173); the local API uses port `8788` by default.

### Build and run

```bash
npm run build  # Type-check and build into dist/
npm start      # Serve the frontend and local API
```

> [!TIP]
> For everyday local use, run `npm run build` once and then use `npm start`. Use `npm run dev` while changing code.

### Desktop app

The same source can be packaged as an Electron desktop application:

```bash
npm run desktop:dev   # Build and start Electron
npm run desktop:dist  # Create installer and portable packages
```

The desktop app stores its SQLite database, project images, gallery, and model configuration in the operating system's Layerive user-data directory, which is not replaced during application upgrades. The browser-local and desktop modes share feature code but keep separate local data by default; use full backup and restore to migrate projects.

Prebuilt installers are also published automatically to [GitHub Releases](https://github.com/newljs/Layerive/releases) by GitHub Actions whenever a `v*` tag is pushed — Windows (installer + portable), macOS (x64 + arm64 DMG), and Linux (AppImage + deb).

## Workflow

Screenshots are stored in `doc/界面操作截图/` and listed below in workflow order.

| Step | Screenshot | Description |
| --- | --- | --- |
| 1 | ![1 首页-项目管理](doc/界面操作截图/1首页-项目管理.png) | Project library: import, export, favorite, copy, delete, and create |
| 2 | ![2 创建项目](doc/界面操作截图/2创建项目.png) | Enter a project name and description |
| 3 | ![3 项目初始面板](doc/界面操作截图/3项目初始面板.png) | Workspace with version history, canvas, and project conversation |
| 4 | ![4 提示词画廊](doc/界面操作截图/4提示词画廊.png) | Browse prompt templates by category |
| 5 | ![5 提示词画廊2](doc/界面操作截图/5提示词画廊2.png) | Use a template in the conversation or as the project style |
| 6 | ![6 生图操作](doc/界面操作截图/6生图操作.png) | Store generated results in version and conversation history |
| 7 | ![7 编辑图片文字](doc/界面操作截图/7编辑图片文字.png) | Recognize and edit text in separate regions |
| 8 | ![8 局部修改](doc/界面操作截图/8局部修改.png) | Select a region and describe the required change |
| 9 | ![9 局部修改效果](doc/界面操作截图/9局部修改效果.png) | Save the regional edit as a new version |
| 10 | ![10 版本关系](doc/界面操作截图/10版本关系.png) | View parent, child, and branch relationships |
| 11 | ![11 修改对比](doc/界面操作截图/11修改对比.png) | Compare two images side by side or with a slider |
| 12 | ![12 扩图](doc/界面操作截图/12扩图.png) | Select a target ratio and preview the outpaint area |

## Configure real models

Open **Model configuration** from the home page or workspace:

1. Select **Add image model** or **Add vision model**.
2. Image models support **SenseNova / OpenAI / Gemini / Grok**. Vision models support **Anthropic Messages / Chat Completions / Responses** API formats, with Chat Completions selected by default for new configurations.
3. Enter a display name, Base URL, API key, model name, and capabilities. The button beside the API key toggles visibility and can reveal a previously saved key on demand. Switching an image provider fills in matching endpoint and model examples.
4. Use **Test connection**, save the model, then set an image model as the default or a vision model as the recognition default.

| Model type | Supported providers | Primary use |
| --- | --- | --- |
| Image model | SenseNova, OpenAI-compatible, Gemini, Grok | Text-to-image, image-to-image, edits, outpainting, and more |
| Vision model | Anthropic Messages, Chat Completions, Responses | Analysis and prompt planning for text editing, regional edits, and asset extraction |

### Configuration notes

- Parameter support is determined by the gateway for OpenAI-compatible services. For example, if `quality` accepts only `auto`, `low`, `medium`, or `high`, use one of those values in the model's default parameters.
- Text editing, regional editing, outpainting, enhancement, and asset extraction require an image model with **prompt-editing** capability. The first two recognition-driven operations also require an enabled vision model.
- Available outpainting sizes are constrained by the active image model. Confirm the canvas preview before submitting.
- Output quality, text accuracy, and regional fidelity depend on the underlying model. For complex layouts, recognize text first and use manual selections to edit one region at a time.

## Local data and privacy

- No account or sign-in is required. In browser-local mode, project metadata is stored in `data/app.db`, and project images live in local directories under `data/`. The desktop app stores equivalent data in its operating-system user-data directory.
- In browser-local mode, model configuration is stored in `config/models.json`; the desktop app stores it in its user-data directory. It may include API keys. Do not commit it to a public repository, and handle backups carefully.
- Full backups include project data and configuration. Keep a backup before restoring another one.
- The local API listens only on `127.0.0.1`; it is not directly exposed to your network or the internet.

## FAQ

### The page opens, but image generation fails. What should I do?

The demo model is only for exploring the workflow. In **Model configuration**, add a real image model, enter its API key, test the connection, and set it as the default.

### Why is text editing or regional editing unavailable?

Those operations need both an image model that can edit by prompt and a vision model for image analysis. Configure and enable both, then verify the image model has the **prompt-editing** capability.

### How do I move my data to another computer?

Export a full backup ZIP from the home page. On the new computer, install and start Layerive, then use Restore to import it. Restoration overwrites the current local data, so export a current backup first.

### What if a port is already in use?

Development uses frontend port `5173` and API port `8788` by default. Stop the process using the port; to change the API port, set `PIXELFLOW_API_PORT` before starting and update Vite's API proxy to match.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19 · TypeScript · Vite |
| Backend | Native Node.js HTTP service |
| Database | SQLite (`node:sqlite`) |
| Image storage | Local filesystem, organized by project |
| AI integrations | SenseNova · OpenAI-compatible · Gemini · Grok · vision models |

Project layout:

```text
.
├── src/            # Home page, workspace, model configuration, and UI logic
├── server/         # API, task scheduling, model calls, and data access
├── public/         # Icons, PWA resources, and prompt-gallery assets
├── config/         # Local model configuration (generated at runtime; sensitive)
└── data/           # SQLite database and project images (generated at runtime)
```

## Useful commands

```bash
npm run dev    # Start frontend and API in development mode
npm run lint   # Type-check TypeScript
npm run build  # Type-check and build the frontend
npm run test:local-edit  # Run regional-edit regression tests
npm start      # Start the local production service
```

## Star History

<a href="https://star-history.com/#newljs/Layerive&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=newljs/Layerive&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=newljs/Layerive&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=newljs/Layerive&type=Date" />
 </picture>
</a>

---

## License

This project is licensed under the [GNU Lesser General Public License v3.0](LICENSE) (or later).

Copyright (c) 2026 newljs
