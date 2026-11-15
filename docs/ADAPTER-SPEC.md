# One4All 适配器规范 1

统一入口、设备控制器和品牌依赖分别发布。原厂组件优先官网下载；拆分的适配器由固定版本的 GitHub Release 提供。下载或安装原厂程序本身不代表已经完成设备适配。

## 输出与入口

AI 返回一个 JSON 对象：

```json
{
  "manifest": {
    "id": "brand-model",
    "version": "0.1.0",
    "entry": "adapter.cjs",
    "verification": "unverified",
    "matches": [{"vendorId": 0, "productId": 0, "interface": "由现有接口资料给出"}]
  },
  "files": [{"path": "adapter.cjs", "content": "适配器源码"}],
  "capabilities": [],
  "report": {"summary": "依据的接口与尚未完成的部分", "evidence": [], "missingEvidence": [], "manualChecks": []}
}
```

示例中的 USB 数值只是结构展示，实际匹配使用对应型号的标识。文件路径相对适配器目录，可包含协议定义、Python/C# 辅助源码、样式和其他文本资源；不按关键字或扩展名排除辅助文件。JavaScript 入口支持 `.cjs`、`.js`、`.mjs`，以 CommonJS 或 ES Module 导出 `createAdapter({packageRoot, device})`，返回 `{probe, execute, close}`。异步方法可以返回 Promise。依赖位于 packageRoot，原厂组件与 One4All 可能位于不同进程。生成后点击“试用模块”即可运行，无额外审批或强制审核。

工作台的 `instructions` 是用户适配需求，`userContext` 是用户补充资料，`packageContext` 是已下载包中的接口证据。本规范定义输出结构与运行接口，用户的具体项目要求决定实现内容。生成不会擅自启动模块；运行、停止和重试均由用户操作。

## 设备能力

`probe()` 实际连接并读取设备接口后返回：

```json
{
  "connected": true,
  "interfaceConfirmed": true,
  "provider": "brand-model",
  "version": "0.1.0",
  "evidence": ["本次握手读回内容或已确认的 SDK 方法结果"],
  "capabilities": [{
    "id": "pollingRate", "supported": true,
    "readable": true, "writable": true,
    "readCommand": "polling.read", "writeCommand": "polling.write",
    "options": [125, 500, 1000]
  }]
}
```

示例回报率仅展示格式，实际 options/range 来自设备或已有接口资料。未连上设备时返回 `connected:false`、`interfaceConfirmed:false`、空 capabilities。probe 和 execute 如实返回设备结果；模拟测试、本地缓存和实机回读应注明各自来源。

统一能力 id：`keymap`、`layers`、`macros`、`winLock`、`nkro`、`lightingEffect`、`lightingColor`、`lightingBrightness`、`lightingSpeed`、`perKeyLighting`、`pollingRate`、`debounce`、`sleepTimeout`、`actuation`、`rapidTrigger`、`deadzone`、`dks`、`socd`、`calibration`、`activeProfile`、`saveProfile`。

可读项提供 readCommand，可写项提供 writeCommand；原接口仅支持写入时可直接提供写控件。数值控件使用实际范围 `range:{min,max,step}`，选项控件使用 `options:[{value,label}]` 或标量列表。复合字段使用 `ranges:{fieldId:{min,max,step}}`：rapidTrigger 的 press/release、deadzone 的 top/bottom、dks 的 stage1/stage2。涉及按键的项提供 `keys:[{value,label}]`；keymap 还提供 actions、layers；宏提供 keys，只有设备或协议明确限制时才填写 maxEvents。

`execute(command,payload)` 调用自身登记的命令。读操作返回 `{ok:true,value:实际设备读回值}`；设置可读时由前端在写入后调用 readCommand，写失败抛出具体错误。动作命令返回 `{ok:true}` 确认。写 payload 为 `{capability:id,value}`；keymap value 为 `{layer,key,action}`，对应 read payload 可带 `{capability:'keymap',selection:{layer,key}}`。close 释放设备句柄、取消轮询、清理自己的子进程。

## 证据与待验证状态

利用已经解出的导出表、IPC 协议、厂商 SDK 示例、现有项目控制器、用户补充资料和实际报错记录实现功能；自动扫描未取得资料不会禁止用户继续生成。尚未实现的部分列在 missingEvidence，无法实现入口时 files 可以为空。候选是否有入口与硬件是否验证通过是两个状态。

报告说明已实现接口、尚缺资料及设备测试方法，不作为试用模块的审核门槛。

## 请求、扫描和重试

模型请求与草稿操作默认没有总超时。工作台提供“取消请求”和“停止模块”；取消后可重新运行。停止时先通知模块 close，1.5 秒仍未退出才结束该子进程，这是用户停止操作的清理期限，不是运行时间限制。

兼容接口支持用户填写的 HTTP/HTTPS 地址、路径前缀和查询参数；URL 内的用户名/密码不适用于 fetch 请求，API Key 使用独立输入框。`maxOutputTokens` 可选，留空时不向生成接口强加输出上限。服务商返回 `finish_reason: length` 时显示输出尚未完整，而非误报随机 JSON 错误。用户需求及补充资料原样发送，不按字符数静默裁剪。连通测试只请求简短回复。

包扫描默认读取安装目录内全部匹配的代码和协议文件，包括 node_modules 与设备 profiles，不设置时间、文件数量、目录深度、文本或摘要总量上限；支持 AbortSignal 取消。不读取浏览器会话数据库、缓存和 `.env` 文件，也不跟随目录链接。`inspectPackage({entry,status,signal,limits})` 的可选 `maxTextBytes/maxInputBytes/maxOutputBytes` 由调用方显式指定；指定读取限制时会标出截断，摘要超过指定输出值时保留接口记录并报告大小限制，不静默删接口。

API Key 优先由系统加密保存；系统存储不可用或失败时，用户点“保存”会保存到本机配置，重启后仍可使用。暂时无法解密旧记录时保留原值，可重新填写替换。配置 API 不返回密钥，错误文字中的实际 API Key 会隐藏。
