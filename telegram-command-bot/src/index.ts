import { config } from "dotenv";
import { createBot, startLongPolling } from "./bot.js";

// Load environment variables from .env file
config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const allowedUserId = process.env.ALLOWED_USER_ID;

if (!token) {
    console.error("Error: TELEGRAM_BOT_TOKEN environment variable is missing.");
    process.exit(1);
}

try {
    console.log("Initializing bot...");
    const bot = createBot(token, allowedUserId);
    startLongPolling(bot);
} catch (error) {
    console.error("Failed to start bot:", error);
    process.exit(1);
}
