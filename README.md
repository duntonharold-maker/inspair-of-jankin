# inspair

Jankin 的灵感集合：收藏图片、带动效的 UI（图标、加载动画、微交互），并记录生成它们的提示词。
视觉风格参考了 premotio.com 的版式（超大字标题、倾斜卡片墙、分类大字列表），内容和代码都是自己的。

智能体通过 **MCP** 直接增删改条目、上传文件，每次改动都会自动提交到这个 GitHub 仓库，Vercel 随后重新部署。

```
你 ──对话──▶ 智能体 (Claude / ChatGPT / Cursor …)
                │  MCP
                ▼
      https://你的域名/api/mcp/<密钥>
                │  GitHub API：一次改动 = 一个 commit
                ▼
      这个仓库 (content/items.json + public/media/)
                │  push 触发
                ▼
           Vercel 重新部署 → 网站更新（约 1–2 分钟）
```

## 支持的内容

| 类型 | 格式 | 说明 |
|---|---|---|
| 图片 | PNG、JPEG、WebP、AVIF、GIF | 超过 600 KB 的 PNG/JPEG 会自动转成 WebP，最长边限制为 2560px |
| 视频 | MP4、WebM、MOV | 在卡片里静音循环播放，适合录屏的 UI 动效 |
| SVG | 带 CSS / SMIL 动画的 SVG | 会自动去掉脚本，适合动效图标 |
| Lottie | Lottie JSON | `.lottie` 压缩包暂不支持，请导出 JSON |

每一条可以记录：标题、分类、标签、**提示词**、反向提示词、模型/工具、参数、出处、笔记、主色、是否精选。

## 部署（一次性）

### 1. 在 Vercel 导入仓库

打开 [vercel.com/new](https://vercel.com/new)，选择这个仓库，框架会自动识别为 Next.js，直接部署。

### 2. 创建 GitHub Token

GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate new token：

- Repository access：**Only select repositories** → 只选 `inspair-of-jankin`
- Permissions → Repository permissions → **Contents: Read and write**

### 3. 在 Vercel 设置环境变量

Vercel 项目 → Settings → Environment Variables：

| 变量 | 值 |
|---|---|
| `GITHUB_TOKEN` | 上一步的 token |
| `GITHUB_REPO` | `duntonharold-maker/inspair-of-jankin` |
| `GITHUB_BRANCH` | `main`（可省略） |
| `MCP_SECRET` | 一串随机字符，用来保护 MCP 接口，例如运行 `openssl rand -hex 24` 生成 |
| `SITE_URL` | 可选：绑定了自定义域名时填，例如 `https://inspair.example.com` |

保存后在 Deployments 里点 **Redeploy**，让变量生效。

> `MCP_SECRET` 相当于密码：知道它的人就能改你的网站。不要提交到仓库（这个仓库是公开的）。如果泄露了，在 Vercel 里换一个新值再重新部署即可。

## 连接智能体

接口地址有两种写法，任选其一：

- **只能填 URL 的客户端**（claude.ai、ChatGPT）：`https://你的域名/api/mcp/<MCP_SECRET>`
- **可以加请求头的客户端**（Claude Code、Cursor 等）：`https://你的域名/api/mcp`，请求头 `Authorization: Bearer <MCP_SECRET>`

**claude.ai / Claude 桌面版**：设置 → Connectors（连接器）→ 添加自定义连接器 → 填入带密钥的 URL。

**Claude Code**

```bash
claude mcp add --transport http inspair https://你的域名/api/mcp --header "Authorization: Bearer <MCP_SECRET>"
```

**Cursor**（`~/.cursor/mcp.json`）

```json
{
  "mcpServers": {
    "inspair": {
      "url": "https://你的域名/api/mcp",
      "headers": { "Authorization": "Bearer <MCP_SECRET>" }
    }
  }
}
```

**ChatGPT**：开启开发者模式后添加连接器，URL 填带密钥的地址，认证选「无」。

## 怎么跟智能体说

- 「收藏这张图 https://…/a.png，归到海报，提示词是 …，模型 Midjourney v7」
- 「把这段 SVG 存成一个动效图标：<svg …>」
- 「把我桌面上的 loader.mp4 传上去，归到动效」（需要智能体能运行命令，如 Claude Code）
- 「找出所有带提示词的海报」「把『玻璃拟态天气卡片』设为精选」
- 「新建一个分类：加载动画，英文名 Loaders」
- 「删除所有带『示例』标签的条目」（仓库里自带的 17 条是演示数据）
- 「看一遍所有图标和动效，按画面重新分类，把意思重复的标签合并，先给我看方案」

### 智能整理

智能体整理素材时会按这个流程来（服务端已在说明里告诉它）：

1. 用 `list_categories`、`search_items` 了解现有分类和条目；
2. 用 `view_items` 直接看图（每次最多 10 张），按画面内容判断，而不只看标题；
3. 用 `organize_items` 生成整理方案（默认只预览，不改任何东西），列出每一条改前改后，交给你确认；
4. 你同意后，它再用同样的内容加 `dry_run: false` 执行。所有改动合成**一次提交**，只触发一次部署。

方案里有任何错误（比如分类不存在、条目找不到），执行时会整批拒绝，不会只改一半。

## MCP 工具

| 工具 | 作用 |
|---|---|
| `list_categories` | 列出分类（含数量）和常用标签 |
| `search_items` | 按关键词、分类、标签、是否有提示词搜索 |
| `get_item` | 读取一条的全部字段 |
| `add_item` | 新增一条，媒体来源三选一：`media_url`、`media_text`（SVG/Lottie 文本）、`media_base64`（小文件） |
| `update_item` | 修改字段，或替换媒体文件 |
| `delete_items` | 删除条目及其媒体文件 |
| `prepare_upload` | 为本地文件生成一条 30 分钟内有效的 `curl` 上传命令 |
| `view_items` | 返回条目的缩略图给智能体看（视频和 Lottie 返回文字描述） |
| `organize_items` | 批量整理：改分类、标题、标签，全站重命名或合并标签，新建分类；默认只预览，执行时一次提交 |
| `upsert_category` | 新增或重命名分类 |

上传限制：通过 `curl` 上传单个文件最大约 4 MB（Vercel 的请求体限制）；通过 `media_url` 下载最大 20 MB。

也可以不经过智能体，直接用脚本或 iOS 快捷指令上传：

```bash
curl -H "Authorization: Bearer $MCP_SECRET" -F 'meta={"title":"标题","category":"icon","prompt":"…"}' -F file=@icon.svg https://你的域名/api/upload
```

## 本地开发

```bash
npm install
```

```bash
npm run dev
```

打开 http://localhost:3000。本地没有配置 `GITHUB_TOKEN` 时，MCP 接口 `http://localhost:3000/api/mcp` 不需要密钥，改动会直接写进本地的 `content/` 和 `public/media/`，自己 commit 即可。

## 目录

```
content/site.json      站点名称、简介、分类（id / 英文名 / 中文名）
content/items.json     所有条目
public/media/          媒体文件
app/                   页面与接口（/api/mcp、/api/upload、/i/[id] 详情页）
components/            首页各区块：Hero、Wall、Categories、Gallery、Modal…
lib/                   数据存储（GitHub / 本地）、媒体处理、MCP 工具、鉴权
app/globals.css        颜色、字体、间距等样式变量都在最上面
```

想改站名、简介或分类，直接改 `content/site.json`（或让智能体用 `upsert_category`）。
