# Telegram Bot 插件通信机制深度解析 (AGENT_05_TELEGRAM_POLLING)

本文档专注于解答“**在没有公网 IP 的家庭网络环境下，OpenClaw 是如何通过 Telegram 接收消息并处理任务的**”。这对于想要脱离 OpenClaw 框架、自己开发类似的 Telegram Bot 非常有参考价值。

## 1. 核心问题：无公网 IP 如何接收外网消息？

通常，服务端接收外部消息有两种主流方式：
1. **Webhook (推模式)**：Telegram 服务器主动向你配置的一个公网 HTTPS 地址发送 HTTP POST 请求。这**必须要求**你的服务器具有公网 IP 或使用了内网穿透（如 Ngrok/Cloudflare Tunnels）。
2. **长轮询 (Long Polling / 拉模式)**：你的本地服务器主动向 Telegram API 发起长连接请求（`getUpdates`）。如果没有新消息，Telegram 会在服务器端挂起这个连接几十秒（Timeout）；如果有新消息，Telegram 立即返回数据。这就和你在家里用浏览器上网一样，是**本地主动发起的出站请求 (Outbound)**，所以**完全不需要公网 IP**，也不需要内网穿透。

OpenClaw 的 Telegram 插件正是默认使用了 **Long Polling** 模式。

## 2. 架构与依赖：利用 `grammY` 库

OpenClaw 内部没有从头实现繁琐的 Telegram HTTP API 交互，而是深度依赖了 Node.js 生态中非常优秀的开源库：**`grammY`**。

在 `src/telegram/bot.ts` 和 `src/telegram/polling-session.ts` 中，可以看到 OpenClaw 使用了 `@grammyjs/runner` 的 `run` 方法来启动高并发的长轮询。

### 脱离框架的最小实现参考

如果你想自己用 TypeScript/Node.js 写一个类似的东西，核心代码其实非常简单：

```typescript
import { Bot } from "grammy";
import { run } from "@grammyjs/runner";

// 1. 使用你从 BotFather 获取的 Token 实例化 Bot
const bot = new Bot("YOUR_TELEGRAM_BOT_TOKEN");

// 2. 监听消息事件
bot.on("message", async (ctx) => {
    const chatId = ctx.message.chat.id;
    const text = ctx.message.text;

    console.log(`收到来自 ${chatId} 的消息: ${text}`);

    // 3. 处理任务并回复
    await ctx.reply(`我收到了你的消息: ${text}`);
});

// 4. 启动长轮询 (Runner 会自动处理高并发和连接异常)
run(bot);
console.log("Bot 正在通过长轮询接收消息...");
```

只要你在这个 Node.js 程序运行的电脑上能连上外网（且能访问 Telegram API 服务器），它就能源源不断地拉取你发给机器人的消息。

## 3. OpenClaw 的进阶实现：可靠性与并发控制

虽然基于 `grammY` 的轮询很简单，但 OpenClaw 作为一个工业级的 Gateway，在轮询的基础上加了大量的加固逻辑，这也正是它的精髓所在。

### 3.1 `update_id` 持久化防丢与防重

Telegram 的长轮询通过 `update_id` 来标记读取进度。如果程序崩溃重启，如果没有记住 `update_id`，可能会重新处理一遍老消息。
在 `src/telegram/polling-session.ts` 中：
*   OpenClaw 会记录 `highestCompletedUpdateId` 并写入本地存储 (`update-offset-store.ts`)。
*   重启时，先读取上次的 `lastUpdateId`，在发起 `getUpdates` 请求时告诉 Telegram 从哪里开始拉取。
*   结合 `src/telegram/bot-updates.ts` 中的 LRU Cache，拦截因网络抖动导致的重复事件。

### 3.2 错误自愈与指数退避轮询循环

由于家庭网络可能断网，或者 Telegram 服务器可能闪断，直接用 `run(bot)` 挂掉程序是很危险的。
OpenClaw 在 `TelegramPollingSession` 类中包装了一层 `while(true)` 循环：

```typescript
async runUntilAbort(): Promise<void> {
    while (!this.opts.abortSignal?.aborted) {
      const bot = await this.#createPollingBot();
      // ...
      const state = await this.#runPollingCycle(bot);
      if (state === "exit") return;
    }
}
```
如果网络异常导致 `runner` 停止，它会触发 `computeBackoff(TELEGRAM_POLL_RESTART_POLICY, attempts)`，使用指数退避算法（2秒、4秒、最大 30 秒）自动重试，确保网络恢复后机器人能立刻上线。

### 3.3 消息去抖 (Debounce) 与分片粘合

在 `src/telegram/bot-handlers.ts` 中，OpenClaw 并没有收到消息就立刻扔给大模型。因为人们习惯将长长的一段话拆成几条短消息发送（或者发几张图片）。
*   使用了 `createInboundDebouncer`。
*   如果一个人在几秒钟内连续发了 3 条消息，OpenClaw 会将它们在内存中**合并 (Combine)** 成一条虚拟消息 (`syntheticMessage`)，然后再推给 `Session Lane`。这样可以节省大模型的调用次数，并给大模型提供完整的上下文。

### 3.4 路由到内部队列 (Session Lane)

当 `bot.on("message")` 接收并整合完消息后，核心的一步是把消息抛进 `Session Lane`，如我们在 `AGENT_02_CORE` 中分析的那样。
这通过 `processInboundMessage` 最终调用大一统的消息分发接口：将 Telegram 特有的 `ctx.message` 转换为 OpenClaw 内部标准化的 `InboundEnvelope`。大模型运行在一个独立的工作队列中串行消费这些事件，互不阻塞。

## 4. 总结与建议

如果您要自己脱离 OpenClaw 建立一个没有公网 IP 限制的 Telegram AI Bot：

1. **核心技术栈**：选择 Node.js 和 **`grammY`** 库（配合 `@grammyjs/runner`）。
2. **工作模式**：必须使用且仅使用 **长轮询 (Long Polling)** 模式（切勿调用 `setWebhook` API）。
3. **架构参考点**：
    *   一定要捕获全局的 Network Error 进行重连。
    *   强烈建议实现一个**队列 (Queue)**，接收到消息存入队列，用单独的异步 Worker（哪怕是个死循环）去调用 OpenAI/Gemini API，这样能避免同时回复多条消息时弄乱 AI 的上下文记忆。
    *   如果有条件，实现消息的合并去抖（Debounce），体验会大幅提升。