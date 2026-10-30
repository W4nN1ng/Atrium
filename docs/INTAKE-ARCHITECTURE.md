# 规范化素材摄取：数据契约与所有权

2026-10-30，M1—M6。已落共享契约、核心数据库 V12、RAR 后端、可信清单、递归闭包、持久展开缓存、全局多重集匹配、持久入库计划和物理执行器；新入口接线留在 M7。

## M6：物理复制执行与撤销

`intake/executor.ts` 的 `executePlan(db, planId, opts)` 消费 M5 的 `PreparedIntakePlan`。它先检查 blocked、执行所有 pending review 回调、按唯一 copy blob 字节数做目标盘预检，再逐操作读取并完整校验源文件的 size+CRC32+SHA-256。文件写入目标目录临时位置，内容验证后才原子发布到 `.atrium/blobs/<sha前缀>/<sha>`；逻辑目标使用同卷 hardlink，不能 hardlink 时退回复制并再次完整校验。源目录只读，任何源变化、目标竞态、空间不足或校验失败都留下明确失败状态，不发布半成品。

`reuseFromOpId` 只能在父 copy 操作完成后解析；库内 `libraryBlobPath` 复用同样先验证内容。目标已存在且内容相同视为幂等命中，内容不同报 target-conflict，不覆盖用户文件。每次完成操作立即保存 progress，支持已完成操作跳过和重启续跑。取消会清理本次临时目标、未提交新 blob 和新建空目录，保留 completedOps/failedOps 供重试；AbortError 统一转换为 cancelled，不伪装成失败或成功。

所有长 IO 在数据库事务外。全部物理目标准备好后，单个短事务插入/校验 `content_blob`、写 `asset`、`asset_blob_ref` 和 `source_occurrence`；引用计数由 V12 触发器维护。duplicate 单元不新建 asset 或物理文件，但仍可写现有 asset 的 occurrence；merge 保留新逻辑 asset 和复用引用。计划 journal 记录本批执行；`undoPlan` 只删除本计划新建 asset/ref/occurrence 及没有其它引用的 blob，其他 asset 仍持有的共享 blob 和文件保持完整。

`db/repos/intakePlan.ts` 新增进度更新函数，验证 cacheKeys、完成操作必须属于当前计划且 target/idempotency/blob 对得上。dry-run 只做计划/预算读取，不创建 `.atrium`、数据库行或目标文件。M6 不接 UI/IPC，M7 再把确认、进度和取消接到现有摄取任务。

M6 新增 10 条执行器沙盒测试，最终全量 **3155 passed / 27 skipped / 0 failed**。安装包和已安装程序各用 Electron 33.4.11 的 packaged `intake.js` 执行一次真实临时文件复制与撤销：copy/ref/blob 清理和 integrity_check 均通过。安装版 asar SHA-256 为 `6ecb60499b132e23ad55a5ccaa91dedd9ad5740c2f4266db6cb885a99bfb5c9a`；55 个解包文件和 RAR 资源与构建一致。原源 5208 条目、63 副本和发布资产均未变。

## M5：规范化入库计划与持久化

`intake/planner.ts` 提供 `buildIntakePlan(scanRoot, {libraryRoot, sources, classifyDeps, existingTargetPaths?, sourceFileCount?}, libraryBlobIndex)`。构建只使用内存数据与路径/哈希计算，不读取文件、创建目录或写数据库；`db/repos/intakePlan.ts` 的 `persistIntakePlan` 是单独的短事务入口，只写 `intake_plan`。新增 prepared 结构仍使用计划版本 1、核心 schema 12；旧草案或未知版本在读取时明确拒绝，不自动改写。

计划把 M4 选择转为规范化逻辑树，普通容器边界改成目录、unitypackage 保持整包叶，不透明根容器原样保留为文件且没有“解压自身成员”的错误摘要。部分覆盖容器在其逻辑单元内保持完整：已位于同词干散目录的叶原地复用；覆盖来源在别处时，用引用补齐逻辑树。物理复制代表继续按 M4 散优先选择，另一个逻辑路径使用 `reuseFromOpId` 指向同计划复制操作。`extracts` 只列真正需要取得物理内容的成员，复用和不透明原件不列入解压任务。

