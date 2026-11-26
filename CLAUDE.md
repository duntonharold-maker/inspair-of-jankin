@AGENTS.md

# inspair 项目说明

Jankin 的灵感集合网站：收藏图片、带动效的 UI，以及生成它们的提示词。视觉和交互参照 premotio.com。智能体通过 MCP 增删改内容，每次改动都会提交到这个仓库，然后 Vercel 重新部署。

## 常用命令

```bash
npm run dev        # 本地开发，http://localhost:3000；MCP 接口在 /api/mcp（本地不需要密钥）
npm run build      # 生产构建，提交前必须通过
npm run typecheck  # 类型检查
npm run check:scene  # 检查首页卡片场景：任何屏幕比例下卡片都不会互相穿插
```

## 目录

- `content/site.json`、`content/items.json`：站点配置和所有条目。内容改动走 MCP 或直接改这两个文件，不要在组件里写死内容。
- `public/media/`：媒体文件，文件名由 MCP 生成，不要手动改名。宽于 800 px 的静态图片收录时会另存一张 `<文件名>.thumb.webp`（`media.thumb`），卡片、分类缩略图和场景贴图用它，详情里看原图。
- 一组图（`Item.gallery`）：一个设计有好几张图（预览图加细节图）时是一个条目，`media` 是封面，`gallery` 按顺序放其余的（`picturesOf(item)` 取全部）。卡片、分类、场景只用封面，卡片角上显示张数；详情（`ItemDetail.tsx`）在图上左右切换：两侧箭头、下方缩略图条、「n / N」、触屏左右滑；键盘 ← → 先在组内翻，到头才交给弹窗切换作品（window 上的捕获监听先于弹窗）。右栏的格式、尺寸、原文件跟着当前这张。MCP：`add_item` 的 `more_media_urls`、`group_items`（合并，第一个作封面）、`arrange_group`（排序、换封面、拆出、删图）。
- `components/story/`：首页的滚动故事。`timeline.ts` 定义每一幕占多少屏和卡片场景各阶段的起止，`choreo.ts` 算出每张卡片在任一滚动位置的位置，`scene.ts` 用 three.js 把它们画出来（悬停、指针扰动、拖尾），`rays.ts` 把画好的场景沿放射方向拉出分光的拖影（屏幕边缘、圆环周围、鼠标划过的地方），`screens/` 里是每一幕的 DOM。
- `lib/`：存储（GitHub / 本地）、媒体处理、MCP 工具、鉴权。
- `extension/`：浏览器插件（Chrome MV3），右键图片「收藏到 inspair」，发到 `/api/collect`。菜单在页面任何位置都出现；不是直接右键在 `<img>` 上时（透明遮罩、背景图），`picker.js` 记下的右键位置交给 `background.js` 的 `findPicture` 找出下面的图。采集的条目带 `inbox: true`，进收件箱：已提交但不上网站（`lib/content.ts` 过滤掉），分类可以为空；智能体用 `organize_items` 给它分类即归档上线。采集提交的信息以 `inspair: collect` 开头，`scripts/vercel-ignore.sh` 让 Vercel 跳过这些构建。点菜单后页面里弹出小框（`background.js` 的 `showToast` 的 ask 状态），可选一个大概的分类、写一句话，随图片发出：分类存进 `category`（条目仍在收件箱），那句话存成笔记里以「我的想法：」开头的一行，MCP 说明要求整理时据此写笔记。小框里还有「接上一张」（15 分钟内采过图时出现）：打开后这张作为上一张所在组的下一张（`group_with`）。插件的设置页（`options.html`，点工具栏图标打开）是收件箱：灰底上的浅色窗口，顶部是筛选（全部 / 有想法 / 成组 / 没分类）和刷新、设置（齿轮弹出连接设置），下面是白卡片垫底的瀑布流；成组的图显示成带页签的文件夹卡片（造型参照 Rewamp UI 的 folder-tab-card，自己实现），点开是这一组的页面（设为封面、移出这一组、拆开、删除，`POST /api/collect/arrange`）。多选后「合成一组」（`POST /api/collect/group`，先选的作封面）。插件页用网站的配色变量和 Aventina（`extension/fonts/`），图标是复制进来的 Lucide SVG；这一页的选中态（筛选、选中序号、主按钮）用午夜冷黑，电光蓝只用于悬停和焦点。`GET /api/collect` 列出收件箱（含每张图的尺寸和「我的想法」），`/api/collect/[id]` 取图片（收件箱的图片没部署到网站上，从存储里读）和删除（只能删收件箱里的，提交信息同样以 `inspair: collect` 开头）。插件用 `COLLECT_SECRET`（只能采集、看和删收件箱），也接受 `MCP_SECRET`。
- `app/globals.css`：顶部是颜色、字体、间距、缓动等设计变量，新样式一律使用这些变量。

