# Atrium 交互简化开发提示词

## 双击导入 / 长按 1 秒打开合集

> **状态：待批准，未开工。** 用户批准前不要修改产品代码、不要开分支、不要提交。
>
> 基线：`main` = `f105f3a`（版本 v0.7.0，`SCHEMA_VERSION = 11`），全量测试基线
> **2029 通过 / 19 跳过（合计 2048，退出码 0）**，两个 tsconfig 干净。
>
> 这份文件是开发合同。先批 §4 的裁定表，再按 §5–§10 实施和验收。
> 文中每一条“现状”都是读源码核对过的；**本轮还没有启动应用做活体**。
> 如果实施时发现代码与本文冲突，以代码为准；但**只要冲突会改变本文定义的用户行为，先停下来报告**，
> 不要自己改设计，也不要用“顺手优化”绕过。

---

## 0. 用户的原话与目标

用户的原话（2026-10-21）：

1. 以后不会再出现“导入 Unity”这个按钮。
2. 双击素材图标就可以直接导入。
3. 原来双击打开一个素材合集的操作，改为**长按 1 秒图标**打开素材的合集。

用户另外要求：**不能造成功能冲突，简化操作，反思合理性。**

本方案要交付的不是“把一颗按钮藏起来”，而是把主任务收敛成两条明确的手势：

- **双击 = 对这张卡执行导入**（写操作，所以所有安全网原样保留）。
- **长按 1 秒 = 打开这张合集卡看里面**（只读操作，不写盘）。

> 术语先钉死：本文的“合集”= 容器卡（`AssetCard.isBundle = true`，侧栏“合集”那一类，
> 卡片上写着“合集 · 含 N 项”或“N 个模型变体”）。
> **不是**侧栏“集合”（用户自建的关键词集合，`nav.collections`）。
> 集合的行为本轮完全不变。如果用户说的“素材集合”其实指后者，请先纠正本文件再开发。

---

## 1. 为什么这样改是合理的（先把取舍说清楚）

### 1.1 收益

- 主任务从“找到素材 → 视线移到右侧 → 找按钮 → 点击”变成“找到素材 → 双击”，
  少一次视线移动和一次定位。高频动作的收益最大。
- 卡片本身已经是最大的点击目标，双击比在 320px 详情面板底部找按钮更符合“直接操作对象”。
- 导入本来就有目标解析、冲突预扫、备份、结果条撤销、批量进度；去掉一颗按钮**不会**去掉这些安全网。
- 合集打开是低频、只读的动作，放在长按上不会干扰主任务；误触的代价只是进到合集内部，
  Esc 就能返回，不写盘、不删文件。

### 1.2 代价与必须补的措施

- **双击是“看不见的写操作”**。老用户可能不知道双击会写工程。补偿：
  - 顶栏继续显示“导入目标：X”，导入前目标不明确时仍然先选工程；
  - `confirmBeforeImport` 默认仍是 true，无冲突也会问一次（本轮不改默认值）；
  - 有冲突必须列路径再确认；结果条仍带“撤回”；
  - 状态栏、详情面板、合集卡提示都要教这两条手势。
- **长按在桌面端不常见**。补偿：长按合集封面时底部有 1 秒进度条；卡片标题/状态栏写明；
  合集卡本来就有文件夹折角和数量徽章，语义上支持“按住打开”。
- **老用户习惯会变**：原来双击合集卡是进入，现在会弹出成员面板；原来双击行为可以设成“预览/打开文件夹”，
  现在固定为导入。这是有意的行为变更，**发布说明必须写明**，不能悄悄改。
- **误触风险**：双击写工程比点按钮更容易误触。补偿是现有的确认、冲突检查、可撤回；
  本轮**不降低**任何一道安全闸，也不把单击改成导入。

### 1.3 不采用的方案（避免越改越复杂）

- 单击导入：误触概率太高，直接否。
- 右键菜单再放一个“导入”：等于保留第二个入口，和“简化”相悖。
- 悬浮按钮 / 长按后才出现的按钮：用户明确说“以后不会再出现导入 Unity 这个按钮”，不做隐藏按钮。
- 拖到 Unity 窗口导入：OS 层拖拽在本仓库仍是未验证区域（见 HANDOVER §12），本轮不碰。
- 给普通卡也加长按动作：会和“双击导入”争夺同一块表面，且普通卡没有“合集”可开，纯属噪音。

---

## 2. 现状（读源码核对，未启动应用）

