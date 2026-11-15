# 声音优化

主页的声音优化卡片提供本机实时音高、低频厚度、尖锐柔化、清晰度、气音柔化、压缩和 DeepFilterNet3 降噪调节。默认压缩比例 1.3:1，1:1 为关闭；降噪衰减默认上限 12 dB，0 dB 表示不衰减。降噪使用本地神经网络，不识别用户身份、不模仿或替换声音，也不上传录音。调整可在试听时立即生效。

选择输入麦克风，将输出选择为 VB-CABLE Input，启动后在聊天软件中选择 VB-CABLE Output。也可戴耳机点击试听。虚拟声卡可在卡片中从官方源下载并安装；驱动按官方要求可能需要重启。处理在 One4All 运行期间持续，切换页面、最小化或点击窗口关闭按钮不会停止。关闭窗口后 One4All 留在系统托盘，单击托盘图标或再次打开程序即可恢复原窗口；托盘右键菜单中的“退出 One4All”会彻底退出并结束声音处理。声音优化页的停止按钮只停止音频处理。这些操作不会改变 Windows 默认输入设备。

托盘图标可能位于 Windows 任务栏的“显示隐藏的图标”箭头里。更新安装或卸载前，也请从托盘菜单退出程序。

降噪和音色是试听起点，键盘声与人声重叠时不能保证完全去除。设备负载、声音特征和声学环境会影响效果，建议从低强度开始调整。实时处理会引入延迟。

音高采用 SoundTouchJS AudioWorklet 2.1.1（MPL-2.0），源码 https://github.com/cutterbl/SoundTouchJS ，许可证在 app/voice-vendor/。降噪使用 @workadventure/noise-suppression 0.2.0（MIT）的 DeepFilterNet3 AudioWorklet、WASM 与模型，源码 https://github.com/workadventure/noise-suppression ，DeepFilterNet 源码与模型 https://github.com/Rikorose/DeepFilterNet （MIT / Apache-2.0）；许可证在 app/voice-vendor/deepfilter/。对工作线程的修改为增加实时衰减上限消息。VB-CABLE 从其官网获取，并按官方许可证安装，不内置驱动安装包。
