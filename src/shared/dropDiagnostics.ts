/**
 * 拖放失败的"该说什么"（第 10 轮 E）。
 *
 * 判据放 shared 有两个原因：
 *  1. 这个仓库的测试是 node 环境、零 DOM，渲染层里的分支测不到 —— 只有搬到 shared 才能钉用例；
 *  2. 这条分支以前**根本不存在**（拿到 0 个路径就当无事发生），他报的"拖进去一点反应也没有"
 *     读到的就是这个静默。
 *
 * 两种"没拿到路径"是两件不同的事，话要分开说：
 *  - `files > 0`：事件进来了、也带文件，但一个本地路径都解析不出来
 *    （浏览器里的图、压缩包预览窗口里的一行、网盘占位文件都会这样）；
 *  - `files === 0`：`drop` 里压根没有文件 —— 拖的是文字/快捷方式，
 *    或者事件本身就是空的那一种（根因未定死的那条，见 §2-E 的注）。
 */
export interface DropEmptyInfo {
  /** `dataTransfer.files` 的条数 */
  files: number
  /** 真正解析出的本地绝对路径条数 */
  localPaths: number
}

/** 有话要说时返回 i18n 键，无事发生（拿到了路径）时返回 null —— 界面据此决定弹不弹 */
export function dropEmptyKey(info: DropEmptyInfo): string | null {
  if (info.localPaths > 0) return null
  return info.files > 0 ? 'library.dropNoLocalPath' : 'library.dropNothing'
}
