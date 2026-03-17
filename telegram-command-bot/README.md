# Telegram Command Bot

A robust, self-hosted Telegram bot running on local/home networks via Long Polling.
It interprets predefined commands, asks for JSON parameters, and executes local system tasks (file operations, browser automation).

## Setup
1. Use Node.js >= 18
2. `npm install`
3. If using browser actions, you may need to install playwright browsers: `npx playwright install chromium`
4. Create a `.env` file based on `.env.example`
5. Add your `TELEGRAM_BOT_TOKEN` (You can get it from [@BotFather](https://t.me/BotFather) on Telegram)
6. Run `npm start`

## How it works
This bot utilizes long-polling (`@grammyjs/runner`). It initiates an outbound connection from your computer to Telegram's API server. This completely bypasses NAT and firewall restrictions, meaning you **do not need** a public IP, Ngrok, or port forwarding.