单元划分调用现有 `classify`/`bundle`，主体与附属调用 `splitContainer`，没有新增分类分组算法。classifier 的噪声过滤仅影响分类，绝不决定 CopyOp 是否保留。普通目录/合集保留一棵完整树，既有筐摊平结果逐单元编制。单元名称使用源逻辑目录名，分类输入使用库内规范化路径和原目录语料。父级图片有名称亲和时给对应单元，无明确归属时给每个派生单元；内部图片自然保留。旁图操作单列 sidecars，全部合法图片目标进入 coverCandidates，未改既有人工封面。

目标目录与成员按 Windows 规则净化，保留原相对路径映射；目录和文件统一处理大小写及净化后撞名，确定性添加 `(2)`。过长名称加短哈希缩短，长路径先缩短单元名；仍无法容纳时保留 blocked 和来源，不能声称已复制。只有无旁文件的同名单层包装才折叠。源/库根重叠、危险库根和越界散来源明确拒绝。M5 不检查目标盘实时存在性；`existingTargetPaths` 是调用方盘点快照，M6 发布前仍需检查竞态、空间与实际文件。

M3 原本已计算的完整 SHA-256 现在随 `LeafRef.blobId` 传入计划，M4 保留它。库内索引按 size/CRC 找候选，再用完整 SHA 判定是否复用；同键不同 SHA 不会误用。未知 SHA 有库内候选时留下 library-identity 复核请求，不能标 duplicate。全部叶由带 asset 引用的库内 blob 覆盖时，单元 disposition=duplicate、assetId=null，只保存现有 asset 证据；部分复用为 merge，未匹配为 new。孤立 blob 可作为物理复用来源，但不伪造一个现有 asset。CopyOp 的 action 区分 copy/reuse，libraryBlobPath 或 reuseFromOpId 说明引用来源。blobId 已知时预计算目标+SHA 的 idempotencyKey，M6 必须重新校验实际字节后发布。

每个来源出现均记录到计划 occurrences，包括散副本、被覆盖压缩包成员、补齐成员与旁图归属。计划和操作 ID 为确定性摘要，输入枚举顺序不改变 JSON。已知 SHA 证明源 ContentKey 碰撞时，撤回相关 CRC-only skip、双保留载荷并要求复核。M4 的大决定 reviewMatches、原始证据和全部缓存键持久保存；reviews 是待执行的复核要求，不能直接当作已通过。实际字节复核、结果进度及缓存引用释放协议由 M6/M7 接续实现，M5 不擅自回收仍被计划引用的缓存。

仓储校验版本、计划摘要、目标边界、操作唯一性和复用依赖无环。重复保存同 ID 的相同计划不重置 status、completedOps、failedOps、cacheKeys 或时间；不同内容不覆盖原行。读取拒绝损坏/未知操作的完成进度。初态为 planned，有复核或 blocked 为 awaiting_confirm，全库覆盖为 duplicate。测试仅对隔离库保存计划，未建立新素材、blob、逻辑文件引用或实际 source_occurrence 行；这些提交属于 M6。

## M4：纯函数覆盖与全局选择

`intake/match.ts` 提供 `computeCoverage(closure, sources, {sourcePath})` 和 `planSelection(sources, {scanRoot})`；数据源为 `{sourcePath, kind: directory|archive|loose, closure, assetId?}`。两者均无 IO、无数据库、无 Electron 依赖，不修改输入。共享的 `LeafMatch` 增加可选 `coveringRelPath`/`leafRelPath`，让证据明确到双方相对路径；内容相等只使用经过校验的 size+完整 CRC32。

