import { pathToFileURL } from "node:url";
import { parseCompareArgs, renderBenchmarkComparison } from "./compare";
import { parseCliArgs, renderHelp, resolveBenchmarkConfig } from "./config";
import { createInquirerPromptAdapter } from "./prompts";
import { BenchmarkStoppedError, estimateBenchmarkWork } from "./benchmarks";
import {
    CONTROL_BUFFER_LENGTH,
    CONTROL_PAUSED_INDEX,
    CONTROL_STEP_INDEX,
    CONTROL_STOPPED_INDEX,
    runBenchmarksInParallelWithProgress,
} from "./parallel";
import { renderConsoleSummaryReport, writeBenchmarkArtifacts } from "./report";
import {
    BenchmarkProgressEvent,
    BenchmarkProgressTask,
    BenchmarkProgressTaskStatus,
} from "./types";

export async function main(argv = process.argv.slice(2)) {
    if (argv.includes("compare") || argv.includes("--compare")) {
        console.log(await renderBenchmarkComparison(parseCompareArgs(argv)));
        return;
    }

    const parsed = parseCliArgs(argv);
    if (parsed.help) {
        console.log(renderHelp());
        return;
    }

    const config = await resolveBenchmarkConfig(parsed, {
        isTTY: process.stdin.isTTY,
        promptAdapter: createInquirerPromptAdapter(),
    });
    const workEstimate = estimateBenchmarkWork(config);
    const controlBuffer = new SharedArrayBuffer(
        Int32Array.BYTES_PER_ELEMENT * CONTROL_BUFFER_LENGTH
    );
    const progressController = createProgressController(controlBuffer);

    process.stderr.write(
        `${colorize("Planned:", "bold", "cyan")} ${formatInteger(
            workEstimate.totalOperations
        )} operations, ${formatInteger(
            workEstimate.totalCases
        )} cases, ${formatInteger(
            workEstimate.totalPhases
        )} phases, ${formatInteger(
            workEstimate.totalSkippedCases
        )} skipped, ${formatWorkerPlan(config.parallelWorkers)} workers.\n`
    );

    let results;
    try {
        results = await runBenchmarksInParallelWithProgress(config, {
            controlBuffer,
            onProgress: progressController.onProgress,
            workerUrl: new URL("./scenario-worker.js", import.meta.url),
        });
    } catch (error: unknown) {
        progressController.finish();
        if (error instanceof BenchmarkStoppedError) {
            console.error("Benchmark stopped before completion.");
            process.exitCode = 130;
            return;
        }
        throw error;
    } finally {
        progressController.dispose();
    }

    progressController.finish();
    const artifacts = await writeBenchmarkArtifacts(results, config.outputDir, {
        nameSuffix: config.nameSuffix,
        overwrite: config.overwriteArtifacts,
    });
    console.log(renderConsoleSummaryReport(artifacts, results));
}

if (isDirectExecution()) {
    main().catch((error: unknown) => {
        if (error instanceof Error) {
            console.error(error.message);
        } else {
            console.error(String(error));
        }
        process.exitCode = 1;
    });
}

function isDirectExecution() {
    const entrypoint = process.argv[1];
    if (entrypoint === undefined) {
        return false;
    }
    return import.meta.url === pathToFileURL(entrypoint).href;
}

