# 设备实机验证反馈

控制页设备信息中的「提交验证反馈」打开报告表单。用户选择自己在实物设备上测试通过的功能，确认型号、适配器版本及备注，然后点击「确认并提交验证」。所有功能默认未勾选。页面能打开、模拟设备返回成功、协议测试通过，都不属于实机验证。

默认报告发往 [YuYiChyan/One4All 的 GitHub Issues](https://github.com/YuYiChyan/One4All/issues)，只包含支持库型号 ID、名称、品牌、适配器及版本、选填固件版本、用户勾选的功能和备注。不会自动复制设备序列号、HID 路径或运行日志。用户填写的长备注、协议文字和排障路径完整保留，不按关键字扫描或 800 字符截断；单独配置的实际登录 Token 不放入报告。

0.6.0 增加两种独立入口：卡片上的“待验证”徽章可由用户实测后确认到本机，支持撤销；支持库的“服务器设置”可填写未来部署的统一验证服务地址。地址配置后，反馈窗口可以选择该服务器，支持库可刷新服务端的功能状态。当前未绑定或部署服务器，保存地址本身不发送请求。

本机确认、GitHub 回执、服务器收件和服务端功能状态分别保存。服务器返回“已收到反馈”不等于“功能已验证”，也不自动修改本机确认。详细接口见 [验证服务契约](VERIFICATION-SERVER-API.md)。

## 提交方式

- 未配置 Token：打开带有标题、正文的 GitHub 新 Issue 页面。用户需要登录 GitHub 并在网页中提交；应用仅提示“等待网页提交”，不假定报告已经发布。
- 配置 GitHub Token：点击确认后直接调用 GitHub 创建 Issue 接口，成功返回报告链接。Token 优先由 Electron 系统密钥服务加密保存；系统服务不可用或失败时按用户的保存操作写入本机配置，界面显示“已在本机保存”，重启后保留。无法解密旧记录时不会擅自清空。不会读取其他软件或 `gh` 的账号配置，也不会把维护者的共用 Token 打包分发。

GitHub 不提供游客直接创建 Issue。创建接口要求认证；细粒度令牌需要目标仓库的 **Issues: write** 权限。普通贡献者不一定能给他人的公开仓库创建具备该权限的细粒度令牌，因此浏览器登录是默认入口。真正的免账号投稿需要另外部署由维护者管理的转发服务，目前未实现。

官方参考：[创建 Issue 的 API](https://docs.github.com/en/rest/issues/issues#create-an-issue)、[通过 URL 填充 Issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue#creating-an-issue-from-a-url-query)、[个人访问令牌及限制](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)。

## 状态含义

成功提交保存到数据目录的 `validation-receipts.json`。记录包含该型号、适配器版本、通过功能和 Issue 链接；不改变支持库的全局 `unverified` 标记。维护者根据报告与后续复核，更新具体型号及具体功能的验证状态。

同一目标仓库内的报告内容有稳定指纹。重复点击、并发点击、程序重启后的相同报告会复用已成功的 Issue。网络中断或返回结果不完整时保留“结果未确认”，显示“重试提交”；用户可直接重试，也可自行查看 Issues，不需要审批或强制检查。重试可能产生重复 Issue，因为 GitHub 创建接口没有本客户端可用的幂等键。程序不会将浏览器打开视作提交成功。

提交没有固定 30 秒总时限，等待真实响应或网络错误；表单中的“取消提交”、关闭按钮和 Esc 可结束等待。取消不能撤回服务器可能已经收到的报告，因此状态仍可能为“结果未确认”，随后可重试。设置读取失败时可以重新读取或重新保存，不锁死提交表单。

## 独立仓库迁移

新报告目标改为 `YuYiChyan/One4All`；原 `YuYiChyan/MCHOUSE_for_all` 的已提交、待确认和失败回执完整保留，链接仍指向原仓库。新回执显式记录 `repository`，旧回执则根据原有 GitHub URL 显示来源。去重同时区分目标仓库，旧成功记录不会被当成新仓库已经收到的反馈，也不会被新记录覆盖。

报告预览只保存在当前进程内，没有可自动重放的持久化草稿。旧 `pending` / `uncertain` 回执不包含完整正文，不会自动搬运或重发。重启后需重新打开表单，检查新目标并点击确认，才会产生发往新仓库的报告；旧回执的结果仍需到旧链接核对。

迁移不重写 `validation-config.json` 或清除其中的加密 Token，也不修改本机确认和验证服务器设置。若原 Token 只授予旧仓库权限，新仓库提交可能需要用户调整该 Token 的仓库权限，或改用浏览器登录提交。

## 接入接口

`createValidationFeedback({ dataRoot, encryptString, decryptString, fetchImpl, openExternal })` 返回：

- `config()`：目标仓库、是否已配置 Token、保存方式，始终不返回 Token。
- `saveConfig({ token, clearToken })`：保存用户主动填写的凭据。留空保留原设置；`clearToken: true` 清除。
- `prepare({ model, providerVersion, firmware, checks, notes, hardwareConfirmed })`：从真实支持库模型筛选公开字段，生成预览；必须明确版本、至少一项有效检查、`hardwareConfirmed: true`。返回 `id/title/body/url/modelId/providerVersion/checks`。
- `submit(report.id)` / `submit({id,retry:true})`：提交本进程生成的报告；`retry:true` 明确重试 pending/uncertain 回执。返回 `submitted/mode/status/url`，不确定结果带 `retryAvailable:true`，成功还包含 `number`。已有成功回执始终复用。
- `cancelSubmission()`：取消当前正在等待的 GitHub 请求，可随后重试。
- `list()`：已保存的提交记录，包含各自的目标 `repository`；旧记录的来源从原有 URL 识别。

渲染端 `window.One4AllValidation.open({ model, providerVersion, firmware, availableChecks, api, notify, onSubmitted })` 返回 `{ ready, dispose }`。`availableChecks` 可传检查 ID 数组或 `{ id, label }` 数组，标签以内置中文文本为准。设备暂时断开且列表为空时提供未勾选的报告检查项，供用户补报此前实测结果；这不会增加设备控件、宣称接口存在或自动标记功能通过。

渲染端 API 方法为 `validationConfig/saveValidationConfig/prepareValidation/submitValidation/cancelValidationSubmission/listValidations`。`onSubmitted` 仅在 GitHub API 确认创建成功后调用。

开发测试使用替代网络函数和替代浏览器打开函数，不向 GitHub 创建测试 Issue。