| 入口 | 现在的行为 | 代码位置 |
|---|---|---|
| 双击普通素材卡 | 先 `openDetail`，再按设置 `doubleClickAction`：`import` → `importAsset`；`preview` → 只开详情；`reveal` → **只弹一句提示，根本没实现** | `src/renderer/components/AssetGrid.tsx:87-111` |
| 双击合集卡 | `setNav('bundle:' + id)` 进入二级列表 | `AssetGrid.tsx:89-92` |
| 详情面板底部 | 一颗主色按钮「导入到 Unity / 导入到 X」 | `src/renderer/components/DetailPanel.tsx:317-325` |
| 容器内部每一行 | 一颗「导入 / 导入到 X」按钮；双击行也导入 | `src/renderer/components/BundleDetail.tsx:391-416` |
| 容器顶部 | 「整包导入 Unity」：开成员面板 + 全部预勾 | `BundleDetail.tsx:299-314` |
| 容器底部 | 「选包导入 Unity」：开成员面板 | `BundleDetail.tsx:482-496` |
| 多选工具栏 | 选 ≥2 张时出现「导入 Unity（N）」/「将 N 项导入到 X」 | `AssetGrid.tsx:315-330` |
| 键盘 Enter | 选 1 张 `importAsset`，选多张 `importSelected` | `src/renderer/App.tsx:112-121` |
| 列表视图 | **只有单击**，没有双击导入，也没有打开合集的入口 | `AssetGrid.tsx:205-251` |
| 设置 → Unity | 「双击素材卡」下拉：导入 / 预览 / 打开所在文件夹 | `src/renderer/pages/Settings.tsx:344-354` |
| 设置默认值 / 类型 | `doubleClickAction: 'import'` | `src/shared/settingsDefaults.ts:49`、`src/shared/types.ts:934` |
| 旧提示 key | `library.dblclickHint` 写着“双击容器卡进入内部；双击普通素材卡导入 Unity”，但**代码里没人用** | `zh-CN.json:151` |

### 2.1 从现状得出的三个结论

1. **“双击导入”不是从零加的功能**，默认设置下已经存在；这次要做的是把它扶正为唯一入口，
   并让所有卡片类型的行为一致。
2. **“双击打开合集”是现阶段唯一真正的双击入口**（普通卡的双击导入被设置项包着）。
   把它挪到长按之后，双击合集卡必须有一个明确的新行为，不能悬空。
3. **按钮不止一颗**。只删详情面板那颗，会留下容器行、容器顶部、容器底部、多选工具栏四颗旁路按钮；
   用户会说“还是能看到导入按钮”。但全删之前必须补上它们各自的功能出口，否则就是删功能。

---

## 3. 目标交互（批准后的最终形态）

### 3.1 网格卡

- **单击**：选中 + 打开右侧详情（现状不变）。
- **双击普通素材卡**：直接走导入链（目标解析 → 找包 → 有冲突先列路径 → 导入 → 结果条可撤回）。
  - 这张卡如果想导入的东西不止一个（多个包、多个成员），**不许静默挑一个**，开成员面板让用户勾。
- **双击合集卡**：打开成员面板，**全部包预勾**（等价于原来的“整包导入”），由用户按“抽取并检查”确认。
  - 这不是“双击直接灌 22 个包”：面板里会列出数量、体积、分批，用户仍有一次明确确认。
  - 如果合集里没有可导入的包，面板会给出空原因；不许假装导入成功。
- **长按合集卡 1 秒**：进入合集内部（`setNav('bundle:' + id)`），和原来的双击进入完全同一个落点。
- **长按普通卡**：没有任何动作；不显示进度条，不弹提示，不打开详情。
- **多选后双击**：
  - 双击的是**普通卡**，且它在当前多选里、选中 ≥2 张 → 批量导入当前选中的全部
    （沿用 `importSelected`：可直导的逐张导，需选成员的跳过并如实报数）。
  - 双击的是**合集卡** → 永远走合集自己的成员面板，不参与批量（避免“合集被跳过”的歧义）。
  - 双击的卡不在当前多选里 → 按单张处理，选区收敛到这张（现状标准行为）。
- **按住时移动超过阈值 / 滚轮 / 离开卡片 / 松手 / 失焦**：取消长按，不进入合集。
- **导入忙碌**：沿用现有“已经有一批在跑了”的提示，不排队第二套。
- **没有导入目标**：沿用现有目标选择面板；一个可用工程时自动选；一个都没有时提示先打开 Unity。
- **没有可导入的包**：提示“这张卡里没有可直接导入的 .unitypackage”，不写任何东西。

### 3.2 列表行（必须有，不能只改网格）

列表视图没有封面图，但按钮删掉之后不能只剩 Enter。列表行与网格卡语义完全一致：

- 单击：选中 + 详情。
- 双击普通行：导入；双击合集行：成员面板全预勾。
- 长按合集行 1 秒：进入合集。
- 长按普通行：无动作。

合集行在列表里至少要有**可见的合集标识**（复用现有徽章/文字，不要新造一套），
否则用户不知道这一行长按有东西可开。

### 3.3 容器内部（`BundleDetail`）

- 双击一行：继续导入这一行（现状保留）。
- 勾选行后按 Enter：继续打开成员面板（现状保留）。
- **移除**每行的导入按钮、顶部的「整包导入 Unity」、底部的「选包导入 Unity」。
- 顶部“整包”的能力由“在网格里双击合集卡”（全预勾）承接；进去之后仍可用 Enter 开面板。
- 行内复选框双击要 `stopPropagation`，避免“想改勾选却触发行双击导入”。

### 3.4 键盘等价

- `Enter`：
  - 选 1 张普通卡 → 导入这张。
  - 选 1 张合集卡 → 与双击合集一致：成员面板 + 全部预勾。
  - 选多张 → 批量导入选中项（现状）。
