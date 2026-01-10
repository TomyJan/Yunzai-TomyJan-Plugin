# 第三方互联文档

本文档为第三方系统对接 MoeEDU 平台的技术说明，包含 API 规范、鉴权方式、接口定义和最佳实践。

## 1. 概述

### 1.1 基本信息

| 项目     | 说明                                        |
| -------- | ------------------------------------------- |
| 接口版本 | v2                                          |
| Base URL | `https://your-domain.com/api/v2/thirdParty` |
| 协议     | HTTPS                                       |
| 编码     | UTF-8                                       |
| 格式     | JSON                                        |

### 1.2 功能说明

第三方互联系统提供以下能力：

- **用户信息查询**：按 QQ 号查询用户状态及有效期
- **群成员同步**：上报 QQ 群成员列表，自动同步用户的入群状态
- **代理认证**：作为指定用户提交 WiFi 认证任务
- **任务查询**：查询认证任务执行状态

### 1.3 使用场景

典型应用场景：

1. **QQ 机器人**：用户在 QQ 群内发送 IP 地址，机器人自动提交认证
2. **群管理工具**：定期同步群成员列表，标记未加群用户
3. **自动化运维**：批量查询用户状态，生成报表

## 2. 鉴权规范

### 2.1 API Key 获取

第三方 API Key 由管理员在系统配置中设置，不同于用户个人的开发者 API Key。

**配置项**：

| 配置键                    | 说明            |
| ------------------------- | --------------- |
| `thirdParty.apiKey`       | 第三方 API 密钥 |
| `thirdParty.qq.groupLink` | QQ 群链接       |

> 联系系统管理员获取第三方 API Key。

### 2.2 签名算法

所有第三方 API 请求需携带签名信息，采用 **MD5 签名**验证。

**请求头**：

| Header       | 必填 | 说明                    |
| ------------ | ---- | ----------------------- |
| `X-Moe-Time` | 是   | 请求时间戳（Unix 秒级） |
| `X-Moe-Sign` | 是   | 请求签名                |

**签名生成算法**：

```
sign = MD5(apiKey + "|" + timestamp)
```

**示例（JavaScript）**：

```javascript
const crypto = require('crypto')

function generateSign(apiKey, timestamp) {
  const raw = `${apiKey}|${timestamp}`
  return crypto.createHash('md5').update(raw).digest('hex')
}

// 使用示例
const apiKey = 'your-third-party-api-key'
const timestamp = Math.floor(Date.now() / 1000)
const sign = generateSign(apiKey, timestamp)

// 请求头
const headers = {
  'Content-Type': 'application/json',
  'X-Moe-Time': timestamp.toString(),
  'X-Moe-Sign': sign,
}
```

**示例（Python）**：

```python
import hashlib
import time
import requests

def generate_sign(api_key: str, timestamp: int) -> str:
    raw = f"{api_key}|{timestamp}"
    return hashlib.md5(raw.encode()).hexdigest()

# 使用示例
api_key = "your-third-party-api-key"
timestamp = int(time.time())
sign = generate_sign(api_key, timestamp)

headers = {
    "Content-Type": "application/json",
    "X-Moe-Time": str(timestamp),
    "X-Moe-Sign": sign
}

response = requests.post(
    "https://your-domain.com/api/v2/thirdParty/user/listByQQ",
    headers=headers,
    json={}
)
```

### 2.3 时间戳校验

- 时间戳有效窗口：**±5 分钟**
- 超出时间窗口的请求将返回 `401` 错误

### 2.4 错误响应

鉴权失败时返回：

```json
{
  "code": 401,
  "message": "签名验证失败",
  "data": null
}
```

常见鉴权错误：

| code | message          | 原因               |
| ---- | ---------------- | ------------------ |
| 401  | 缺少签名参数     | 未携带必需的请求头 |
| 401  | 签名验证失败     | API Key 或签名错误 |
| 401  | 请求时间戳已过期 | 时间戳超出有效窗口 |
| 403  | 第三方接口未启用 | 系统未配置 API Key |

## 3. 通用规范

### 3.1 请求格式

- **HTTP 方法**：统一使用 `POST`
- **Content-Type**：`application/json`
- **请求体**：JSON 格式

### 3.2 响应格式

所有接口统一返回 HTTP 200，通过 `code` 字段区分业务状态：

```json
{
  "code": 0,
  "message": "success",
  "data": { ... }
}
```

### 3.3 业务错误码

| code | 说明           |
| ---- | -------------- |
| 0    | 成功           |
| 400  | 参数错误       |
| 401  | 鉴权失败       |
| 403  | 无权限         |
| 404  | 资源不存在     |
| 500  | 服务器内部错误 |

### 3.4 字段命名

所有请求/响应字段采用**小驼峰**命名法：

```json
{
  "userId": "uuid",
  "expireAt": "2025-12-31T23:59:59.000Z",
  "isInQQGroup": true
}
```

## 4. 接口列表

