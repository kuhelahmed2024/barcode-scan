import os from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function getLanIp() {
    const interfaces = os.networkInterfaces();

    for (const entries of Object.values(interfaces)) {
        for (const entry of entries ?? []) {
            if (entry.family === "IPv4" && !entry.internal) {
                return entry.address;
            }
        }
    }

    return null;
}

function getArgValue(args, ...flags) {
    for (let index = 0; index < args.length; index += 1) {
        if (flags.includes(args[index])) {
            return args[index + 1] ?? null;
        }
    }

    return null;
}

const forwardedArgs = process.argv.slice(2);
const hasHostnameArg = forwardedArgs.includes("--hostname") || forwardedArgs.includes("-H");
const hasHttpsArg = forwardedArgs.includes("--experimental-https");
const host = process.env.NEXT_DEV_HOST || getLanIp() || "127.0.0.1";
const port = getArgValue(forwardedArgs, "--port", "-p") || process.env.PORT || "3000";
const selectedHost = getArgValue(forwardedArgs, "--hostname", "-H") || host;
const nextBin = require.resolve("next/dist/bin/next");

const args = [
    nextBin,
    "dev",
    ...(hasHttpsArg ? [] : ["--experimental-https"]),
    ...(hasHostnameArg ? [] : ["--hostname", host]),
    ...forwardedArgs,
];

console.log(`Starting Next.js dev with HTTPS for camera testing on https://${selectedHost}:${port}`);
console.log("If your phone still blocks the camera, trust the mkcert root CA on that device or use an HTTPS tunnel.");

const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    stdio: "inherit",
});

child.on("exit", (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }

    process.exit(code ?? 0);
});