- `Shift+Enter`：选 1 张合集卡时进入合集内部；选普通卡或无选中时无动作。
- `Esc` / `Ctrl+A` / `Ctrl+Z` / `Delete` / `Ctrl+K`：全部保持现状。
- 容器内 `Enter`：保持“打开成员面板”。

### 3.5 提示与可发现性

- **状态栏**（全局可见，按页面给不同文案）：
  - 素材网格/分类/合集列表：`双击导入 · 长按 1 秒打开合集`
  - 容器内部：`双击一行导入 · Enter 选包 · Esc 返回`
  - 其他页面：维持现有文案，不硬塞手势提示。
  - 拖拽文件进来时：仍然优先显示“松手即自动分类”。
- **详情面板**：原按钮位置换成一行**非按钮**的灰色提示：
  - 有导入目标：`双击卡片导入到 {{name}}`
  - 没有目标：`双击卡片导入（会先请你选择工程）`
  - 如果当前详情是合集：`长按卡片 1 秒打开合集`
- **合集卡**：`title` 提示 `长按 1 秒打开合集；双击导入`。
- **多选 ≥2**：工具栏“已选 N 项”旁边加一句淡色 `双击其中一张一起导入`。
- **长按反馈**：封面底部一条 2px 的主色进度条，1 秒填满；松手/移动取消时立即消失。
  - 尊重 `prefers-reduced-motion`：不播放动画时改为静态描边高亮，不能“只有动画、没有别的反馈”。
- 不新增常驻按钮、悬浮按钮、右键菜单或“更多”菜单。

---

## 4. 裁定表（请先批这一节）

> 每条都给了推荐档。可以回复“Q1–Q10 全按推荐”，也可以逐条改。
> **未批准前不写代码。** 有甲/乙分支的，按推荐档实施。

| # | 问题 | 选项 | 推荐 |
|---|---|---|---|
| **Q1** | “不再出现导入 Unity 按钮”的**移除范围** | 甲 移除所有**常驻**导入按钮：详情面板、容器行、容器顶部整包、容器底部选包、多选工具栏、设置下拉；保留成员面板 / 冲突框 / 结果条里的确认与撤回动作。<br>乙 只删详情面板那一颗，其他保留。<br>丙 全部收进“更多”菜单。 | **甲**。乙会留下四颗旁路按钮，用户仍能看到“导入 Unity”；丙只是把按钮藏起来，违背“以后不会再出现”。弹窗里的确认不是常驻按钮，删了就没人能确认导入。 |
| **Q2** | 双击**合集卡**做什么 | 甲 打开成员面板并**全部预勾**（原“整包导入”），用户确认后才导。<br>乙 什么都不做，只提示“长按打开”。<br>丙 直接导第一个包。 | **甲**。双击 = “导入这张卡”；合集的“这张卡”就是里面的包。面板+全勾保留了原整包能力，也保留了用户取消/改勾的权利。乙会让整包导入彻底失去入口；丙是静默替用户挑，违反仓库既有原则。 |
| **Q3** | 多选时双击怎么算 | 甲 双击已选中的**普通卡** → 批量导入当前选中全部；双击**合集卡** → 合集自己的成员面板；双击未选中的卡 → 单张。<br>乙 永远只导被双击的那张，批量只留 Enter。<br>丙 工具栏保留一颗批量按钮。 | **甲**。按钮删掉后，甲是唯一的鼠标批量入口；乙会让多选失去鼠标路径；丙与 Q1 冲突。合集卡单独处理，避免“批量时合集被跳过”的歧义。 |
| **Q4** | 长按的**对象和表面** | 甲 只对**合集卡**生效；网格长按封面区域（图标），列表长按整行；普通卡无动作、无进度条。<br>乙 任何卡长按都打开它所属的父合集（需要给卡片补 `parentId`）。<br>丙 任何卡长按打开详情。 | **甲**。用户说的是“打开素材的合集”，只有合集卡有合集可开；乙会引入父级跳转和“跳错”的风险，且普通卡当前没有 parentId；丙与双击导入直接冲突。 |
| **Q5** | 列表视图要不要同步 | 甲 同步：列表行双击导入、长按合集行打开；合集行显示可见标识。<br>乙 只改网格，列表只保留 Enter。 | **甲**。按钮删掉后，乙会让列表视图没有任何鼠标导入入口；同一产品两套手势也会增加维护成本。 |
| **Q6** | 设置里的“双击素材卡”怎么办 | 甲 删除设置项与所有读取，行为固定为导入；旧值忽略；**不做数据迁移**（JSON 里留着也不读）。<br>乙 保留下拉但只留“导入”一个选项。<br>丙 保留三档。 | **甲**。保留三档会直接制造死路：用户设成“预览/打开文件夹”后，按钮又没了，就没有任何导入入口；而且 `reveal` 现在只弹一句提示、`preview` 与单击打开详情重复。删掉是修死路，不是顺手砍功能。 |
| **Q7** | 提示与长按反馈 | 甲 状态栏按页面提示 + 详情面板灰字提示 + 合集卡 title + 1 秒进度条 + 多选“一起导入”提示；尊重 reduced-motion。<br>乙 只放状态栏一句。 | **甲**。双击是写操作且没有按钮，发现成本必须由这些低成本提示补回来；进度条是“长按正在生效”的唯一可见证据。 |
| **Q8** | 键盘等价 | 甲 `Enter` 保持导入；选 1 张合集时 `Enter` 也走“成员面板+全预勾”；新增 `Shift+Enter` 打开选中合集。<br>乙 不加 `Shift+Enter`。 | **甲**。长按是鼠标专属，不加键盘路径就等于键盘用户无法打开合集；`Shift+Enter` 与现有 Enter 语义相邻，冲突最小。 |
| **Q9** | **非合集**卡里有多个散装包时怎么办 | 甲 把 `cardImportChoice` 改成“`packages.length > 1` 一律 needs-choice”：单卡双击开成员面板；批量跳过并如实报数；同步改文案。<br>乙 维持“先导第 1 个”，只改提示。 | **甲**。移除按钮后，旧提示“想导别的，进这张卡里面勾”指向一个**不存在的内部视图**；这是死路。多个包就是“有两件事要选”，不该静默挑第一个。批量跳过比偷导第一个安全。 |
| **Q10** | 版本与发布 | 甲 bump **0.8.0**，只在本机构建/覆盖安装，**不发 GitHub Release**；等用户实际用几天再发。<br>乙 bump 0.7.1，只本机装。<br>丙 不 bump，直接重装 0.7.0。 | **甲**。这是用户可见的破坏性交互变更，值得一个 minor；先本机用几天，能避免“发出去才发现不顺手”。丙无法用注册表 `DisplayVersion` 证明本机真的换了包。 |

