# Atrium 0.2.0 —— 发布说明（第 8 轮）

> 这份是**给人看的**发布说明，直接可以贴进 GitHub Release 的正文。
> 里面每一条都在真机上验过并留了凭据；没做到的写在「这版还没有」里，不藏。
> 开发视角的账本在 `README.md` 的「当前进度」与「明确没有的东西」，逐轮证据在
> `docs/VERIFY-UNVERIFIED.md`、`docs/M7-DESIGN.md` §10。

---

## 它是什么

给 VRChat 改模玩家用的素材管家，Windows 桌面程序。一句话：**把一坨散着的 zip / rar / 7z / unitypackage
丢进去，它替你解压、读懂内容、分类归档，之后你打开哪个 Unity 工程，它就自动切到那个模型该在的分区，
勾选后一键批量导入。**

库是 24 GB、几千个文件那种规模设计的，不是给十几个文件用的。

## 这一版能做的事

**收素材**
- 拖进窗口、资源管理器右键「发送到 Atrium」、命令行 `Atrium.exe --ingest <路径>`、监视文件夹 —— 四条路都通
- 支持 zip（含 cp932/Shift-JIS 日文文件名）、rar / RAR5、7z（含头部加密 `-mhe`）、unitypackage
- 要密码的包会问你要；勾「记住这个密码」之后，下次撞见同一个包它自己就试
- 读得懂包里的内容再分类：不是只看文件名。分类结果会告诉你**为什么**这么分（置信度 + 理由），
  没把握的进「待复核」而不是硬塞进库

**管素材**
- 三级模型：合集 → 子项 → 版本。一个 zip 里 17 件是一个筐，不会被撕成 17 张卡；
  同一个产品的多个变体（体型 / 版本 / 安装方式）会并成一张卡并分列显示
- 搜索支持拼音、假名、罗马字互搜（`shinano` / `シナノ` / `Constraint` 都能找到同一件）；
  分类的口语叫法（`yifu` → 服装）也能搜到，加词不用重启
- 「接管已有库」：指到你现有的 `E:\vrc\A` 那种目录，**只登记不搬盘**，一个文件都不动
- 改分类会**真的把文件搬到新目录**，搬之前给你看清单（几个文件 / 目标在哪 / 会覆盖谁），能整批撤销
- 删除一律走**回收站**，永不永久删除；大部分动作 `Ctrl+Z` 能回

**跟 Unity 配合**
- 桥接是一小段编辑器脚本，只写进工程的 `Packages/com.avca.bridge/`，**不动 `Assets/`、不改场景**
- 首次发现某个工程会问一句（安装 / 以后都自动安装（只这个工程）/ 暂不）；
  一次冒出一批工程时，一屏列出来默认全勾，你可以逐个取消，也可以点「剩下 N 个都不再问」
- 打开某个 Unity 工程 → 自动切到对应模型的集合分区；同一工程 5 分钟内只自动切一次；
  拿不准就不切，只更新顶栏
- 从托盘唤醒主窗口时**只置顶约 1.2 秒，不抢你的键盘焦点**
- 导入前会扫冲突并列出将被覆盖的文件；被覆盖的会先备份；Unity 在 Play 模式时命令会排队而不是失败

**第一次打开**
- 四步向导：① 素材库存哪儿 → ② 素材从哪儿来 → ③ 给 Unity 工程装桥接 → ④ 收尾。
  只有第 ① 步不能跳；中途「稍后配置」以后侧栏一直留着回来的入口
- 指到"已经有素材"的目录会当场问「接管 / 当成空库」；库根在 C 盘、盘快满了都会红字提醒（但不拦你）
- 老用户升级不会被拦：库根已经配过就直接进主界面

## 这版还没有

- **代码签名**：第一次运行 Windows 会提示"未知发布者"，要点「更多信息 → 仍要运行」
- **运行目录搬盘**：数据库 / 缩略图 / 暂存 / 日志固定在 `%APPDATA%\A`，向导里会显示位置和占用，但不能搬
- **一次导完好几批时，界面只能退回最后那一批**（第一批得从维护页的账里想办法）
- **工程里现在装了哪些 GUID 的反查**、撤销后留下的空目录 `.meta`、`topFolders` / `avatarDescriptors`
  —— 这四件都卡在桥接的 C# 侧（还是 1.0.0）
- 依赖分析结论的上文展示；重复项自动清理（现在只列不删）；汉字→日语读音检索（**这是裁定**，理由见 `docs/SEARCH.md` §4）；LLM 兜底

## 装 / 卸