目录视图可包含递归容器成员，也可与子目录视图重叠。算法仅将无容器链的正常叶作为散内容；按最外层容器链派生独立 archive 视图，防止容器内成员给它自己作覆盖证据。显式 archive 视图与派生视图同源时核对内容多重集，不一致即拒绝；重叠目录中的同一物理散文件只记一次。物理路径仅识别同一文件的重复视图，绝不用于判定两个不同文件内容相同。空容器需要盘点器显式提供视图，因为空闭包无法从叶反推容器。

全局选择先保留散内容：相同内容的散副本只选一个复制代表，其余记 `identical-loose-copy` 和证据。代表优先靠近扫描根、名字无明显乱码，再以容器亲和、目录完整程度和字典序裁定。容器按叶数更多、诊断更少、路径更浅、字典序处理；只把实际保留的叶加入全局内容索引。每个容器对当前保留集合重新消费多重集计数：全部覆盖则 skip，部分覆盖仅 extract 缺少的叶，无覆盖则全部 extract。被跳过来源不会成为后来来源的证据，因此没有循环覆盖。两个叶内容相同但在同一容器出现两次时，只有一份散内容仍需补一份；保留叶的计数达到所有可信容器对该键需求的最大值，不会提前转成 Set。

覆盖证据优先散内容，再使用已保留容器。每层优先选择一个能完整覆盖的来源，平手按同词干、同父目录、叶数更多、路径字典序；否则计算多个来源的并集，逐叶记录 `coveringPath`、双方相对路径和重复键。来源只能覆盖目标实际缺少的次数；每个新容器重新计算，不把一个来源“用过一次”当作永久消耗。由单个已保留容器的相等闭包覆盖时记录 `duplicate-of-kept-archive`，其余全覆盖为 `fully-covered`。

不透明容器保持其完整 M3 保留载荷，标记 keep/opaque，不能作自动覆盖证据；没有内容键的失败来源列入 blocked，不编造空成功。正常散叶仍可独立处理。同名不同键都保留；最终目标冲突唯一化由 M5/M6 处理。空文件与噪声文件照常参与，未增加过滤器。

R17 的大决定不在纯函数内做字节 IO：闭包至少 1 GiB 且将复用其它来源时，决定带 `requiresByteReview` 和确定性的复核样本（至少 5 个或 10%，不超过可用叶数），并保留警告。这些是待复核建议，M5/M6 必须完成字节复核后才能最终跳过，不能直接执行标记为需复核的建议。本阶段没有接线执行器，也没有数据库持久化选择结果。

M3 已提前实现的 `identity.ts` 直接复用，仍为完整流式 CRC32/SHA-256，无采样替代。M4 的 matcher 与独立 `intake.js` 一同打包；库内 blob 索引参与、单元划分、目标名唯一化及实际发布分别留在 M5/M6，UI 接线留在 M7。

M4 新增 33 条测试（纯函数 29、M0 四样本集成 4），含 40 组确定性生成的最大多重集需求不变量检查。最终 typecheck 通过，全量 **3113 passed / 27 skipped / 0 failed**；只沿用 M0 的完整私有库规模项排除，其余条件跳过保持原条件。首轮搜索 p95 为 100.21ms，超过既有 100ms 门槛；测试并发由 4 降到 2 后完整重跑，p95 为 58.33ms，未修改搜索代码或任何性能断言。

真实副本结果：黑曜石 3 个 ZIP 全覆盖；motchiri 10/10 内容键覆盖、12 个散叶及旁图保留；名流跳过 PSD/UV ZIP，保留 22 个 unitypackage、8 个 PSD/UV 文件和父级预览；西装 RAR 13 叶中覆盖 3、补齐 10（含 Sio），两枚散 ZIP 被散包覆盖，最终 13 个内容键互不重复。motchiri 的 5 个散 `.url` 及 5 个包内副本仍保留既有 magic 的 text 扩展名诊断，共 10 条；这是叶格式诊断，非后端清单异常，完整 CRC/size 证据不受影响。其它三组闭包无警告。