function createProgressController(controlBuffer: SharedArrayBuffer) {
    let lastProgress: BenchmarkProgressEvent | null = null;
    let paused = false;
    let renderedLineCount = 0;
    let renderTimer: ReturnType<typeof setTimeout> | undefined;
    let lastRenderAt = 0;
    let stopped = false;
    const control = new Int32Array(controlBuffer);
    const canUseKeyboard =
        process.stdin.isTTY && typeof process.stdin.setRawMode === "function";
    const canRenderInline = process.stderr.isTTY;

    const wakeWorkers = () => {
        Atomics.notify(control, CONTROL_PAUSED_INDEX);
    };

    const render = (options: { force?: boolean } = {}) => {
        if (!canRenderInline) {
            return;
        }
        if (lastProgress === null) {
            return;
        }
        if (options.force === true) {
            clearPendingRender();
            renderNow();
            return;
        }

        const elapsedMs = Date.now() - lastRenderAt;
        if (elapsedMs >= PROGRESS_RENDER_INTERVAL_MS) {
            renderNow();
            return;
        }

        if (renderTimer !== undefined) {
            return;
        }

        renderTimer = setTimeout(() => {
            renderTimer = undefined;
            renderNow();
        }, PROGRESS_RENDER_INTERVAL_MS - elapsedMs);
    };

    const renderNow = () => {
        const progress = lastProgress;
        if (progress === null) {
            return;
        }

        let status = "running";
        if (paused) {
            status = "paused";
        }
        if (stopped) {
            status = "stopping";
        }
        const percentage = progress.operationIndex / progress.totalOperations;
        let statusColor: ConsoleStyle = "green";
        if (paused) {
            statusColor = "yellow";
        }
        if (stopped) {
            statusColor = "red";
        }
        const progressLineText = [
            colorize(status.toUpperCase(), "bold", statusColor),
            renderProgressBar(percentage, statusColor),
            colorize(formatPercent(percentage), "bold", statusColor),
            renderAggregateProgressDetails(progress),
        ].join("  ");
        const operationLines = renderOperationLines(progress);
        const shortcutsLine = renderShortcutLine(paused);
        const lines = [progressLineText, ...operationLines, shortcutsLine];

        renderFixedLineBlock(lines);
        lastRenderAt = Date.now();
    };

    const onData = (chunk: Buffer | string) => {
        const input = chunk.toString();
        if (input === "\u0003") {
            stopped = true;
            Atomics.store(control, CONTROL_STOPPED_INDEX, 1);
            wakeWorkers();
            render({ force: true });
            return;
        }
        if (input.toLowerCase() === "x") {
            stopped = true;
            Atomics.store(control, CONTROL_STOPPED_INDEX, 1);
            wakeWorkers();
            render({ force: true });
            return;
        }
        if (input.toLowerCase() === "p") {
            paused = !paused;
            Atomics.store(control, CONTROL_PAUSED_INDEX, paused ? 1 : 0);
            wakeWorkers();
            render({ force: true });
            return;
        }
        if (input === " " && paused) {
            Atomics.add(control, CONTROL_STEP_INDEX, 1);
            Atomics.notify(control, CONTROL_PAUSED_INDEX, 1);
            render({ force: true });
        }
    };

    if (canUseKeyboard) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on("data", onData);
    }

    return {
        dispose() {
            clearPendingRender();
            if (canUseKeyboard) {
                process.stdin.off("data", onData);
                process.stdin.setRawMode(false);
                process.stdin.pause();
            }
            if (canRenderInline) {
                process.stderr.write(SHOW_CURSOR);
            }
        },
        finish() {
            if (!canRenderInline) {
                return;
            }
            clearPendingRender();
            if (renderedLineCount === 0) {
                return;
            }
            clearRenderedLineBlock();
            renderedLineCount = 0;
        },
        onProgress(event: BenchmarkProgressEvent) {
            lastProgress = event;
            render();
        },
        shouldStop() {
            return stopped;
        },
    };

    function renderFixedLineBlock(lines: string[]) {
        const terminalWidth = getTerminalRenderWidth();
        const boundedLines = lines.map((line) =>
            truncateAnsi(line, terminalWidth)
        );
        let output = HIDE_CURSOR;

        if (renderedLineCount === 0) {
            renderedLineCount = boundedLines.length;
            output = output + reserveRenderLines(boundedLines.length);
        } else {
            output = output + moveCursorUp(renderedLineCount - 1);
        }

        if (boundedLines.length > renderedLineCount) {
            output =
                output +
                extendRenderedLineBlock(
                    boundedLines.length - renderedLineCount
                );
            renderedLineCount = boundedLines.length;
        }

        const paddedLines = [...boundedLines];
        while (paddedLines.length < renderedLineCount) {
            paddedLines.push("");
        }

        for (let index = 0; index < paddedLines.length; index++) {
            if (index > 0) {
                output = output + CURSOR_DOWN;
            }
            output = output + `${CLEAR_LINE}\r${paddedLines[index]}`;
        }
        process.stderr.write(`${output}${SHOW_CURSOR}`);
    }

    function reserveRenderLines(lineCount: number) {
        if (lineCount < 1) {
            throw new Error(
                "Cannot reserve benchmark progress renderer lines without at least one line."
            );
        }
        return `${"\n".repeat(lineCount - 1)}${moveCursorUp(lineCount - 1)}\r`;
    }

    function extendRenderedLineBlock(extraLineCount: number) {
        if (extraLineCount < 1) {
            return "";
        }
        return `${moveCursorDown(renderedLineCount - 1)}${"\n".repeat(
            extraLineCount
        )}${moveCursorUp(renderedLineCount + extraLineCount - 1)}\r`;
    }

    function clearRenderedLineBlock() {
        let output = HIDE_CURSOR;
        output = output + moveCursorUp(renderedLineCount - 1);
        for (let index = 0; index < renderedLineCount; index++) {
            if (index > 0) {
                output = output + CURSOR_DOWN;
            }
            output = output + `${CLEAR_LINE}\r`;
        }
        output = output + moveCursorUp(renderedLineCount - 1);
        process.stderr.write(`${output}\r${SHOW_CURSOR}`);
    }

    function clearPendingRender() {
        if (renderTimer === undefined) {
            return;
        }
        clearTimeout(renderTimer);
        renderTimer = undefined;
    }
}

