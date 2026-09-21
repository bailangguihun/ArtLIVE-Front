# 图文智绘（ArtLIVE-Front）

> **English summary:** This repository contains the React/Vite user interface and Cloudflare Pages API-proxy Function for **图文智绘**, an AI-assisted advertising-design workflow. Source publication does not mean that an application service is deployed, and the repository contains no provider credentials.

图文智绘面向广告设计中的信息整理、营销建议、文案、海报和详情页编辑流程。本仓库仅包含前端及其 Pages 边缘代理；需要生成或切图等后端能力时，它会通过同源 `/api/v1/*` 请求与独立的后端仓库 [ArtLIVE-Back](https://github.com/bailangguihun/ArtLIVE-Back) 配合。

> 这是公开的源代码仓库，而不是已部署的应用服务。后端源代码位于公开仓库 [ArtLIVE-Back](https://github.com/bailangguihun/ArtLIVE-Back)；两个仓库均不包含真实提供商凭据或模型权重。

## 已实现的界面与边界

| 范围 | 当前代码所做的事 | 需要什么条件 |
| --- | --- | --- |
| 本地界面 | 基本信息、营销建议、工作区、文案、海报、详情页、结果与本地历史路由 | 浏览器与前端依赖 |
| 本地历史 | 使用浏览器 IndexedDB 保存可恢复的工作流历史 | 浏览器本地存储；不是云端同步 |
| API 调用 | 以同源 `/api/v1/*` 调用后端 | 可运行的后端与适当的边缘配置 |
| Pages Function | 校验后端目标、注入边缘令牌并过滤危险请求/响应头 | Cloudflare Pages 环境中的服务器端机密 |
| 文案、图像、切图 | 界面和错误/重试状态已实现 | 独立后端、相关模型或外部提供商配置；本仓库不承诺这些服务已部署或已验证 |

当前前端路由包括：`/`、`/history`、`/basic`、`/advice`、`/workspace`、`/copy`、`/poster`、`/detail` 与 `/results`。深链可由 SPA 路由恢复；API 路径由 Pages Function 单独处理。

## 界面预览

![桌面首页](docs/screenshots/readme/home-desktop.png)

![工作流界面](docs/screenshots/readme/workflow-desktop.png)

![移动端首页](docs/screenshots/readme/home-mobile.png)

以上图片是项目现有展示素材，展示前端界面而非已上线服务或真实提供商调用结果。

## 目录与依赖关系

```text
.
├─ README.md
├─ docs/screenshots/readme/             # README 使用的已有展示图
└─ my_agent/
   ├─ assets/
   │  ├─ detail_backgrounds/            # 详情页默认背景资源
   │  └─ poster_style_templates/        # 海报样式 SVG 资源
   └─ frontend-react/                   # Pages 的保留构建根目录
      ├─ src/                           # React + TypeScript 源码与 Vitest 测试
      ├─ functions/api/[[path]].js      # Cloudflare Pages API 代理
      ├─ public/_routes.json            # Pages 路由边界
      └─ package.json / package-lock.json
```

前端保留在 `my_agent/frontend-react`，因为样式模板和详情背景通过相对 `new URL(..., import.meta.url)` 导入 `my_agent/assets`。不要将其单独移动到仓库根目录后再删除这些资源路径。`functions/api/[[path]].js` 是可信边界：浏览器代码不会也不应包含 `BACKEND_PROXY_TOKEN` 或任何提供商密钥。

技术栈为 React 19、TypeScript、Vite、Vitest、ESLint 与 Cloudflare Pages Functions。`fake-indexeddb` 只用于测试环境。

## 本地安装、开发与验证

以下命令从仓库根目录执行。Round 4B 的独立验证使用锁定依赖执行 `npm ci`；使用的 Node 版本及实际结果记录在该轮外部验证证据中。项目未声明 `engines`，请使用能满足锁文件中 Vite 8/TypeScript 6 依赖的受支持 Node 版本。

```powershell
Set-Location my_agent/frontend-react
npm ci
npm run dev
```

开发服务器默认将 `/api` 代理到 `http://127.0.0.1:8000`，仅用于本地开发。启动后访问 Vite 显示的本地地址；没有可用后端时，依赖 API 的界面会显示其已有的加载或错误状态。

```powershell
Set-Location my_agent/frontend-react
npm test -- --run
npx tsc -b --pretty false
npm run lint
npm run build
```

Pages 代理合同可在不访问真实后端的情况下复跑：

```powershell
Set-Location my_agent/frontend-react
node scripts/verify-pages-proxy.mjs `
  functions/api/[[path]].js `
  public/_routes.json `
  proxy-contract-result.json
```

该脚本以合成 `fetch` 响应检查 26 项代理行为。输出 JSON 是本地验证产物，不应提交。

## 同源 API 与 Pages 配置

生产 Pages 构建根目录应保持为 **`my_agent/frontend-react`**，构建命令为 `npm run build`，输出目录为 **`dist`**。`public/_routes.json` 将 Function 范围限定为 `/api/*`；它不是 SPA 静态资产的兜底路由。

Pages Function 仅接受受限的 HTTPS `BACKEND_ORIGIN`，并要求非空的服务器端 `BACKEND_PROXY_TOKEN`。它向可信后端添加内部 `X-AD-Edge-Proxy-Token`，同时删除客户端伪造令牌、跳跃头和不安全响应头。请只在 Pages 的机密环境变量中配置这些值，绝不要以 `VITE_*` 变量、前端配置或提交文件的形式提供它们。

后端合同、健康检查和本地启动说明见独立的 [ArtLIVE-Back README](https://github.com/bailangguihun/ArtLIVE-Back#readme)。尚未确认任何 Pages URL 或公共 FastAPI URL；本仓库的构建通过不等于服务已发布。

## 已验证事项与限制

本仓库对应的发布输入在 Round 4B 中已独立执行完整单元测试、类型检查、ESLint、生产构建、主题合同与 Pages 代理合同；实际命令和结果应以该轮外部验证证据为准。测试使用合成 API/提供商替身，不调用付费 AI 提供商。

仍需在未来公开运行前处理的事项包括：后端可用性与持久化工件存储、提供商配额和预算控制、公开接口速率限制、模型供应与许可确认、真实提供商端到端验证，以及 Pages 机密的实际配置。它们并未因本地构建或测试通过而解决。

## 与后端仓库的关系

[ArtLIVE-Front](https://github.com/bailangguihun/ArtLIVE-Front) 负责体验、浏览器本地状态和 Pages 信任边界；[ArtLIVE-Back](https://github.com/bailangguihun/ArtLIVE-Back) 负责 FastAPI API、工件清单与提供商适配。两个源代码仓库可独立安装和测试；它们的公开源代码状态不表示已经部署 Pages 或 FastAPI 服务。

## 发布前注意事项

请排除 `node_modules`、`dist`、浏览器配置文件、日志、测试证据、真实 `.env`、用户数据和生成工件。保留的图片、SVG、字体及测试素材仅按项目此前明确的发布授权范围处理；本 README 不构成新的资源许可或开源许可。项目尚未选择开源许可证，因此本仓库不附带 `LICENSE` 文件。