M4 的安装包和本机安装版均在 Electron 33.4.11 Node 模式回放四组真实副本的完整内存索引，输出与源码计算的 JSON 逐字节相同，冻结输入和反向枚举也通过；回放时测试缓存已清理，匹配函数没有重新读取文件。另验证大决定待复核和重复次数，既有打包摄取 worker 的 RAR/密码/坏包流程通过。安装版 asar SHA-256 为 `a22972d409c404b56cb0c5a64bdf0a4e11cfab93d9150a5f6bc18af13946a498`，55 个解包文件和 RAR 资源逐项匹配。安装版 renderer/preload 就绪、隔离 V11 副本升至 V12、素材和人工封面不变且正常退出。原目录 5208 个条目元数据、63 个测试副本 SHA-256、原发布资产和正文均未变。

## M3：闭包、预算与缓存生命周期


`intake/closure.ts` 从目录或普通容器构建闭包，按实际字节识别 ZIP/RAR/7z，逐层保留内层在前的容器链、原始成员名和每次出现。`.unitypackage` 始终停为叶；扩展名与内容不符会警告。未支持的其它压缩格式、坏清单、解压/校验失败、密码放弃和预算超限都保留原始容器为 opaque 叶；目录读取失败或重解析点另列 unreadable，不能编造内容键或冒充完整闭包。成员无法读取时回退为原始父容器，避免只交付部分成员。取消抛出错误，不能伪装成成功降级。

默认深度 8、每容器 20000 条、累计展开字节上限 max(源字节 × 3, 256 GiB)、单成员 64 GiB，旧 `MAX_EXTRACT_DEPTH=3` 不变。每次展开前按可信清单检查预算；嵌套容器各层的逻辑展开字节都计入，即便复用物理缓存也计数。预算只约束容器展开，超限保留原始包。`identity.ts` 为缓存校验提前提供全量流式 size+CRC32/SHA-256；M4 再实现纯函数匹配。

`expandCache.ts` 在操作系统临时区的专属 marker 目录内，以容器 SHA-256 为键缓存整层直接成员。所有成员写到数字文件名，原始名字单独保存在 manifest 中，避免 Windows 非法字符、路径穿越、同路径重复成员造成丢失或覆盖。ZIP 以条目序号流式读取；RAR 使用定点抽取和安全目标映射；7z/加密 ZIP 以精确成员名流式输出。原生后端遇到歧义重名则明确降级。完整 size/CRC 和 SHA 校验通过后才原子发布；命中缓存也重新校验，内容损坏不静默复用。

缓存容量默认 8 GiB，可由 `ExpandCache` 配置；与 256 GiB 的逻辑预算分开。当前实现完整物化直接成员，不做按需叶抽取优化。物理空间不足（含 20% 余量及每成员元数据开销）或活跃缓存占满容量时返回显式 space 错误，由闭包保留原包；排队续跑界面留待 M7。没有跨文件解压/复制的数据库事务。

任务引用在抽取前原子持久化；`cacheOwnerId`/`cacheKeys` 供后续计划保存、恢复和释放。活进程引用、24 小时内的已退出进程引用，以及数据库中 planned/awaiting_confirm/running/failed/cancelled 计划的引用均受保护。完成任务需显式 release；持久计划中的缓存键由 `lifecycle.ts` 在启动清理时读取。仅对无引用缓存按 24 小时过期或容量压力下 LRU 清理，旧 staging 仍沿用原清理逻辑。坏引用数据会停止清理，避免误删。文件锁串行化跨进程写入，死进程锁可恢复；活进程中被强制终止的线程若遗留锁，会在 30 秒后报错并保留原包，进程重启后恢复，不冒险抢锁。

`runtime.ts` 编译为独立 `out/main/intake.js`，与 legacy worker 一起检查依赖并随安装包提供，便于验证实际打包代码。M3 仅接入缓存启动清理；拖入任务仍走旧摄取流程，M7 才切换入口。原目录只读；本阶段没有实施去重、移动素材或改变 Unity 导入。