| 接口                             | 说明                     |
| -------------------------------- | ------------------------ |
| `POST /user/listByQQ`            | 按 QQ 号批量查询用户信息 |
| `POST /user/reportQQGroupMember` | 上报 QQ 群成员列表       |
| `POST /wifi/submitAsUser`        | 作为指定用户提交认证任务 |
| `POST /wifi/check`               | 查询认证任务状态         |

## 5. 接口详情

### 5.1 POST /user/listByQQ

按 QQ 号批量查询用户信息。

**请求体**：

```json
{
  "qqList": ["123456789", "987654321"]
}
```

| 字段   | 类型     | 必填 | 说明                                  |
| ------ | -------- | ---- | ------------------------------------- |
| qqList | string[] | 否   | QQ 号列表，为空则返回所有有 QQ 的用户 |

**响应**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": {
      "123456789": {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "status": "active",
        "expireAt": "2025-12-31T23:59:59.000Z",
        "graceUsed": 0,
        "isInQQGroup": true,
        "role": {
          "graceDays": 1,
          "graceAuthCount": 3
        }
      },
      "987654321": {
        "id": "550e8400-e29b-41d4-a716-446655440001",
        "status": "banned",
        "expireAt": "2025-06-30T23:59:59.000Z",
        "graceUsed": 2,
        "isInQQGroup": false,
        "role": {
          "graceDays": 1,
          "graceAuthCount": 3
        }
      }
    },
    "unkQQUser": 15
  }
}
```

**响应字段说明**：

| 字段                          | 类型    | 说明                                       |
| ----------------------------- | ------- | ------------------------------------------ |
| items                         | object  | 以 QQ 号为 key 的用户信息映射              |
| items[qq].id                  | string  | 用户 UUID                                  |
| items[qq].status              | string  | 用户状态：`pending`/`active`/`banned`      |
| items[qq].expireAt            | string  | 有效期，ISO 8601 格式，`null` 表示永久有效 |
| items[qq].graceUsed           | number  | 已使用的宽限认证次数                       |
| items[qq].isInQQGroup         | boolean | 是否在通知群中                             |
| items[qq].role                | object  | 用户角色权益信息                           |
| items[qq].role.graceDays      | number  | 宽限期天数                                 |
| items[qq].role.graceAuthCount | number  | 宽限期可认证次数                           |
| unkQQUser                     | number  | 未填写 QQ 的用户数量                       |

**说明**：

- 若 `qqList` 为空数组或不传，返回系统中所有已填写 QQ 的用户
- 不存在的 QQ 号不会出现在 `items` 中
- `unkQQUser` 统计的是资料未完善（未填写 QQ）的用户数量

---

### 5.2 POST /user/reportQQGroupMember

上报 QQ 群成员列表，异步更新用户的入群状态。

**请求体**：

```json
{
  "qqList": ["123456789", "987654321", "111222333"]
}
```

| 字段   | 类型     | 必填 | 说明                |
| ------ | -------- | ---- | ------------------- |
| qqList | string[] | 是   | QQ 群成员 QQ 号列表 |

**响应**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "accepted": true,
    "memberCount": 150
  }
}
```

| 字段        | 类型    | 说明               |
| ----------- | ------- | ------------------ |
| accepted    | boolean | 请求是否被接受处理 |
| memberCount | number  | 上报的群成员数量   |

**处理逻辑**：

1. 接口立即返回，后台异步处理
2. 在上报列表中的用户：`isInQQGroup` 设为 `true`
3. 不在上报列表中的用户：`isInQQGroup` 设为 `false`
4. 系统中不存在的 QQ 号将被忽略

**建议调用频率**：每 10-30 分钟同步一次

---

### 5.3 POST /wifi/submitAsUser

作为指定用户提交 WiFi 认证任务。

**请求体**：

```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "authIp": "10.0.1.123"
}
```

| 字段   | 类型   | 必填 | 说明                   |
| ------ | ------ | ---- | ---------------------- |
| userId | string | 是   | 目标用户 UUID          |
| authIp | string | 是   | 待认证的客户端 IP 地址 |