---

## 5. 实现细则（照这个做，别另起一套）

### 5.1 长按状态机

新增 `src/shared/cardGesture.ts`（纯逻辑，能直接单测）：

```ts
export const LONG_PRESS_MS = 1000
export const LONG_PRESS_MOVE_CANCEL_PX = 8
```

新增 `src/renderer/lib/useLongPress.ts`（或同层 hook），要求：

- 只在 `enabled`（`card.isBundle`）且**主键**按下时启动；
- `ctrl / meta / alt / shift` 任一按下 → 不启动（避免和选择、系统手势抢）；
- 从 `pointerdown` 的坐标算移动距离，**超过 8px 取消**；
- 以下任一情况取消并清定时器：
  - `pointerup` / `pointercancel` / `pointerleave`
  - 容器的滚动（用 capture 监听 `scroll`，否则按住不动只用滚轮时不会取消）
  - `window` 失焦、`Escape`、`contextmenu`、`dragstart`
- 到 1000ms 只触发一次 `onFire`，置 `fired`；
- 组件卸载时清理定时器与监听；
- **不要用 `onClick` 或 `onDoubleClick` 的计时器实现长按**，两套手势必须分开；
- 触发后抑制紧随其后的 click/dblclick（导航通常会卸载卡片，但仍要加保护）；
- 普通卡不挂这个 hook（`enabled=false` 时连进度条都不出现）。

视觉：

- 网格：封面容器底部一条 2px 进度条，1 秒从 0 到 100%；用 CSS animation，不要每帧 setState；
- 列表：行底边同一条进度条；
- `prefers-reduced-motion: reduce`：不播放动画，改为静态主色描边；
- 封面 `<img draggable={false}>`，卡片根 `onDragStart={e => e.preventDefault()}` ——
  否则按住移动会先触发浏览器原生图片拖拽，长按和“移动取消”都会失真。

### 5.2 双击与多选快照

`onClick` 会在双击过程中先触发两次，`toggleSelect` 第二次会把选区清掉/收敛。
因此不能在 `onDoubleClick` 里直接读“当前选区”。

做法：

```tsx
const pressSelection = useRef<string[]>([])

onClick={(e) => {
  // e.detail === 1 才是这一串点击的第一次；第二次不要覆盖快照
  if (e.detail === 1) pressSelection.current = useUi.getState().selection
  toggle(card.id, e.ctrlKey || e.metaKey || e.shiftKey)
  void openDetail(card.id)
}}
```

双击时：

1. 带 `ctrl/meta/alt/shift` 的双击**不导入**，只当选择手势（避免“ctrl 取消选中却导入了”）。
2. `card.isBundle` → `importWhole(card.id)`（见 5.3），不参与批量。
3. 否则取 `pressSelection.current`：
   - 长度 >1 且包含 `card.id` → 先把选区恢复成快照（`useUi.setState({ selection: snap })`），
     再 `importSelected(snap)`；
   - 否则 → `openDetail(card.id)` + `importAsset(card.id)`（保持现状）。
4. 不要为了区分单击/双击而给单击加延迟；双击后短暂的选择区闪烁可以接受，导入前面恢复即可。

`importSelected` 增加可选参数：

```ts
importSelected(ids?: string[]): Promise<void>
```

不传时取当前 `selection`（保持旧调用与测试）；传了就用传入的 id 集。
**不要**在 store 里另写一套批量逻辑，复用现有 `importSelected` 的分批、跳过、进度语义。

### 5.3 `importWhole`（合集整包入口）