M3 新增 31 条用例（闭包 16、缓存/身份/生命周期 14、RAR 取消 1）。最终 typecheck 通过，全量 **3080 passed / 27 skipped / 0 failed**；最后一轮限制测试进程并发为 4，保留全部原断言，仅沿用 M0 的完整私有库规模项排除。真实副本验证：西装 RAR 13 叶含 Sio、父目录 18 次出现且无警告。相同内层容器复用物理缓存仍保留两次出现；同路径 ZIP 重名、乱码、Windows 非法字符、尾随空格、空文件、嵌套密码、取消、四类预算、校验失败、并发缓存、容量/LRU、重启引用和命名空间隔离均有覆盖。

M3 缓存按数据库文件路径划分命名空间，避免不同库或隔离验收实例的清理互相影响。`ClosureOptions.cacheNamespace` 应与该任务数据库路径一致；默认使用当前 APP_HOME 下的 library.db。自定义 `cache`/`root` 的调用方自行保持同一命名空间。启动清理明确使用当前数据库的 `name`，不会遍历其它命名空间。

M3 安装包与安装版的独立闭包模块已在 Electron 33.4.11 的 worker_threads 下核验：西装 13/18 叶、重启复用相同缓存文件、4 个 ERP 包的 29 个文件完整内容多重集全部通过。既有打包摄取 worker 的 RAR/密码/坏包流程通过。最初验收脚本误把 CP437 解码形成的 `|` 当作当前解码名称特征；独立清单比对确认日文解码已还原，29 个内容键和重复次数完整一致；真正非法字符的合成用例仍通过。安装版 asar SHA-256 为 `57aef98bcc23f461f1c50611cac582282da4ee26ddf31f37784263c53a0d0d71`，55 个解包文件和 RAR 资源与构建一致。renderer/preload 就绪、隔离 V11 副本升至 V12，素材和人工封面不变且正常退出。M0 原源目录 5208 个条目元数据、63 个测试副本 SHA-256、原发布资产及正文保持原状。

## 内容身份与出现次数


- `ContentKey = { size, crc32 }`，使用全量 CRC32；序列化为十进制安全整数大小、冒号、8 位小写十六进制 CRC。零字节文件合法，CRC 可为 0；不接受负数、浮点大小、带符号 CRC 或不安全整数。
- 内容相等不依赖文件名、路径或容器层级。`LeafMultiset` 的值是出现次数，交集取较小次数，差集只减去已有次数；结果排序稳定，操作不修改输入。
- `BlobId` 是实际文件字节的完整 SHA-256。`(size, crc32)` 只是可查询的匹配候选索引，数据库允许同候选键对应不同 SHA-256；不能把候选键索引设成唯一约束。
- `.unitypackage` 始终作为一个叶，不能展开为内部文件入库。物理去重保留一份字节，逻辑上仍能保留两份同内容叶的次数与路径。

## V12 的四张新增表

| 表 | 职责 | 删除与幂等规则 |
|---|---|---|
| `content_blob` | SHA-256 主键、大小、全量 CRC、物理路径、引用计数 | SHA 唯一、候选键非唯一；仍被逻辑文件引用时禁止删行 |
| `asset_blob_ref` | 素材内一个逻辑文件的位置与 blob 关系 | 一个 `asset_id + path_key` 一行；删除素材级联移除自己的引用 |
| `source_occurrence` | 来源文件、容器链、原名、覆盖证据等审计信息 | 稳定 occurrence id 做 upsert；不增加 blob 的使用计数 |
| `intake_plan` | 带版本的计划 JSON、进度 JSON、状态与时间 | plan id 稳定，CopyOp id 稳定；重试复用已有记录 |

`asset_blob_ref` 是对原三表草案的必要补充：来源重复几次不等于素材真实引用几次。靠 `source_occurrence` 数行会把重复拖入、多个来源和用户仍在使用的文件混为一谈。

### 物理位置与现有导入兼容

