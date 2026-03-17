import { FileActionPayload } from "../schemas.js";
import fs from "fs/promises";
import path from "path";

export async function handleFileAction(payload: FileActionPayload): Promise<string> {
    const resolvedPath = path.resolve(payload.filepath);

    switch (payload.action) {
        case "read":
            try {
                const content = await fs.readFile(resolvedPath, "utf-8");
                return `File content (first 1000 chars):\n${content.substring(0, 1000)}`;
            } catch (err: any) {
                return `Failed to read file: ${err.message}`;
            }

        case "write":
            if (payload.content === undefined) {
                throw new Error("Content must be provided for 'write' action");
            }
            try {
                await fs.writeFile(resolvedPath, payload.content, "utf-8");
                return `Successfully wrote to ${resolvedPath}`;
            } catch (err: any) {
                return `Failed to write file: ${err.message}`;
            }

        case "delete":
            try {
                await fs.unlink(resolvedPath);
                return `Successfully deleted ${resolvedPath}`;
            } catch (err: any) {
                 return `Failed to delete file: ${err.message}`;
            }

        default:
            throw new Error(`Unsupported action: ${payload.action}`);
    }
}