新增 store action（名字可叫 `importWhole` / `importContainer`，只保留一个）：

1. `await openMemberPicker(card.id)` —— 它自己会解析/选择导入目标、拉清单；
2. 如果目标被取消、面板没开或还在 loading，直接结束，不要继续；
3. 面板打开且清单回来后，`pickAllMembers()` 全选；
4. 绝不直接调 `importCommit`；真正的导入仍由用户在面板里按“抽取并检查”触发。

`App.tsx` 的 Enter 在“选 1 张且是合集”时也走这个 action，保证键盘和双击同一条路。

### 5.4 多包卡的判据（Q9 甲）

`src/shared/memberPick.ts:cardImportChoice` 改成：

- `packages.length === 0` → `empty`
- `packages.length === 1` → `single`，`indexes=[0]`
- `packages.length > 1` → `needs-choice`，不管有没有 `path === null`

连带：

- `importAsset` 里 needs-choice 的提示从“这个容器里有 N 个包”改成“这张卡里有 N 个包”；
- `importSelected` 的跳过提示改成“有好几个包，得先双击打开面板勾”；
- `library.multiplePackages`（“这次先导第 1 个”）如果不再使用，三语一起删；
- 更新 `tests/shared/member-pick.spec.ts`，补“两个直导包也返回 needs-choice”的正向用例。

### 5.5 要删掉的按钮（一处都不留）

| 文件 | 要删的东西 |
|---|---|
| `src/renderer/components/DetailPanel.tsx` | 底部主色「导入到 Unity / 导入到 X」整颗；`importBusy` 相关变量 |
| `src/renderer/components/BundleDetail.tsx` | 每行的「导入」按钮；顶部「整包导入 Unity」；底部「选包导入 Unity」；`importBusy`/`importTargetName`/`settings` 的读取 |
| `src/renderer/components/AssetGrid.tsx` | `selection.length > 1` 时的批量导入按钮 |
| `src/renderer/pages/Settings.tsx` | 「双击素材卡」Field 与下拉 |
| `src/shared/settingsDefaults.ts` / `src/shared/types.ts` | `doubleClickAction` 字段 |
| i18n 三语 | 上述按钮/设置真正变成死 key 的条目，三份一起删 |

**保留**（不算“常驻导入按钮”）：

- `MemberPicker` 的「抽取并检查这 N 个 / 将选中的 N 项导入到 X」；
- `ImportFlow` 冲突框的「继续 / 继续并备份」；
- 结果条与批量结果里的「撤回 / 继续下一批」；
- 顶栏的「导入目标：X」选择器（它不是导入动作）；
- 容器内部 Enter 打开成员面板的键盘路径。

删完不许留 `disabled` 占位、`display:none` 的按钮或“更多 → 导入”菜单。

### 5.6 设置项删除

- 从 `AppSettings` 与 `settingsDefaults` 删除 `doubleClickAction`；
- `Settings.tsx` 删除 Field，顺手清掉不再使用的 import；
- 不做迁移、不动 schema；旧 `settings.json` 里就算还留着 `doubleClickAction`，也不读、不报错；
- 加一条源码级用例：`src/renderer` 与 `src/shared` 里不再出现 `doubleClickAction`（剥注释后再断言）。

### 5.7 i18n

- 新增的文案三语齐全，key 集合必须完全一致；不允许空翻译；
- 中文用“合集”，不要用“集合”；英文/日文沿用现有 `nav.bundles` / `containerCollection` 的术语，
  不要让“合集”和“集合”在同一条句子里混用；
- 建议的 key（最终名字可微调，但三语要一致）：
  - `library.gestureHint`：`双击导入 · 长按 1 秒打开合集`
  - `library.bundleGestureHint`：`双击一行导入 · Enter 选包 · Esc 返回`
  - `library.batchGestureHint`：`已选 {{count}} 项 · 双击其中一张一起导入`
  - `library.dblclickImportHint`：`双击卡片导入到 {{name}}`
  - `library.dblclickImportHintNoTarget`：`双击卡片导入（会先请你选择工程）`
  - `library.holdToOpen`：`长按 1 秒打开合集`
- 删除旧按钮 key 时同步删除 `library.importToUnity` / `importToProject` / `importToUnityHint` /
  `batchImport*` / `bundleImport*` / `common.import` / `settings.doubleClick` / `settings.dc*` /
  `library.dblclickHint`（**先确认没有第二处引用**）；
- 主进程仍然只回传 key，不许写中文；`tests/renderer/i18n.spec.ts` 必须绿。

### 5.8 文档

- `README.md`：
  - 把“选择资源，点击带工程名的导入按钮”改成双击/长按/多选的说明；
  - 键盘表补 `Shift+Enter`；
  - 发布版本号那一行只在真的发布时改，不要提前写“0.8.0 已发布”。
- `docs/DEVELOPMENT.md`：
  - 更新“容器里双击吃设置里的双击行为”这条当前行为描述；
  - 加一节本轮记录：用户为什么推翻 UX-13、删了哪些入口、保留了哪些安全网。
- `docs/discussions/2026-10-15-ux-simplification.md`：
  - 在顶部加一条 2026-10-21 的后续决定：用户明确要求“无导入按钮、双击导入、长按开合集”，
    UX-13 的讨论建议被推翻；**不要改写历史正文**。