**响应**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "taskId": "660e8400-e29b-41d4-a716-446655440000",
    "taskCode": 1,
    "status": "queued",
    "position": 3
  }
}
```

**响应字段说明**：

| 字段            | 类型    | 说明                                            |
| --------------- | ------- | ----------------------------------------------- |
| taskId          | string  | 任务 UUID                                       |
| taskCode        | number  | 任务状态码（见状态码表）                        |
| status          | string  | 任务状态：`queued`/`running`/`success`/`failed` |
| message         | string  | 提示信息（可选）                                |
| isExisting      | boolean | 是否为已存在的任务（可选，IP 重复提交时）       |
| position        | number  | 队列位置（可选，仅 queued 状态）                |
| queuedTimeMs    | number  | 排队时长（毫秒，可选）                          |
| executionTimeMs | number  | 执行时长（毫秒，可选）                          |

**任务状态码**：

| taskCode | 说明                  |
| -------- | --------------------- |
| 0        | 认证成功              |
| 1        | 排队中                |
| 2        | 认证中                |
| 10       | IP 格式错误           |
| 11       | IP 段不支持           |
| 20       | 认证失败-暂无可用端点 |
| 21       | 认证失败-已达尝试上限 |
| 22       | 认证失败-参数不匹配   |
| 23       | 认证失败-任务超时     |
| 24       | 系统错误              |

**业务校验**：

- 用户状态必须为 `active`
- 用户已过期且已用尽宽限次数时将返回 `403`
- 用户资料未完善（未设置用户名/昵称/QQ）时返回 `403`
- 用户已达当日/当月认证次数上限时返回 `403`

**错误响应示例**：

```json
{
  "code": 403,
  "message": "用户已过期且已用尽宽限次数",
  "data": null
}
```

```json
{
  "code": 404,
  "message": "用户不存在",
  "data": null
}
```

---

### 5.4 POST /wifi/check

查询认证任务状态。

**请求体**：

```json
{
  "taskId": "660e8400-e29b-41d4-a716-446655440000"
}
```

| 字段   | 类型   | 必填 | 说明      |
| ------ | ------ | ---- | --------- |
| taskId | string | 是   | 任务 UUID |

**响应**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "taskId": "660e8400-e29b-41d4-a716-446655440000",
    "taskCode": 0,
    "status": "success",
    "attempts": 3,
    "provider": "中国电信",
    "queuedTimeMs": 1234,
    "executionTimeMs": 5678
  }
}
```

**响应字段说明**：

| 字段            | 类型   | 说明                                     |
| --------------- | ------ | ---------------------------------------- |
| taskId          | string | 任务 UUID                                |
| taskCode        | number | 任务状态码                               |
| status          | string | 任务状态                                 |
| position        | number | 队列位置（可选，仅 queued 状态）         |
| attempts        | number | 当前尝试次数（可选，running 及之后状态） |
| provider        | string | 认证服务提供者（可选，仅 success 状态）  |
| queuedTimeMs    | number | 排队时长（毫秒，任务开始执行后返回）     |
| executionTimeMs | number | 执行时长（毫秒，任务完成后返回）         |

## 6. 最佳实践

### 6.1 认证任务轮询

提交认证任务后，建议采用以下轮询策略：

```javascript
async function waitForAuthResult(taskId) {
  const maxPolls = 60 // 最多轮询 60 次
  const pollInterval = 2000 // 2 秒轮询一次

  for (let i = 0; i < maxPolls; i++) {
    const result = await checkTask(taskId)

    if (result.status === 'success') {
      return { success: true, message: '认证成功' }
    }

    if (result.status === 'failed') {
      return { success: false, message: getErrorMessage(result.taskCode) }
    }

    // queued 或 running 状态，继续轮询
    await sleep(pollInterval)
  }

  return { success: false, message: '认证超时' }
}
```

### 6.2 群成员同步

建议的同步策略：

1. **定时全量同步**：每 30 分钟获取完整群成员列表并上报
2. **增量事件处理**：监听入群/退群事件，实时调用接口

```python
import schedule
import time

def sync_group_members():
    """获取群成员列表并上报"""
    members = get_group_member_list(group_id)
    qq_list = [m['qq'] for m in members]

    response = report_qq_group_members(qq_list)
    print(f"同步完成，共 {response['data']['memberCount']} 人")

# 每 30 分钟同步一次
schedule.every(30).minutes.do(sync_group_members)

while True:
    schedule.run_pending()
    time.sleep(1)
```

### 6.3 错误重试

网络异常时的重试策略：

```javascript
async function requestWithRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (error) {
      if (i === maxRetries - 1) throw error

      // 指数退避
      const delay = Math.pow(2, i) * 1000
      await sleep(delay)
    }
  }
}
```

### 6.4 并发限制

请遵守以下限制以保证服务稳定：

| 限制项         | 值     |
| -------------- | ------ |
| 单接口 QPS     | 10     |
| 并发认证任务数 | 5      |
| 群成员同步频率 | 2/分钟 |

## 7. 常见问题

### Q: 如何获取用户 ID？

调用 `/user/listByQQ` 接口，传入用户的 QQ 号即可获取对应的用户 ID。

### Q: 认证任务一般需要多久？

- 排队时间：取决于当前队列长度，通常 0-30 秒
- 执行时间：单次尝试约 3-8 秒，最多尝试 24 次
- 总体时间：通常 5-60 秒完成

### Q: 用户过期后还能认证吗？

用户过期后进入宽限期，在宽限期内仍可使用有限次数的认证。具体次数由用户角色决定（通常为 3 次），用尽后需续期。

### Q: 如何判断用户能否认证？

检查以下条件：

1. `status` 为 `active`
2. `expireAt` 未过期，或在宽限期内（`graceUsed < role.graceAuthCount`）

## 8. 更新记录

| 版本 | 日期       | 说明                                         |
| ---- | ---------- | -------------------------------------------- |
| 1.0  | 2025-01-07 | 初始版本，包含用户查询、群同步、代理认证功能 |
