# 独立仓库历史与许可证来源

One4All 的初始独立历史由来源仓库 [YuYiChyan/MCHOUSE_for_all](https://github.com/YuYiChyan/MCHOUSE_for_all) 的 `desktop/` 子目录拆出。来源截止提交为 [`88a7383ff8d1ccaaac75a78650d03224c9953047`](https://github.com/YuYiChyan/MCHOUSE_for_all/commit/88a7383ff8d1ccaaac75a78650d03224c9953047)。旧仓库及其已有发布保留。

使用 `git subtree split --prefix=desktop` 保留了三次桌面版提交的作者、时间、提交说明及顺序；因为原来的子目录成为独立仓库根目录，提交 ID 随之改变。拆分结果为 `7020476340bf99a71e6c51421167beb804c53e77`，其根 tree 与来源提交的 `desktop/` tree 完全相同：`a4262187acdf1afb1317f5ca18bcc84776d7abbf`。

| 来源提交 | 独立历史提交 | 变更 |
| --- | --- | --- |
| `0472c3f` | `f4d4e03d4260662b947bb1dc915b5026b01212f2` | 独立设备中心 0.6.0-preview.3 |
| `e18ad56` | `a2fa5dbe223ae1bd33a938290fafd98a623394e0` | 国产鼠标、VIA 键盘与西伯利亚控制 |
| `88a7383` | `7020476340bf99a71e6c51421167beb804c53e77` | NANO68 控制与金色选色器 |

根目录的 [LICENSE](../LICENSE) 原样复制自上述来源提交的根 `LICENSE`：MIT License，Copyright (c) 2026 One4All contributors。拆分不改变已有授权或第三方材料的授权。

[THIRD_PARTY-MCHOUSE.md](THIRD_PARTY-MCHOUSE.md) 是上述来源提交的根 `THIRD_PARTY.md` 的原样历史副本。**其中 `library/`、`razer-mini-se/`、`logitech-g309/` 等路径均指来源仓库的目录，而不是本独立仓库当前目录。** 该文件保留来源与许可线索，不应解读为独立桌面版当前发行包的完整组件清单。

桌面版各适配器的来源链接与版本记录保留在 `docs/`、`catalog/` 及对应源码中。正式发行包内的组件清单由 `packaging/build-windows.cjs` 生成；实际携带的 Python、openrazer-win、HIDAPI、Core Audio 依赖和 Electron/Chromium 仍需随包保留各自的许可证、源码或发行元数据。设备图片和厂商运行时的原有权利说明继续适用，不能仅凭本项目 MIT 文件替代。