- 新增 `docs/VERIFY-2026-10-21-GESTURES.md`：活体证据、截图路径、没验到的项。
- 历史 release-body / PROMPT 文件不改。

### 5.9 测试与工具（这一节最容易被漏）

现有测试/工具直接钉着旧行为，必须一起改，否则会变成假红或假绿：

| 文件 | 要做什么 |
|---|---|
| `tests/renderer/r10-container-and-copy.spec.ts` | 删除“行内导入按钮”“双击吃设置”“顶部整包按钮”三条旧断言；改成新手势的接线断言 |
| `tests/shared/member-pick.spec.ts` | 增加“多个直导包 → needs-choice”的用例 |
| `tests/spec-coverage.spec.ts` | 更新 `R-67` 的 `what` 与 test 引用，不要让它继续描述旧双击 |
| `tools/verify-red-r10.cjs` | 删除 B1–B3 里指向已删按钮/设置项的变异（B4 的“Enter 开面板”仍有效，保留）；为新行为加 4–6 条变异 |
| `tools/live-r10.cjs` | 436 行“双击合集卡进容器”改成“长按进容器”；485–506 行“行内按钮”改成“行内无按钮”；双击行仍导入 |
| `tools/live-*.cjs` / 沙盒 settings | 不再写 `doubleClickAction`；写了也只是被忽略，但会误导下一个人 |

新增测试建议：

- `tests/shared/card-gesture.spec.ts`：常量、8px 移动取消、主键/修饰键判断；
- `tests/renderer/gesture-wiring.spec.ts`（源码级，先 `stripComments`）：
  - 组件里不再出现导入按钮 key；
  - 双击普通卡调用 `importAsset`，双击合集调用 `importWhole`；
  - 长按只挂在 `card.isBundle` 上，调用 `setNav('bundle:' + id)`；
  - 使用 `LONG_PRESS_MS` 而不是字面量 1000；
  - 多选快照在 `e.detail === 1` 时写入；
  - 列表行有同样的双击/长按接线；
  - `App.tsx` 有 `Shift+Enter` 打开合集；
  - `Settings.tsx` / types / defaults 不再有 `doubleClickAction`。

变异验证至少覆盖：

1. 把 `LONG_PRESS_MS` 改成 900 → 常量用例红；
2. 去掉 `card.isBundle` 判断，让普通卡也能长按 → 接线用例红；
3. 去掉 `pickAllMembers()` → 合集整包接线红；
4. 把双击普通卡改回 `setNav` → 双击导入接线红；
5. 把 `e.detail === 1` 的快照删掉 → 多选快照用例红；
6. 把某颗导入按钮加回去 → “无按钮”用例红。

跑变异工具时：一次只跑一轮、不要和别的重活并行、跑完 `git status` 必须只剩有意改动。

---

## 6. 功能冲突清单（逐条处理，不许“大概没问题”）

| 冲突 | 处理 |
|---|---|
| 删掉工具栏批量按钮后没有鼠标批量入口 | 多选双击选中卡 → `importSelected(快照)`（Q3 甲） |
| 列表视图没有双击/长按 | 同步实现；合集行加可见标识（Q5 甲） |
| 非合集卡多个包时旧提示指向不存在的“卡内部” | `cardImportChoice` 改 needs-choice，双击开面板（Q9 甲） |
| 设置“预览/打开文件夹”会让双击不导入，按钮又没了 | 删除设置项，固定导入（Q6 甲） |
| 容器行/顶部/底部的导入按钮删掉后功能丢失 | 行双击保留；整包由网格双击合集+全预勾承接；Enter 仍开面板 |
| 双击行里的复选框会触发导入 | checkbox 的 `onDoubleClick` 与 `onPointerDown` stopPropagation |
| 封面图片默认可拖拽，长按会变成原生拖图 | `<img draggable={false}>` + 卡片 `onDragStart preventDefault` |
| 双击两次 click 把多选打散 | `e.detail === 1` 快照，导入前恢复选区 |
| 按住时滚轮滚动但指针没动，长按照样触发 | capture 监听 `scroll` 取消 |
| 长按和双击抢同一块表面 | 双击在几百毫秒内完成；长按 1 秒且有进度条；普通卡不挂长按 |
| 双击误写工程 | 目标显示、默认导入前确认、冲突必问、结果条可撤回；本轮不降低任何安全闸 |
| 没有导入目标 | 沿用 `ensureImportTarget`：自动选唯一工程 / 多工程让用户选一次 / 没有工程就提示打开 Unity |
| 导入忙碌 | 沿用 `batchBusy` 守卫和 toast，不另起队列 |
| 键盘用户没有打开合集的入口 | `Shift+Enter`（Q8 甲） |
| 删 key 导致三语漂移 | 三份一起删/加，`i18n.spec.ts` 必须绿 |
| 渲染层零 DOM 测试 | 纯逻辑单测 + 源码接线 + 打包版 CDP 活体；验证报告如实写“画法未做 DOM 测试” |
| 老用户习惯变更 | 发布说明写明；旧设置值忽略但不迁移；不偷偷改文件处理 |

