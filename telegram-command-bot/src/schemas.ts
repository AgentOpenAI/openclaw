import { z } from "zod";

export const FileActionSchema = z.object({
    action: z.enum(["read", "write", "delete"]),
    filepath: z.string().describe("The path to the file"),
    content: z.string().optional().describe("Content to write (only for 'write' action)")
});

export type FileActionPayload = z.infer<typeof FileActionSchema>;

export const BrowserActionSchema = z.object({
    action: z.enum(["goto", "title", "content"]),
    url: z.string().url().optional().describe("URL to navigate to (required for 'goto')"),
});

export type BrowserActionPayload = z.infer<typeof BrowserActionSchema>;
