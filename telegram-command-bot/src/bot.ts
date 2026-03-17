import { Bot, Context, session, SessionFlavor } from "grammy";
import { run } from "@grammyjs/runner";
import { handleFileAction } from "./actions/file.js";
import { handleBrowserAction } from "./actions/browser.js";
import { FileActionSchema, BrowserActionSchema } from "./schemas.js";

// Session data to remember what command the user is currently filling out
interface SessionData {
  pendingCommand: "file" | "browser" | null;
}
type MyContext = Context & SessionFlavor<SessionData>;

export function createBot(token: string, allowedUserId?: string) {
    const bot = new Bot<MyContext>(token);

    // Install session middleware
    bot.use(session({ initial: (): SessionData => ({ pendingCommand: null }) }));

    // Security: Only allow specific user if configured
    bot.use(async (ctx, next) => {
        if (allowedUserId && ctx.from?.id.toString() !== allowedUserId) {
            console.log(`Unauthorized access attempt from: ${ctx.from?.id}`);
            return;
        }
        await next();
    });

    bot.command("start", async (ctx) => {
        await ctx.reply(
            "Welcome! I am your local command bot.\n\n" +
            "Available commands:\n" +
            "/file - Perform file operations\n" +
            "/browser - Perform browser operations\n\n" +
            "Send a command to get the JSON template."
        );
    });

    bot.command("file", async (ctx) => {
        ctx.session.pendingCommand = "file";
        const template = {
            action: "read | write | delete",
            filepath: "/path/to/your/file.txt",
            content: "Your content here (only if action is write)"
        };
        await ctx.reply(
            "Please copy, fill out, and send back the following JSON:\n\n" +
            "```json\n" + JSON.stringify(template, null, 2) + "\n```",
            { parse_mode: "MarkdownV2" }
        );
    });

    bot.command("browser", async (ctx) => {
        ctx.session.pendingCommand = "browser";
        const template = {
            action: "goto | title | content",
            url: "https://example.com (only needed for goto)"
        };
        await ctx.reply(
            "Please copy, fill out, and send back the following JSON:\n\n" +
            "```json\n" + JSON.stringify(template, null, 2) + "\n```",
            { parse_mode: "MarkdownV2" }
        );
    });

    bot.command("cancel", async (ctx) => {
        ctx.session.pendingCommand = null;
        await ctx.reply("Canceled any pending commands.");
    });

    bot.on("message:text", async (ctx) => {
        const text = ctx.message.text;
        const pendingCommand = ctx.session.pendingCommand;

        if (!pendingCommand) {
            await ctx.reply("I don't expect any JSON right now. Please send a command like /file or /browser first.");
            return;
        }

        try {
            const parsedJson = JSON.parse(text);

            if (pendingCommand === "file") {
                const payload = FileActionSchema.parse(parsedJson);
                await ctx.reply("Executing file action...");
                const result = await handleFileAction(payload);
                await ctx.reply(`Result:\n${result}`);
            } else if (pendingCommand === "browser") {
                const payload = BrowserActionSchema.parse(parsedJson);
                await ctx.reply("Executing browser action...");
                const result = await handleBrowserAction(payload);
                await ctx.reply(`Result:\n${result}`);
            }

            // Reset state after successful execution
            ctx.session.pendingCommand = null;

        } catch (error: any) {
            if (error instanceof SyntaxError) {
                await ctx.reply("Invalid JSON format. Please check your syntax.");
            } else if (error.name === 'ZodError') {
                await ctx.reply(`Validation Error:\n${JSON.stringify(error.errors, null, 2)}`);
            } else {
                await ctx.reply(`Execution Error: ${error.message}`);
            }
        }
    });

    return bot;
}

export function startLongPolling(bot: Bot<MyContext>) {
    const runner = run(bot);
    console.log("Bot is running in long-polling mode (no webhook needed)!");

    // Graceful stop
    const stopRunner = () => runner.isRunning() && runner.stop();
    process.once("SIGINT", stopRunner);
    process.once("SIGTERM", stopRunner);
}
