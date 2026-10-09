# 自定义 NSIS 安装步骤 —— 只干一件事：把快捷方式的图标换成我们的 A
#
# 为什么要这么绕：这台机器上 `win.signAndEditExecutable` 必须是 false
# （electron-builder 要下的 winCodeSign 包里带 macOS 符号链接，非管理员解不出来），
# 关掉之后 **exe 里嵌的还是 Electron 默认图标**。而 NSIS 建快捷方式的写法是
# `CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 ...`（图标参数就是 exe 自己），
# 于是桌面上是个原子球而不是 A —— 2026-10-09 真装之后就是这么坏的。
#
# v24 的 nsis 配置里已经没有 `shortcutIcon` 这一项（合法字段表里没有它，试过报
# "unknown property"），所以只能在 customInstall 里把已经建好的两条快捷方式按原样重建一遍，
# 只把图标参数换成 `$INSTDIR\resources\icon.ico`（extraResources 显式拷了它，一定在）。
#
# 两条判据（跑完装一次，读 .lnk 核）：
#   1. 桌面与开始菜单的 IconLocation 必须是 `...\Atrium\resources\icon.ico,0`，不能是 `Atrium.exe,0`
#   2. 用户如果自己在装的时候取消过快捷方式 / 手动删过，这里**不许把它变回来** —— 所以只在 .lnk 已存在时重写
#
# 变量与写法全部照抄 app-builder-lib/templates/nsis/include/installer.nsh，别自己发明：
#   $appExe = $INSTDIR\Atrium.exe（installSection.nsh:9）
#   $newDesktopLink / $newStartMenuLink（common.nsh:93/104）
#
# ⚠ **这份脚本目前没接线**（electron-builder.yml 里的 `nsis.include` 是注释掉的）。
#   2026-10-09 接上之后覆盖安装报退出码 2、屏幕上弹错误框；把 include 注释掉重打**仍然是 2**，
#   所以它不是那次失败的原因，但也就没能验到"它真的能把 .lnk 改对"。
#   安装器那个故障查清之前别启用它 —— 逐条凭据与排除过程见 docs/VERIFY-UNVERIFIED.md §13。
#   本机桌面图标是当时用 `node tools/set-installed-icon.cjs` 直接改文件改出来的。

!macro customInstall
  StrCpy $R7 "$INSTDIR\resources\icon.ico"
  ${if} ${FileExists} "$R7"
    ${if} ${FileExists} "$newDesktopLink"
      CreateShortCut "$newDesktopLink" "$appExe" "" "$R7" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${endIf}
    ${if} ${FileExists} "$newStartMenuLink"
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$R7" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${endIf}
    # 让 shell 重读图标缓存，不然桌面上可能还挂着旧的那张
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${endIf}
!macroend
