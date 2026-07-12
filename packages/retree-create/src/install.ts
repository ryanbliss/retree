import { spawn } from "node:child_process";
import { formatPlannedCommand, PlannedCommand } from "./plan.js";

export type CommandRunner = (
    plannedCommand: PlannedCommand,
    cwd: string
) => Promise<void>;

export const runCommand: CommandRunner = (plannedCommand, cwd) => {
    const printableCommand = formatPlannedCommand(plannedCommand);
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(plannedCommand.command, plannedCommand.args, {
            cwd,
            stdio: "inherit",
            shell: process.platform === "win32",
        });
        child.on("error", (error) => {
            rejectPromise(
                new Error(
                    `${printableCommand}: failed to start in ${cwd}: ${error.message}`
                )
            );
        });
        child.on("close", (status, signal) => {
            if (signal !== null) {
                rejectPromise(
                    new Error(
                        `${printableCommand}: exited with signal ${signal}.`
                    )
                );
                return;
            }
            if (status !== 0) {
                rejectPromise(
                    new Error(
                        `${printableCommand}: exited with status ${String(
                            status
                        )}.`
                    )
                );
                return;
            }
            resolvePromise();
        });
    });
};
