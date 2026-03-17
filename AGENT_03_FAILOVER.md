# 多 Key 轮询与高可用机制深度剖析 (AGENT_03_FAILOVER)

本文档专门针对“**如何使用免费模型 API 时避免超额被封禁**”这一痛点，深度剖析 OpenClaw 的多 Key 轮询与故障转移（Failover）机制。

## 1. 需求场景回顾

您手头上有多个相同提供商的免费 API Key（例如 10 个 Google Gemini API Key）。由于免费 Key 的速率限制（Rate Limits，如 15 RPM, 250K TPM, 500 RPD），单点调用容易触发 `429 Too Many Requests`。您希望系统能够：
1. **自动负载均衡**：请求能分散在 10 个 Key 上。
2. **自动故障转移**：当某个 Key 遇到限流或超额错误时，自动切换到下一个 Key 继续处理请求，而不是直接返回错误给用户。
3. **冷却恢复**：触发错误的 Key 在冷却一段时间（比如直到次日额度恢复）后，重新回到可用池中。

## 2. OpenClaw 的原生解决方案

**好消息是：OpenClaw 已经完美原生支持了上述所有需求，您不需要修改任何底层代码，只需要进行正确的配置即可。**

### 2.1 怎么配置多 API Key？

OpenClaw 支持为一个提供商配置多个 Key，系统启动后会自动将这些 Key 记录为不同的 `Auth Profile`。

以 Gemini 为例，您可以在运行环境变量文件（如 `.env`）中这样配置：

```env
# 使用逗号分隔
GEMINI_API_KEYS="key1,key2,key3,key4,key5,key6,key7,key8,key9,key10"

# 或者按序号配置（推荐，更清晰）
GEMINI_API_KEY_1="key1"
GEMINI_API_KEY_2="key2"
...
GEMINI_API_KEY_10="key10"
```

只要启动 Gateway，OpenClaw 就会检测到这些 Key，并构建一个针对 `google` 提供商的 Auth Profile 列表。

### 2.2 核心代码剖析：如何实现轮询与冷却？

这一切的核心逻辑位于 `src/agents/auth-profiles/` 目录下。

#### 2.2.1 调度算法：轮询 (Round-Robin)
在 `src/agents/auth-profiles/order.ts` 中，`resolveAuthProfileOrder` 函数决定了下一次调用使用哪个 Key：

```typescript
// 节选自 order.ts: orderProfilesByMode
const scored = available.map((profileId) => {
  const type = store.profiles[profileId]?.type;
  // 类型偏好 (OAuth > Token > API Key)
  const typeScore = type === "oauth" ? 0 : type === "token" ? 1 : type === "api_key" ? 2 : 3;
  // 获取最后一次使用的时间戳
  const lastUsed = store.usageStats?.[profileId]?.lastUsed ?? 0;
  return { profileId, typeScore, lastUsed };
});

const sorted = scored
  .toSorted((a, b) => {
    if (a.typeScore !== b.typeScore) return a.typeScore - b.typeScore;
    // 根据 lastUsed 排序（最旧的最先使用），实现了在同类型 Profile 下的公平轮询
    return a.lastUsed - b.lastUsed;
  })
```
系统会提取所有可用的 Profile，并按 `lastUsed` 从小到大排序。这意味着**上一次最久未使用的 Key 会被优先选中**，完美实现了负载均衡。

#### 2.2.2 触发 429 时的故障转移 (Failover)
在 `src/agents/pi-embedded-runner/run.ts` 的主调用循环中：

```typescript
// 节选自 run.ts (runEmbeddedPiAgent)
if (shouldRotate) {
  // 如果遇到 429 或其他需要轮询的失败
  const reason = timedOut ? "timeout" : assistantProfileFailureReason;
  // 将当前 Key 标记为失效
  await maybeMarkAuthProfileFailure({ profileId: lastProfileId, reason });

  // 切换下一个 Key
  const rotated = await advanceAuthProfile();
  if (rotated) {
    // 成功切换，继续大循环重试本次请求 (continue)
    continue;
  }
}
```
这表明，一旦大模型返回 `rate_limit`（429 错误），系统会在记录失败后，**立即提取下一个 Key 重新发送同样的 Prompt**，对用户完全透明。

#### 2.2.3 指数退避的冷却期 (Cooldown)
当 `maybeMarkAuthProfileFailure` 被调用时，最终会执行 `src/agents/auth-profiles/usage.ts` 中的 `calculateAuthProfileCooldownMs`：

```typescript
export function calculateAuthProfileCooldownMs(errorCount: number): number {
  const normalized = Math.max(1, errorCount);
  return Math.min(
    60 * 60 * 1000, // 最大 1 小时
    60 * 1000 * 5 ** Math.min(normalized - 1, 3), // 1分钟, 5分钟, 25分钟, 125分钟(但被1小时截断)
  );
}
```
这意味着：
1. 第一次遇到 429，该 Key 会被禁用 **1 分钟**。
2. 冷却结束后如果再次失败，会被禁用 **5 分钟**。
3. 随后是 **25 分钟** 和 **1 小时**。

**注意针对 "额度耗尽 (Billing)" 的特殊处理**：
如果在日志中提供商返回的是“余额不足”(Insufficient credits)，OpenClaw 会判定为 `billing` 错误。此时惩罚更重：
```typescript
// 针对 billing 错误
const billingBackoffHours = 5; // 默认起步 5 小时
```
这几乎完美契合了您的“24小时重置”需求。如果一个 Key 真的每天额度用光了触发 Billing 报错，它会被直接雪藏数小时，直到明天才会重新尝试。

## 3. 会话粘滞 (Session Stickiness) 的提示

需要注意的是，OpenClaw 文档中提到了 **“会话粘滞” (Session stickiness)**：
> OpenClaw 会在整个 Session 内固定使用一个选中的 Profile（为了命中提供商的上下文缓存）。

也就是说，虽然有 10 个 Key，但在**同一个聊天上下文没有中断**的情况下，它会一直用第一个 Key。**但是**：
*   **一旦触发限额 (429)**：它会立刻丢弃粘滞，强制切换到下一个 Key。
*   **如果不想粘滞**：您可以通过在客户端（比如 Telegram）定期发送 `/new` 命令强制重置会话，这样下一次对话必定会重新进行 Round-Robin 选取一个新的闲置 Key。

## 4. 结论

**您无需改动任何一行代码！**
OpenClaw 已经为您量身定制了高可用的轮询框架：
1. 配置好 `XXX_API_KEYS` 环境变量（多配几个）。
2. 让其自然运行即可。即使触发免费限流，系统也会在微秒级内自动 Failover，将失败的 Key 送进冷却库，使用新鲜的 Key 接力您的聊天请求。