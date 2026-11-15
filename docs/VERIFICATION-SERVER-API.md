# 验证服务器接口预留

当前已提供可调用的客户端及本地缓存，尚未部署服务器。地址默认为空，启动应用、浏览本地状态和保存地址不会发起网络请求。用户明确点击刷新或提交后才调用对应接口。现有 GitHub Issue 上报和本机确认分别保留。

## 地址与来源

独立配置文件：用户数据目录的 `verification-server-config.json`，仅保存 `baseURL`。支持用户填写的 HTTPS、HTTP、本机地址、路径前缀和查询参数。地址片段不发送到服务器；URL 中的用户名/密码不适用于 fetch 请求。接口路径追加到 pathname，已有查询参数在 GET 与 POST 中保留。清空地址即停用；更换地址会清除旧服务器缓存。

服务端缓存为 `verification-server-state.json`，本机确认仍使用独立的 `local-verifications.json`。每条服务器记录都有 `scope: "server"` 和 `serverURL`；本机确认使用 `scope: "local"`。两者不能互相覆盖。

匹配必须同时满足原始支持库 `modelId`、`providerVersion` 和功能 `id`。不得将一个型号的确认扩展到整个品牌，也不得将旧版本记录自动用于新版本。

## GET /v1/verifications

首次不传 `cursor`，返回当前完整快照。后续可带 `?cursor=<上次 nextCursor>`，返回自该游标以来发生变化的型号/版本完整记录。返回的每条记录替换同型号/版本的原记录，包括其中全部功能。需要撤销某项时返回 `unverified` 或 `disputed`，不要仅从增量响应省略它。

```json
{
  "records": [
    {
      "modelId": "logitech-g309",
      "providerVersion": "hidpp-0.1",
      "features": [
        { "id": "dpi", "status": "verified", "reports": 2 },
        { "id": "pollRate", "status": "reported", "reports": 1 }
      ],
      "updatedAt": "2026-11-12T01:00:00Z"
    }
  ],
  "nextCursor": "revision-42"
}
```

`nextCursor` 为字符串或 `null`。`null` 表示服务器未提供增量游标，下次客户端重新请求完整快照。本版本不使用分页，不在客户端强加记录数量、功能数量或游标长度上限。空增量 `records: []` 保留现有缓存；空完整快照清空缓存。刷新失败保留上次成功缓存及时间。

功能状态：`unverified` 待验证、`reported` 收到用户报告、`verified` 服务端已确认、`disputed` 有待解决的不同反馈。每项 `reports` 为非负整数。服务端负责状态判定与证据记录；客户端不根据报告数量擅自升级状态。

## POST /v1/reports

只有用户主动确认已实测并选择具体功能后提交。请求头为 `Content-Type: application/json` 与 `Idempotency-Key: <报告规范内容的 SHA-256>`。

```json
{
  "modelId": "logitech-g309",
  "providerVersion": "hidpp-0.1",
  "features": ["dpi", "pollRate"],
  "notes": "测试了调整和重连。",
  "hardwareConfirmed": true
}
```

必须有明确型号、版本、至少一项功能和 `hardwareConfirmed: true`，它表达用户此次报告确已实测的事实。功能 ID 去重、排序；版本和备注不设客户端长度上限。客户端只选择上述报告字段，不自动复制设备序列号、HID 路径或其他设备对象字段。用户自行填写的备注和排障路径原样保留，不经过关键字遮罩。

服务器应返回 HTTP 201 或 202：

```json
{
  "reportId": "report-123",
  "status": "received",
  "receivedAt": "2026-11-12T01:00:00Z"
}
```

`receivedAt` 可省略。收件成功仅表示报告已接收，不直接把功能标为已验证，也不改变本机确认。服务器必须按 `Idempotency-Key` 去重，相同报告返回同一个 `reportId`。客户端合并当前并发的同报告提交，但跨重启和网络重试的最终去重由服务器负责。

服务器按型号、版本和功能记录反馈，是否允许匿名由部署方接口决定；客户端没有强制人工审核步骤。当前未内置服务器账号或共用凭据。HTTP 非成功响应显示真实状态错误，失败后可重试；默认没有总超时，可以主动取消。正常 HTTP 重定向由 fetch 跟随，客户端不限制为固定站点。请求提交不会自动重试，跨网络重试的去重由服务器按 Idempotency-Key 完成。

## 桌面 API

- `verificationServerConfig()` → `{ baseURL, configured, lastRefresh, cursor, recordCount }`
- `saveVerificationServerConfig({ baseURL })` → 更新后的配置；不会联网。
- `refreshVerificationServer({ cursor? })` → `{ configured, updated, records, cursor, lastRefresh }`。省略参数沿用缓存游标；传 `cursor: null` 强制完整快照。地址为空时立即返回 `configured: false` 与空结果，不阻塞页面。
- `submitVerificationServerReport({ modelId, providerVersion, features, notes?, hardwareConfirmed: true })` → `{ reportId, status: "received", receivedAt, scope: "server", serverURL, modelId, providerVersion, features }`。
- `listServerVerifications()` → 已缓存记录数组，不联网。
- `cancelVerificationServerRequests()` → 取消当前刷新/提交请求；后续可重新调用。core 对应 `cancelRequests()`。

这些接口通过固定 IPC 调用，只有应用自己的主页面能够使用。测试使用替代网络函数，不部署服务器，不向真实地址提交测试报告。