- `Atrium-Setup-0.2.0.exe` —— 安装版（当前用户，不需要管理员），会建开始菜单与桌面快捷方式
- `Atrium-portable-0.2.0.exe` —— 便携版，解压即用
- **卸载不会删你的库**：`%APPDATA%\A`（数据库、日志、缩略图）和你的素材目录都在安装目录之外
  （配的是 `deleteAppDataOnUninstall: false`）

## 数据放在哪

| 东西 | 位置 |
|---|---|
| 素材库（你自己的文件） | 你指定的库根，例如 `E:\vrc\A` |
| 数据库 / 缩略图 / 暂存 / 备份 / 日志 | `%APPDATA%\A\`（`library.db`、`thumbs`、`staging`、`backups`、`logs`） |
| 设置（含库根、开关、首启进度） | `%APPDATA%\A\settings.json` |
| 记住的压缩包密码 | `library.db` 的 `password_vault` 表，**DPAPI 密文**，界面上永远不显示密码本身 |
| 你加的口语叫法（增量） | `%APPDATA%\A\categories.user.json`（内置词典只读，升级不丢） |

---

# 附：发布操作清单（给我自己 / 给下一轮）

产物（`npm run build` 之后）：

```
dist\Atrium-Setup-0.2.0.exe        ~93 MB   NSIS 安装版
dist\Atrium-portable-0.2.0.exe     ~93 MB   便携版
```

上传与发 Release 的步骤（**需要他现场建 PAT，这台机器没有 gh、没有凭证**）：

1. 他在浏览器上建一个 token：GitHub → Settings → Developer settings →
   **Fine-grained token** → 选中目标仓库 → Permissions 给 **Contents: Read and write** → 复制。
   （经典 token 也行，勾 `repo` 那一项就够。）
2. 仓库地址填这里：`https://github.com/<owner>/<repo>.git` —— 目前本仓库**还没有 remote**，
   也没打过 tag，所以这两步都是第一次。
3. 我这边执行（token 只在命令行里用一次，不落盘、不写进 git config）：
   ```bash
   git remote add origin https://github.com/<owner>/<repo>.git
   git tag v0.2.0
   git push origin main --follow-tags        # 需要 token；github.com 在这台机器上时通时不通
   ```
4. 建 Release 并传两个 exe（走 REST，不依赖 gh）：
   ```bash
   # 4.1 先把上面那份说明的正文塞进一个 JSON 字段里（中文不要内联在命令行，会被 shell 吃掉）：
   #     node -e "const fs=require('fs');fs.writeFileSync('/tmp/rel.json',JSON.stringify({tag_name:'v0.2.0',name:'Atrium 0.2.0',body:fs.readFileSync('docs/RELEASE-NOTES-0.2.0.md','utf8').split('# 附：发布操作清单')[0],draft:false,prerelease:false}))"
   curl -L -X POST https://api.github.com/repos/<owner>/<repo>/releases \
     -H "Authorization: Bearer <TOKEN>" -H "Accept: application/vnd.github+json" \
     --data @/tmp/rel.json
   #   → 返回体里的 upload_url 就是下一步要打的地址
   # 4.2 上传资产（每个文件一次）
   curl -L -X POST "<upload_url>?name=Atrium-Setup-0.2.0.exe" \
     -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/octet-stream" \
     --data-binary "@dist/Atrium-Setup-0.2.0.exe"
   ```
   ⚠ 这台机器上 `api.github.com` 要包重试（时通时不通），`-L` 不能省。
   ⚠ 4.2 那步是**二进制上传**，`Content-Type` 必须是 `application/octet-stream`，
      按表单字段传会 422（第一次发的人最容易在这儿翻车）。
5. 发完把 token 撤销掉（他只给这一次用途）。

**发布前必须过的闸**（第 8 轮 ③④⑤ 就是这三条）：

- [x] 全量 `npm test` 绿 + 双 `tsc` 干净 + `node tools/selfcheck-r4.cjs` 退出码 0（2026-10-09 17:36：**1369 passed / 9 skipped（106 文件）**，双 tsc 干净，selfcheck 0）
- [x] 两张变异回扫表都 exit 0：`verify-red-r4`（基线 353 全绿、42 处全钉住）、`verify-red-m7`（基线 103 全绿、29 处全钉住）—— 2026-10-09 16:5x 各跑一轮，**串行**跑，不与别的重活并行
- [ ] `Setup.exe` 真装 + **覆盖安装之后用户改动不丢**（`tools/live-r8-install.cjs`，工具已就位、**还没跑**）（口语增量、库根、已学规则、`password_vault`）
- [ ] 产物里 asar 比源码新；`resources/i18n/*.json` 三语齐全（中文文案不在 asar 里，别在 asar 里搜）