## 要求

### 要求 1：可点击的元素必须有悬停和点击动效

凡是能点击的东西，包括链接、按钮、卡片、筛选标签、开关、分段选择器，以及 WebGL 场景里能点开的卡片，都必须同时具备下面三种状态，不能只换鼠标指针：

1. **悬停**：鼠标移上去要有看得见的变化，比如背景或描边颜色变化、轻微上浮、图片放大、箭头右移、下划线展开。时长 150–300ms，缓动用 `var(--ease)`。悬停样式写在 `@media (hover: hover)` 里，避免触屏上一直停在悬停状态。
2. **按下**：`:active` 时要有反馈，通常是缩小到 0.96–0.98 或略微变暗，时长约 100ms，松开后回弹。触屏上也要生效。
3. **键盘焦点**：`:focus-visible` 要有清晰的轮廓，不能去掉。

具体做法：

- 只给 `transform`、`opacity`、`color`、`background-color`、`border-color`、`box-shadow`、`filter` 加过渡，不要给会触发重新布局的属性（宽高、边距、`top`/`left`）加过渡。
- 新增可点击元素时优先复用现有的类：`.btn`、`.icon-btn`、`.chip-btn`、`.toggle`、`.seg`、`.link`、`.copy-btn`。这些类已经带好了三种状态。
- 复制按钮用 `components/CopyButton.tsx`（图标换成对勾、文字滚成「已复制」、宽度弹性变化）；一排选项里的选中态用 `components/TabPill.tsx`（滑动的胶囊）。两者的弹簧参数在 `app/globals.css` 顶部（`--spring-*`），由 `lib/spring.ts` 驱动。
- 打开图片或卡片的元素用 `cursor: zoom-in`，其余用 `cursor: pointer`；禁用状态取消悬停和按下效果，并用 `cursor: default`。
- WebGL 场景里能点击的卡片，悬停时卡片要浮起放大，并显示指针（见 `scene.ts` 里的 `setHover`）。点击后由打开详情的动画作为反馈。
- `prefers-reduced-motion` 打开时，全局规则会把动画时长压到接近 0，不需要单独处理，但状态变化（颜色等）要保留。
- 提交前用鼠标和键盘各过一遍新加的可点击元素，确认三种状态都在。

## 其他约定

- 配色只用三种主色，颜色都定义在 `app/globals.css` 顶部的变量里，不要在组件里写死色值：
  - `--ink` #02070A 午夜冷黑：文字、主按钮、深色段落的底色（`.band-dark`）。
  - `--blue` #0297DE 电光蓝：一切交互状态，包括悬停、选中、开关、焦点框、链接下划线、滚动刻度。
  - `--coral` #FC734D 珊瑚橘：点缀标记，包括 Logo、标题里的箭头、提示词标记、步骤编号。
  - 蓝色和橘色在浅色底上只做色块和图形，不做文字；色块上的文字一律用午夜冷黑（白字对比度不够）。在午夜冷黑的底上，它们可以直接做文字。
  - 灰色用变量里带冷色调的灰（`--muted`、`--border` 等），不要用纯中性灰。