后续执行器的约定为：blob 位于库根的 `.atrium/blobs/<SHA 前两位>/<SHA>`，`storage_path` 记完整物理路径，库内逻辑文件位于 `<单元目录>/<rel_path>`。同卷 NTFS 逻辑文件使用硬链接共享字节，并保留真实文件名和 `.unitypackage` 扩展名；绝不对源目录建立链接。无法保证单份物理内容时需明确报告，不能悄悄退回重复复制。

`asset.library_path` 继续指向真实的库内单元目录/文件，`asset.source_path` 保留原始来源；分类器与 `packagesOfAsset` 可继续遍历普通路径。blob 按不可变内容管理，修改内容须发布新 blob、转移引用，不能直接改写共享链接。上述文件发布、链接创建与空间检查属于 M6，本阶段未执行。

`path_key` 由写入层把已校验的相对路径统一为 `/` 分隔并转小写；保留显示用 `rel_path` 和来源原名。它只用于 Windows 落盘冲突，不用于内容匹配。路径越界、非法名净化和长路径策略在 M3/M5/M6 实现。

### 引用计数的唯一含义

`content_blob.ref_count = 当前引用该 blob 的 asset_blob_ref 行数`。同一素材两个路径指向相同内容时计 2；多个来源指向一个已有逻辑文件时仍计 1。

插入、删除、修改 blob 绑定的三个数据库触发器维护计数；调用者**不得再手动加减**。新 blob 以 0 引用登记，再添加引用。正常 upsert 使用 `ON CONFLICT ... DO UPDATE/NOTHING`，不使用具有隐式删除语义的 `INSERT OR REPLACE`。

删除素材仅级联删除其引用与来源记录；其他素材的引用继续有效。计数归零只表示可回收候选，不自动删除物理文件。物理回收、撤销与任务恢复由执行器在长 IO 之外编排。

来源记录可指向已有 asset 与已有逻辑文件，因此全重复单元不需要造新 asset。若逻辑文件、计划或已归零的 blob 记录后来删除，来源行的相应外键置空；`detail` 中保存原始 BlobId、ContentKey、相对路径及证据快照，审计事实不依赖活外键一直存在。

## 计划、覆盖与恢复

契约位于 `src/shared/intake.ts`，不 import Electron、Node 或数据库。包括扫描条目、预算、容器链、叶清单、覆盖证据、复制操作、单元、版本化计划、任务状态和进度。

覆盖路径 `coveredBy` 为数组，支持多个目录共同覆盖。`matchedLeaves` / `missingLeaves` 保留重复键，不能先转成 set。清单中的叶尚未抽取时，`localPath = null`。

计划是 JSON 可序列化数据；多重集 Map 是计算中间态，不能直接 JSON.stringify 后存进计划。计划版本为 1；未知版本需由未来读取端明确拒绝，不能假定兼容。

`CopyOp.id` 先于 SHA-256 稳定存在，进度按它记账；`blobId` 和最终 `idempotencyKey` 在读字节校验后、发布之前补齐并持久化，最终发布键仍按目标路径与 BlobId 派生。计划/进度显式列出缓存引用，不能把仍被引用的缓存启动即清。

## 迁移边界与验证

V12 只追加新表、索引、约束与触发器，既有 asset 行、路径、共享哈希、人工封面与 V1—V11 的 SQL/post 不变。没有根据旧路径猜 blob、哈希或自动移动旧文件；存量内容索引的建立由后续明确扫描处理。

M1 的合成 V11 文件先执行历史迁移，再写入合法共享哈希、人工封面、工程、导入历史和偏好，关闭后复制文件再迁移。测试逐表比较全部旧行、验证 integrity/foreign keys、迁移重放及原文件字节不变；回退演练也包含这条保护。

测试入口：`tests/shared/intake-multiset.spec.ts`、`tests/db/migration-v12.spec.ts`、`tests/rollback/drill.spec.ts`。真实用户库迁移测试仍按既有显式开关运行，跳过不能计为通过。

## M1 交付验证（2026-10-30）

