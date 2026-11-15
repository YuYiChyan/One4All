# 声音优化

主页的声音优化卡片为麦克风提供本机实时处理：SoundTouchJS 传统移调（默认 +1 半音）、EQ、轻度压缩和高频柔化，不使用 AI。选择输入麦克风，将输出选择为 VB-CABLE Input，启动后在聊天软件中选择 VB-CABLE Output。虚拟声卡可在卡片中从官方源下载并安装；驱动按官方要求可能需要重启。

处理在 One4All 运行期间持续，切换页面不会关闭。关闭 One4All 或点击停止后处理结束，不会改变 Windows 默认输入设备。未连接虚拟声卡时不将麦克风输出到扬声器。

声音参数是试听起点，并非对任何人的声音做判断。个别硬件和实时效果需要实际试听；SoundTouch 处理会引入延迟。

SoundTouchJS AudioWorklet 2.1.1 是 MPL-2.0 项目，发布源代码见 https://github.com/cutterbl/SoundTouchJS ，许可证在 app/voice-vendor/LICENSE。VB-CABLE 从其官网获取，并按官方许可证安装，不内置驱动安装包。
