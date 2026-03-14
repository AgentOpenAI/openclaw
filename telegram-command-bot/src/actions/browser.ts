import { BrowserActionPayload } from "../schemas.js";
import { chromium, Browser, Page } from "playwright-core";

let browser: Browser | null = null;
let page: Page | null = null;

async function getPage(): Promise<Page> {
    if (!browser) {
        // NOTE: For playwright-core to work, you need a local browser installed.
        // It's usually easier to use 'playwright' package which downloads browsers automatically,
        // but since we used playwright-core, we might need to specify executablePath if not found.
        // Assuming user has chromium installed or switches to standard 'playwright' package.
        // For simplicity in this demo, we'll try launching it directly.
        try {
           browser = await chromium.launch({ headless: true });
        } catch(e) {
           throw new Error("Failed to launch chromium. Ensure a chromium binary is available or use 'playwright' instead of 'playwright-core' in package.json");
        }
    }
    if (!page) {
        page = await browser.newPage();
    }
    return page;
}

export async function handleBrowserAction(payload: BrowserActionPayload): Promise<string> {
    switch (payload.action) {
        case "goto":
            if (!payload.url) {
                throw new Error("URL must be provided for 'goto' action");
            }
            try {
                const p = await getPage();
                await p.goto(payload.url, { waitUntil: "domcontentloaded" });
                return `Successfully navigated to ${payload.url}`;
            } catch (err: any) {
                return `Navigation failed: ${err.message}`;
            }

        case "title":
            if (!page) return "No page is currently open. Use 'goto' first.";
            return `Current Page Title: ${await page.title()}`;

        case "content":
            if (!page) return "No page is currently open. Use 'goto' first.";
            const text = await page.evaluate(() => document.body.innerText);
            return `Page Text (first 1000 chars):\n${text.substring(0, 1000)}`;

        default:
            throw new Error(`Unsupported action: ${payload.action}`);
    }
}