- 先写测试再实现：初次定向运行因缺少契约/V12 表失败；实现后 74 条定向测试通过，其中新增 41 条覆盖多重集、迁移和回退保护。
- typecheck 通过；全量回归 **3017 passed / 28 skipped / 0 failed**。跳过包含 M0 已记录的完整私有库规模项，以及一次满载时 PowerShell 独占锁持有者启动超时。
- 单独补跑项目运行状态接线 9 条及已有迁移测试 2 条，**11 条全部通过**。这两条迁移测试通过重定向 APPDATA 使用合成 V11 输入副本，并非用户真实私有数据库验证。
- Node/Electron 原生依赖切换、Electron Vite 构建、worker 依赖检查、NSIS/portable 打包和包内版本检查全部通过。
- M1 安装包独立输出，本机静默覆盖安装后 `DisplayVersion=0.9.7`。最终 0.10.0 版本在 M10 再切换；本阶段通过 asar 哈希确认实际更新，不能仅靠相同版本号判断。
- 安装版与 M1 构建的 asar SHA-256 一致：`34aaaf826698bfb80ad92bf69cceac0be6194ce6f6592006ee0107668874ba59`。原 `dist/` 的 0.9.7 发布资产及未跟踪发布正文保持原哈希。
- 用安装版打开独立 sandbox 的 V11 副本：渲染页与 preload 就绪，数据库升至 12，integrity_check=ok，外键检查无错误，原素材行和人工封面不变；实例正常关闭。
- 当前未接入新摄取流程，真实素材整理、完整私有库迁移和 Unity 导入实机验收留待后续阶段。

## M2：RAR 与可信清单（2026-10-30）

RAR 的实际字节按 magic 分派至固定版本 `node-unrar-js@2.0.2`，使用结构化 UnRAR 文件接口。JS 进入 worker bundle，WASM 与两份许可文本随安装包本地提供；不依赖系统安装的 UnRAR，也不需要运行时下载。模块公开 API、资源定位、许可证与错误语义见 `src/main/unpack/README.md`。

统一清单校验拒绝警告、stderr 异常、失败退出、格式不符、捕获上限截断、缺少 CRC、不安全大小与无法证明完整的空结果。合法空 ZIP、空文件和 CRC=0 不会被误判。ZIP/7z/RAR 成员现在均提供可用的完整 CRC32；无法证明完整的结果抛 `UntrustworthyListingError`，由 M3 的闭包构建器按不透明容器保留，不得用于自动跳过。

RAR4/RAR5 非加密头先检查块范围和结束记录，RAR5 同时核对头校验；密码头由 UnRAR 解密后完整遍历。解码器的所有生成器必须消费到结束，同一上下文串行使用单例。未知分卷完整性不冒充已经验证。

RAR 密码只传入库接口；7z 密码通过 stdin 传给交互提示，进程参数中没有密码。修复了先前将 UnRAR 当作 7z CLI 的后端分派；原先期待该错误的用例已改成验证 7z 的正常备用读取行为。

新增 31 条用例；解包/密码相关定向 **122 passed / 7 skipped / 0 failed**，全量 **3049 passed / 27 skipped / 0 failed**，typecheck 通过。真实 M0 副本列全 13 个变体（含 Sio），截断数据及缺失结束记录均被拒绝；加密包、并发访问、定点抽取、空 ZIP、CRC 与 stdin 密码传输均有验证。27 项条件跳过按原条件保留，其中包含完整私有库规模断言，不能算通过。

Electron Vite、worker 依赖图、NSIS/portable 打包及包内版本检查均通过。实际打包目录的 worker 验证了 13 个变体、密码询问、加密 RAR 抽取和坏包拒绝。本机已覆盖安装 M2 的 0.9.7 开发构建，asar SHA-256 为 `dc6f8422f464d92ccbe2ec9e20680c3be814ebd40563f0d2b42c1236a6de509f`；安装版 renderer/preload 就绪、隔离 V11 副本升至 V12 且素材/人工封面不变、实例正常退出。安装目录 52 个解包文件、UnRAR WASM 与两份许可文本均和构建一致；源目录 5208 个条目元数据及原 0.9.7 发布资产保持原状。
