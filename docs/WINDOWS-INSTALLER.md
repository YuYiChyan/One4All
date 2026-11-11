# One4All Windows 安装包 · 0.7.0-preview.3

从 [One4All 发布页](https://github.com/YuYiChyan/One4All/releases)下载 `One4All-Setup-0.7.0-preview.3.exe`。这是面向 64 位 Windows 的完整用户安装包，默认安装到当前账户的 `LocalAppData/Programs/One4All`，可选择安装位置和桌面快捷方式；开始菜单提供启动和卸载入口，系统“已安装的应用”也会登记卸载器。

安装包包含 Electron/Chromium、应用、产品目录及图片、Python/HID 等公共控制库和轻量 MelGeek 运行模块。迈从、雷蛇、罗技、西伯利亚的完整原厂安装器继续在 APP 中按需从官网获取，没有全部塞入主程序包。

全新电脑无需先安装旧版 One4All 或启动 MCHOSE HUB。首次启动创建自己的数据目录并打开支持库。原有安装的注册表、模块和配对数据继续保留；升级不会把本机已经确认的卡片和设置替换为默认值。独立仓库不改变已有的 One4All-Desktop 数据路径。

卸载默认只移除软件，保留设置、设备模块和下载缓存。卸载页可额外选择清除本账户的 One4All-Desktop 数据；该选项不删除旧 One4All 目录，也不卸载厂商驱动。安装和卸载都支持 `/S` 静默模式。

构建命令：`node packaging/build-windows.cjs build`，输出在 `dist`。无需全局安装构建工具，构建脚本使用固定版本的官方 NSIS 便携编译器，并生成 `artifact-manifest.json` 与 SHA-256 文件。当前版本记录见 [v0.7.0-preview.3](https://github.com/YuYiChyan/One4All/releases/tag/v0.7.0-preview.3)，安装问题请提交到 [One4All Issues](https://github.com/YuYiChyan/One4All/issues)。

项目从 MCHOUSE_for_all 桌面子项目独立发展；[原仓库发布页](https://github.com/YuYiChyan/MCHOUSE_for_all/releases)保留历史安装包与模块，新版本在 One4All 仓库发布。

预留的验证服务地址在“支持库 → 服务器设置”填写，默认为空。保存地址不发请求；用户点击“刷新验证状态”或选择服务器提交反馈后才访问相应接口，见 [验证服务器契约](VERIFICATION-SERVER-API.md)。本地确认和 GitHub 上报独立可用。