- 界面文字用中文，大标题用英文，与现有风格保持一致。英文字体是 Aventina（`app/fonts.ts` 用 `next/font/local` 加载 `app/fonts/` 里的 400/500/600/700 四个字重，中文回落到系统字体），通过 `--font` 用在全站；代码用 `--mono`。要用别的字重，先把对应的 woff2 加进 `app/fonts/` 和 `app/fonts.ts`。
- 图标一律用 Lucide（https://lucide.dev/icons/ ，`lucide-react`），按名字导入，如 `import { ArrowRight } from "lucide-react"`。不要手写 SVG，也不要用 →、↗、× 这类字符充当图标。Logo（`components/Mark.tsx`）和正文里表示菜单路径的「设置 → 连接器」除外。图标跟随文字的颜色和大小（`.lucide` 默认 1em），要别的尺寸就在 CSS 里设宽高，不用 `size` 属性。链接和按钮里的箭头加 `ic-go`、`ic-back` 或 `ic-out`，悬停时会朝箭头方向轻推；标题里的珊瑚色箭头用 `arrow`。
- 作品怎么摆：铺满自己画面的作品（照片、海报、满版插画）铺满卡片；有自己轮廓的作品（`media.cutout`，收录时由 `lib/media.ts` 判断：边缘有透明，或四角透明的部分比卡片圆角能裁掉的还深，比如圆角图标、贴纸、没有底色的动画）完整放在 `--stage` 展示底上，四周留白，不裁切、不改色。任何展示作品的地方（卡片、分类、场景贴图、详情）都按这条处理。
- 毛玻璃只写标准的 `backdrop-filter`，不要再手写 `-webkit-backdrop-filter`：构建时两条会被合并成只剩带前缀的那条，Chrome 和 Edge 认不出，模糊就会失效。Safari 需要的前缀构建工具会自动补上。
- 不要把 `MCP_SECRET`、`COLLECT_SECRET`、`GITHUB_TOKEN` 等密钥写进仓库，这个仓库是公开的。
- 卡片场景只跟着滚动走：只有第一屏的空中卡片按时间漂浮（和 premotio 一样），往下滚到圆环之前漂浮会平滑停下；从那以后卡片的位置、角度只能由滚动进度算出来，不要用时间驱动漂浮、旋转或波动，页面停下时卡片必须静止。指针扰动和悬停是例外，圆环和墙上的卡片只能沿不会碰到邻居的方向移动（圆环上的卡片沿圆环的轴上下，墙上的卡片沿墙面法线）。
- 每张卡片有自己的镜头和绘制深度（`choreo.ts` 的 `lens`、`depth`），在 `scene.ts` 的顶点着色器里换算到同一台长焦相机（与 `toShared` 是同一个公式）：圆环和铺墙时用广角，墙铺满后收窄成长焦；墙始终画在圆环后面，所以两者在空间里重叠也不会互相切到。three.js 的射线拾取看不到这一步，`pick` 是按每张卡片的镜头手算的；新增绘制或拾取相关的代码时要用同样的换算。
- 静止的卡片（圆环上、墙上）共用深度缓冲，运动中的卡片（空中漂浮、落入或离开圆环、飞向墙面）在它们之后由远及近叠画，所以运动中的卡片之间可以交错，但不能穿过静止的卡片。纸张的弯曲、翻动和飞行中的摇晃也在 `choreo.ts` 里算（`paper`），同样只由滚动进度决定（第一屏按时间），在卡片和静止的卡片齐平的地方（落入、升出圆环，快落到墙上时）会减到完全平整；`npm run check:scene` 按弯曲后的形状检查。改动 `choreo.ts` 或 `timeline.ts` 里场景的阶段后，运行 `npm run check:scene` 确认这一点，并截图确认圆环在屏幕中间、完整可见，卡片墙在 4:3 到 2:1 的屏幕上都能铺满左半屏。
