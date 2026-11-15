# MAONO PD100X RGB

官方 MAONO Link 4.8.3 的设备清单将 352F:0108 指向 PD100X_RGB.dll；卡片使用该模块的 PD100X_RGB.png 原厂图片。模块的增益、静音、降噪及降噪强度寄存器与 PD100X 的对应实现一致。公开的 [PD100X RGB 控制项目](https://github.com/SergioLugoPM/maono-mute-led) 也记录了 0108、MI_03 和 64 字节报告。

本适配复用常用声音控制与 HID 帧，设备读回和写入尚无本型号实机验证，标记待验证。RGB 灯效与 010C 不完全相同，暂不复用其灯效控件。0109 Lite 仍需核对实际 HID 报告，未列为可控制设备。010C 原有接入保留。