const ANSI_ESCAPE = String.fromCharCode(27);
const CLEAR_LINE = `${ANSI_ESCAPE}[2K`;
const CURSOR_DOWN = `${ANSI_ESCAPE}[1B`;
const HIDE_CURSOR = `${ANSI_ESCAPE}[?25l`;
const PROGRESS_RENDER_INTERVAL_MS = 50;
const SHOW_CURSOR = `${ANSI_ESCAPE}[?25h`;
const ANSI_STYLE_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-9;]*m`, "g");

function renderAggregateProgressDetails(event: BenchmarkProgressEvent) {
    const details = [
        `op ${formatInteger(event.operationIndex)}/${formatInteger(
            event.totalOperations
        )}`,
        `phase ${formatInteger(event.phaseIndex)}/${formatInteger(
            event.totalPhases
        )}`,
        `case ${formatInteger(event.caseIndex)}/${formatInteger(
            event.totalCases
        )}`,
    ];

    const parallelTasks = event.parallelTasks;
    if (parallelTasks !== undefined) {
        const completeCount = parallelTasks.filter(
            (task) => task.status === "complete"
        ).length;
        const runningCount = parallelTasks.filter(
            (task) => task.status === "running"
        ).length;
        const startingCount = parallelTasks.filter(
            (task) => task.status === "starting"
        ).length;
        const pendingCount = parallelTasks.filter(
            (task) => task.status === "pending"
        ).length;
        details.push(
            `${formatInteger(runningCount)} running`,
            `${formatInteger(startingCount)} starting`,
            `${formatInteger(pendingCount)} queued`,
            `${formatInteger(completeCount)} done`
        );
    }

    return details.join("  ");
}

function renderOperationLines(event: BenchmarkProgressEvent) {
    if (event.parallelTasks === undefined) {
        return [renderProgressEventLine(event)];
    }
    return event.parallelTasks.map(renderProgressTaskLine);
}

function renderProgressEventLine(event: BenchmarkProgressEvent) {
    return [
        `op ${formatInteger(event.operationIndex)}/${formatInteger(
            event.totalOperations
        )}`,
        `phase ${formatInteger(event.phaseIndex)}/${formatInteger(
            event.totalPhases
        )}`,
        `${event.phase} ${formatInteger(event.commitIndex)}/${formatInteger(
            event.commitsInPhase
        )}`,
        renderLastOperationDuration(event.lastOperationDurationMs),
        colorize(event.scenarioTitle, "bold", "magenta"),
        `depth ${event.depthTitle}=${event.depth}`,
        `width ${event.widthTitle}=${event.width}`,
        `freq ${event.frequencyTitle}`,
        `read ${event.callbackReadMode}`,
        renderAutotrappingMode(event.autotrappingMode),
        renderSelectionMode(event.selectionMode),
    ].join("  ");
}

function renderProgressTaskLine(task: BenchmarkProgressTask) {
    const status = renderTaskStatus(task.status);
    const base = [
        status,
        `op ${formatInteger(task.operationIndex)}/${formatInteger(
            task.totalOperations
        )}`,
        `phase ${formatInteger(task.phaseIndex)}/${formatInteger(
            task.totalPhases
        )}`,
    ];

    if (task.status === "pending" || task.status === "starting") {
        return [
            ...base,
            colorize("shard", "dim"),
            colorize(task.scenarioTitle, "bold", "magenta"),
            `depth ${formatPendingNumber(task.depthTitle, task.depth)}`,
            `width ${formatPendingNumber(task.widthTitle, task.width)}`,
            `freq ${task.frequencyTitle ?? "unknown"}`,
            `read ${task.callbackReadMode ?? "mixed"}`,
            renderAutotrappingMode(task.autotrappingMode),
            renderSelectionMode(task.selectionMode),
            renderQueuedTaskState(task.status),
        ].join("  ");
    }

    if (task.status === "complete") {
        return [
            ...base,
            renderCompletedOperationDuration(task.p95OperationDurationMs),
            colorize(task.scenarioTitle, "bold", "magenta"),
            renderCompletedShardCount(task),
            colorize("complete", "green"),
        ].join("  ");
    }

    const phase = task.phase;
    if (phase === undefined) {
        throw new Error(
            `Cannot render running benchmark task ${task.scenarioId}: phase is missing.`
        );
    }
    const commitIndex = task.commitIndex;
    if (commitIndex === undefined) {
        throw new Error(
            `Cannot render running benchmark task ${task.scenarioId}: commitIndex is missing.`
        );
    }
    const commitsInPhase = task.commitsInPhase;
    if (commitsInPhase === undefined) {
        throw new Error(
            `Cannot render running benchmark task ${task.scenarioId}: commitsInPhase is missing.`
        );
    }
    const depthTitle = task.depthTitle;
    if (depthTitle === undefined) {
        throw new Error(
            `Cannot render running benchmark task ${task.scenarioId}: depthTitle is missing.`
        );
    }
    const depth = task.depth;
    if (depth === undefined) {
        throw new Error(
            `Cannot render running benchmark task ${task.scenarioId}: depth is missing.`
        );
    }
    const widthTitle = task.widthTitle;
    if (widthTitle === undefined) {
        throw new Error(
            `Cannot render running benchmark task ${task.scenarioId}: widthTitle is missing.`
        );
    }
    const width = task.width;
    if (width === undefined) {
        throw new Error(
            `Cannot render running benchmark task ${task.scenarioId}: width is missing.`
        );
    }
    const frequencyTitle = task.frequencyTitle;
    if (frequencyTitle === undefined) {
        throw new Error(
            `Cannot render running benchmark task ${task.scenarioId}: frequencyTitle is missing.`
        );
    }
    const callbackReadMode = task.callbackReadMode;
    if (callbackReadMode === undefined) {
        throw new Error(
            `Cannot render running benchmark task ${task.scenarioId}: callbackReadMode is missing.`
        );
    }

    return [
        ...base,
        colorize("shard", "dim"),
        `${phase} ${formatInteger(commitIndex)}/${formatInteger(
            commitsInPhase
        )}`,
        renderLastOperationDuration(task.lastOperationDurationMs),
        colorize(task.scenarioTitle, "bold", "magenta"),
        `depth ${depthTitle}=${depth}`,
        `width ${widthTitle}=${width}`,
        `freq ${frequencyTitle}`,
        `read ${callbackReadMode}`,
        renderAutotrappingMode(task.autotrappingMode),
        renderSelectionMode(task.selectionMode),
    ].join("  ");
}

function renderAutotrappingMode(
    autotrappingMode: BenchmarkProgressTask["autotrappingMode"]
) {
    if (autotrappingMode === undefined) {
        return "";
    }
    return `trap ${autotrappingMode}`;
}

function renderSelectionMode(
    selectionMode: BenchmarkProgressTask["selectionMode"]
) {
    if (selectionMode === undefined) {
        return "";
    }
    return `selection ${selectionMode}`;
}

function formatPendingNumber(
    title: string | undefined,
    value: number | undefined
) {
    if (title === undefined) {
        return "unknown";
    }
    if (value === undefined) {
        return title;
    }
    return `${title}=${value}`;
}

function renderLastOperationDuration(value: number | undefined) {
    const duration =
        value === undefined
            ? colorize("--", "dim")
            : colorize(formatDurationMs(value), "cyan");
    return `${colorize("last", "dim")} ${duration}`;
}

function renderCompletedOperationDuration(value: number | undefined) {
    const duration =
        value === undefined
            ? colorize("n/a", "dim")
            : colorize(formatDurationMs(value), "green");
    return `${colorize("P95", "dim")} ${duration}`;
}

function renderCompletedShardCount(task: BenchmarkProgressTask) {
    const completedWorkers = task.completedWorkers;
    const totalWorkers = task.totalWorkers;
    if (completedWorkers === undefined) {
        return "";
    }
    if (totalWorkers === undefined) {
        return `shards ${formatInteger(completedWorkers)}`;
    }
    return `shards ${formatInteger(completedWorkers)}/${formatInteger(
        totalWorkers
    )}`;
}

function renderTaskStatus(status: BenchmarkProgressTaskStatus) {
    if (status === "pending") {
        return colorize("PENDING", "dim");
    }
    if (status === "starting") {
        return colorize("START", "bold", "yellow");
    }
    if (status === "complete") {
        return colorize("DONE", "bold", "green");
    }
    return colorize("RUN", "bold", "green");
}

function renderQueuedTaskState(status: BenchmarkProgressTaskStatus) {
    if (status === "starting") {
        return colorize("starting", "yellow");
    }
    return colorize("queued", "dim");
}

function renderShortcutLine(paused: boolean) {
    const controls = paused
        ? [
              renderShortcut("p", "Resume"),
              renderShortcut("space", "Next"),
              renderShortcut("x", "Stop"),
          ]
        : [renderShortcut("p", "Pause"), renderShortcut("x", "Stop")];
    return [colorize("Controls", "bold", "cyan"), ...controls].join("  ");
}

function renderShortcut(key: string, label: string) {
    return `${colorize(key, "bold", "yellow")} ${colorize(label, "dim")}`;
}

function moveCursorDown(lineCount: number) {
    if (lineCount < 1) {
        return "";
    }
    return `${ANSI_ESCAPE}[${lineCount}B`;
}

function moveCursorUp(lineCount: number) {
    if (lineCount < 1) {
        return "";
    }
    return `${ANSI_ESCAPE}[${lineCount}A`;
}

function renderProgressBar(percentage: number, color: ConsoleStyle) {
    const width = 24;
    const filledWidth = Math.max(
        0,
        Math.min(width, Math.floor(percentage * width))
    );
    const emptyWidth = width - filledWidth;
    return [
        colorize("[", "dim"),
        colorize("=".repeat(filledWidth), color),
        colorize("-".repeat(emptyWidth), "dim"),
        colorize("]", "dim"),
    ].join("");
}

function getTerminalRenderWidth() {
    const columns = process.stderr.columns;
    if (columns === undefined) {
        return 100;
    }
    return Math.max(columns - 1, 40);
}

function truncateAnsi(value: string, maxVisibleWidth: number) {
    if (visibleWidth(value) <= maxVisibleWidth) {
        return value;
    }

    const ellipsis = "...";
    const targetWidth = Math.max(maxVisibleWidth - ellipsis.length, 0);
    let visibleCount = 0;
    let output = "";
    for (let index = 0; index < value.length; index++) {
        const current = value[index];
        if (current === ANSI_ESCAPE) {
            const endIndex = value.indexOf("m", index);
            if (endIndex === -1) {
                break;
            }
            output = output + value.slice(index, endIndex + 1);
            index = endIndex;
            continue;
        }
        if (visibleCount >= targetWidth) {
            break;
        }
        output = output + current;
        visibleCount++;
    }
    return `${output}${ellipsis}${ANSI_ESCAPE}[0m`;
}

function visibleWidth(value: string) {
    return value.replace(ANSI_STYLE_PATTERN, "").length;
}

function formatInteger(value: number) {
    return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number) {
    return `${(value * 100).toFixed(1)}%`;
}

function formatDurationMs(value: number) {
    if (value < 1) {
        return `${value.toFixed(4)} ms`;
    }
    if (value < 10) {
        return `${value.toFixed(3)} ms`;
    }
    if (value < 100) {
        return `${value.toFixed(2)} ms`;
    }
    return `${value.toFixed(1)} ms`;
}

function formatWorkerPlan(value: number | undefined) {
    if (value === undefined) {
        return "auto";
    }
    return formatInteger(value);
}

type ConsoleStyle =
    | "bold"
    | "cyan"
    | "dim"
    | "green"
    | "magenta"
    | "red"
    | "yellow";

const CONSOLE_STYLE_CODES: Record<ConsoleStyle, number> = {
    bold: 1,
    cyan: 36,
    dim: 2,
    green: 32,
    magenta: 35,
    red: 31,
    yellow: 33,
};

function colorize(value: string, ...styles: ConsoleStyle[]) {
    if (styles.length === 0) {
        return value;
    }

    const codes = styles
        .map((styleName) => CONSOLE_STYLE_CODES[styleName])
        .join(";");
    return `\x1b[${codes}m${value}\x1b[0m`;
}