---

## 7. 非目标（本轮明确不做）

- 不改导入目标解析、自动连接、自动切换集合的规则。
- 不改冲突预扫、备份、撤销、`import_log`、批量 `batch_id` 形状。
- 不改 `confirmBeforeImport` / `backupOverwritten` 的默认值。
- 不改成员面板的分批上限、预勾依据、失败处理。
- 不改用户自建“集合”（`nav.collections`）的任何行为。
- 不改收件箱、拖放入库、维护页、封面、桥接 C#。
- 不做右键菜单、悬浮按钮、拖到 Unity、单击导入。
- 不引入 DOM 测试框架（保持现状；用纯函数、源码接线、CDP 活体）。
- 不动数据库 schema、不做迁移。
- 不碰真实库 `E:\Atriumdate` / `E:\vrc\A`、真实 Unity 工程。
- 不发 GitHub Release（Q10 甲）；本机覆盖安装是必须的。

---

## 8. 改动文件清单（预估）

**新增**

- `src/shared/cardGesture.ts`
- `src/renderer/lib/useLongPress.ts`
- `tests/shared/card-gesture.spec.ts`
- `tests/renderer/gesture-wiring.spec.ts`
- `docs/VERIFY-2026-10-21-GESTURES.md`

**修改**

- `src/renderer/components/AssetGrid.tsx`
- `src/renderer/components/DetailPanel.tsx`
- `src/renderer/components/BundleDetail.tsx`
- `src/renderer/components/chrome.tsx`（状态栏提示）
- `src/renderer/App.tsx`（Enter / Shift+Enter）
- `src/renderer/pages/Settings.tsx`
- `src/renderer/stores/ui.ts`（`importWhole`、`importSelected(ids?)`）
- `src/shared/memberPick.ts`
- `src/shared/types.ts`、`src/shared/settingsDefaults.ts`
- `src/renderer/i18n/{zh-CN,en,ja}.json`
- `tests/renderer/r10-container-and-copy.spec.ts`
- `tests/shared/member-pick.spec.ts`
- `tests/spec-coverage.spec.ts`
- `tools/verify-red-r10.cjs`
- `tools/live-r10.cjs`（或新增一个活体脚本，但旧的必须同步改掉）
- `README.md`
- `docs/DEVELOPMENT.md`
- `docs/discussions/2026-10-15-ux-simplification.md`（只加后续决定注记）
- `package.json`（Q10 甲：0.8.0）

---

## 9. 验收判据（必须逐条给证据）

### 9.1 自动检查

1. `npm run typecheck` 干净（两个 tsconfig）。
2. `npm test` 退出码 0；报告实际通过/跳过数与文件数。旧基线是 2029+19=2048，本轮新增用例后总数会变，**不要拿旧数字当通过标准**；只按实际退出码与失败项判断。
3. 新增/更新的用例至少覆盖：
   - 1000ms 常量与 8px 取消阈值；
   - 普通卡长按无动作、合集卡长按进 `bundle:`；
   - 双击普通卡 → `importAsset`；双击合集 → `importWhole` + 全预勾；
   - 多选快照（`e.detail === 1`）与 `importSelected(snap)`；
   - 列表行同套手势；
   - `Shift+Enter` 打开合集；
   - 源码里没有常驻导入按钮、没有 `doubleClickAction`。
4. `node tools/verify-red-r10.cjs` 单独跑完：基线全绿，新增变异每一处撤掉都有用例变红；报告红了几条、总共几处。
5. `npm run build` 成功（含 worker 依赖检查）；`node tools/pkg-version.cjs` 的版本/许可/依赖/“asar 不比源码旧”四条都绿。

### 9.2 打包版活体（必须，不是只跑 dev）

在**沙盒**里跑，绝不动真库：

- `AVCA_APP_HOME=<沙盒>\AppData\Roaming\A`
- `LOCALAPPDATA=<沙盒>\AppData\Local`
- `AVCA_REQUIRE_SANDBOX_HOME=1`
- 用 `dist\win-unpacked\Atrium.exe --remote-debugging-port=<端口>`，CDP 真输入（`Input.dispatchMouseEvent`），不要只用 DOM 合成事件。

至少验证：

1. 网格里双击普通卡 → 导入流程启动（无冲突时出结果条；有冲突时列路径）；取消/撤回都正常。
2. 网格里长按合集卡 1100ms → 进入合集内部；900ms 松手 → **不**进入。
3. 按住后移动 20px 再松手 → 不进入。
4. 长按普通卡 1.2 秒 → 不进入、不导入、不弹任何东西。
5. 双击合集卡 → 成员面板打开、包全部预勾；取消后面板关闭且没有残留抽取。
6. 多选 3 张普通卡 → 双击其中一张 → 批量面板出现并显示 3 项（或如实显示跳过数）。
7. 列表视图：双击普通行导入；长按合集行进入。
8. 详情面板、容器内部、工具栏、设置页 **都不存在**导入按钮 / 双击设置；DOM 查询结果留证。
9. 无目标 / 多工程 / 忙碌三种情况下，双击都有明确提示，不静默失败。
10. 全程结束后真实库与真实 Unity 工程零写入（至少核对真实库文件字节/mtime 未变）。

### 9.3 截图

至少保存：

- 网格状态栏提示与详情面板灰字提示；
- 长按到约 500ms 时的进度条；
- 长按后进入的合集内部；
- 双击合集后的成员面板（全预勾）；
- 多选双击后的批量面板；
- 列表视图无导入按钮的样子。

截图放 `docs/screenshots/gesture-*.png`，在验证文档里逐张说明“这张证明什么”。
**没截到的不要写“已确认”**。

### 9.4 本机安装（AGENTS 硬规矩）

- 先轮询到没有任何 `Atrium.exe`（Electron 子进程会晚死几秒，固定 sleep 会撞旧卸载器）。
- `Start-Process dist\Atrium-Setup-0.8.0.exe -ArgumentList '/S' -Wait`。
- `node tools/installed-version.cjs --expect=0.8.0`，必须真的读到新 `DisplayVersion`。
- 起安装版时清掉 `ELECTRON_RUN_AS_NODE`；只做启动与版本核对，不在真库上做手势测试。
- 本轮不发 Release；如果用户之后批准发布，再写 release-body 并走 `gh-release.cjs`。

---

## 10. 交付流程

1. 从最新 `main` 开 `codex/interaction-gestures`（或其他 `codex/` 前缀）分支。
2. 实现 + 测试 + typecheck + build；UI/IPC 相关必须按 §9.2 在隔离数据目录活体验证。
3. 中文提交信息，说明“为什么”而不只是“改了什么”。
4. 按 `AGENTS.md` 走 PR；PR 描述附：改动清单、测试数字、变异结果、活体证据、未验证项。
5. 合并前确认没有冲突、远端必需检查通过；目标分支有新改动就先整合再验。
6. 合并后按 §9.4 更新本机安装。**公开 Release 另行等用户批准。**

---

## 11. 报告模板（收尾时照这个说，不许糊）

- **改了什么**：按用户能感知的行为说，不按文件流水账。
- **自动验证**：`npm test` 实际数字 / 退出码、`npm run typecheck`、`npm run build`、`pkg-version`。
- **变异验证**：工具名、基线条数、新增变异数、每处红了几条、是否 `git status` 干净。
- **活体验证**：沙盒路径、端口、10 条判据逐条结果、截图路径。
- **没验证的**：例如“渲染层画法仍然零 DOM 测试”“长按在触控板上的手感只看过截图”“真 Unity 导入的最终结果没有重跑”等，照实写。
- **本机版本**：注册表 `DisplayVersion` 实际值。
- 不要把“能启动”说成“所有功能都完成”；不要把条件跳过的测试说成通过。

---

## 12. 风险与回滚

- **最大风险是发现性**：老用户找不到导入入口。缓解是 §3.5 的多处提示 + 发布说明；
  如果用户实际用下来仍然找不到，下一步应加一次性引导，而不是偷偷把按钮加回来。
- **第二风险是误触写工程**：默认确认仍在；如果用户把确认关了，结果条仍可撤回。
  本轮不降低安全闸；如果实施中发现某条安全网依赖被删的按钮，停下来报告。
- **回滚**：全部是渲染层/设置字段的改动，无 schema、无迁移、无数据写入；
  revert 本分支即可恢复旧按钮与旧设置。旧 `settings.json` 里的 `doubleClickAction` 没被删，
  降级回旧版本仍能读到。
- **不要**为了“顺手”改导入目标、冲突、备份、批量形状；那会让这次变更无法单独回滚。

---

## 附录 A：建议文案（中文为准，英/日按现有术语对齐）

| key | zh-CN | en | ja |
|---|---|---|---|
| `library.gestureHint` | 双击导入 · 长按 1 秒打开合集 | Double-click to import · Hold 1 s on a collection card to open it | ダブルクリックでインポート · コレクションカードを 1 秒長押しで開く |
| `library.bundleGestureHint` | 双击一行导入 · Enter 选包 · Esc 返回 | Double-click a row to import · Enter to pick packages · Esc to go back | 行をダブルクリックでインポート · Enter でパッケージ選択 · Esc で戻る |
| `library.batchGestureHint` | 已选 {{count}} 项 · 双击其中一张一起导入 | {{count}} selected · Double-click one to import them together | {{count}} 件選択中 · 1 つをダブルクリックでまとめてインポート |
| `library.dblclickImportHint` | 双击卡片导入到 {{name}} | Double-click the card to import into {{name}} | カードをダブルクリックで {{name}} にインポート |
| `library.dblclickImportHintNoTarget` | 双击卡片导入（会先请你选择工程） | Double-click to import (you will choose a project first) | ダブルクリックでインポート（先にプロジェクトを選びます） |
| `library.holdToOpen` | 长按 1 秒打开合集 | Hold 1 s to open this collection | 1 秒長押しでこのコレクションを開く |

英文里 `Collections` 同时被用在“合集”和“集合”上（UX-11 的旧账）。本轮不要重命名侧栏，
但文案里尽量说“collection card / its contents”，避免让用户以为长按打开的是用户自建集合。
