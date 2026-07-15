import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Retree } from "@retreejs/core";
import { createFetchQuerySource, fetchQueryNode } from "./fetchQueryNode.js";

interface IWeatherArgs {
    city: string;
}

describe("fetchQueryNode", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("runs a one-shot fetch when observed and resolves to success", async () => {
        const fetchWeather = vi.fn((args: IWeatherArgs) =>
            Promise.resolve({ city: args.city, temperature: 21 })
        );
        const node = Retree.root(
            fetchQueryNode(fetchWeather, { args: { city: "Seattle" } })
        );
        expect(fetchWeather).not.toHaveBeenCalled();

        Retree.on(node, "nodeChanged", () => undefined);
        expect(fetchWeather).toHaveBeenCalledWith({ city: "Seattle" });
        expect(node.result).toEqual({ status: "pending" });

        await vi.advanceTimersByTimeAsync(0);

        expect(node.result).toEqual({
            status: "success",
            data: { city: "Seattle", temperature: 21 },
        });
        expect(node.state).toEqual({ city: "Seattle", temperature: 21 });
    });

    it("defaults args to an empty object for argument-less fetches", async () => {
        const fetchStatus = vi.fn(() => Promise.resolve("ready"));
        const node = Retree.root(fetchQueryNode(fetchStatus));

        Retree.on(node, "nodeChanged", () => undefined);
        await vi.advanceTimersByTimeAsync(0);

        expect(fetchStatus).toHaveBeenCalledWith({});
        expect(node.state).toBe("ready");
    });

    it("polls on refetchInterval and stops when unobserved", async () => {
        let temperature = 20;
        const fetchWeather = vi.fn((args: IWeatherArgs) => {
            temperature += 1;
            return Promise.resolve({ city: args.city, temperature });
        });
        const node = Retree.root(
            fetchQueryNode(fetchWeather, {
                args: { city: "Seattle" },
                refetchInterval: 1000,
            })
        );
        const unsubscribe = Retree.on(node, "nodeChanged", () => undefined);
        await vi.advanceTimersByTimeAsync(0);
        expect(node.state?.temperature).toBe(21);

        await vi.advanceTimersByTimeAsync(1000);
        expect(fetchWeather).toHaveBeenCalledTimes(2);
        expect(node.state?.temperature).toBe(22);

        await vi.advanceTimersByTimeAsync(1000);
        expect(fetchWeather).toHaveBeenCalledTimes(3);
        expect(node.state?.temperature).toBe(23);

        unsubscribe();
        await vi.advanceTimersByTimeAsync(5000);
        expect(fetchWeather).toHaveBeenCalledTimes(3);
    });

    it("drops results that resolve after the subscription closed", async () => {
        let resolveFetch!: (value: string) => void;
        const fetchSlow = vi.fn(
            () =>
                new Promise<string>((resolve) => {
                    resolveFetch = resolve;
                })
        );
        const node = Retree.root(fetchQueryNode(fetchSlow));
        const unsubscribe = Retree.on(node, "nodeChanged", () => undefined);

        unsubscribe();
        resolveFetch("late");
        await vi.advanceTimersByTimeAsync(0);

        expect(node.state).toBeUndefined();
        expect(node.result).toEqual({ status: "pending" });
    });

    it("surfaces fetch rejections as error results and refetches on retry", async () => {
        let shouldFail = true;
        const fetchFlaky = vi.fn(() => {
            if (shouldFail) {
                return Promise.reject(new Error("Fetch failed"));
            }
            return Promise.resolve("recovered");
        });
        const node = Retree.root(fetchQueryNode(fetchFlaky));
        Retree.on(node, "nodeChanged", () => undefined);
        await vi.advanceTimersByTimeAsync(0);

        expect(node.result.status).toBe("error");
        if (node.result.status !== "error") {
            throw new Error(
                "fetchQueryNode test expected an error query result."
            );
        }
        expect(node.result.error.message).toBe("Fetch failed");

        shouldFail = false;
        node.retry();
        expect(node.result).toEqual({ status: "pending" });
        await vi.advanceTimersByTimeAsync(0);

        expect(node.result).toEqual({ status: "success", data: "recovered" });
    });

    it("wraps non-Error rejections in a pinpointed error", async () => {
        const node = Retree.root(fetchQueryNode(() => Promise.reject("boom")));
        Retree.on(node, "nodeChanged", () => undefined);
        await vi.advanceTimersByTimeAsync(0);

        expect(node.result.status).toBe("error");
        expect(node.error?.message).toBe(
            "createFetchQuerySource: query source rejected with a non-Error value: boom"
        );
    });

    it("supports skip from the constructor", () => {
        const fetchWeather = vi.fn((args: IWeatherArgs) =>
            Promise.resolve({ city: args.city, temperature: 21 })
        );
        const node = Retree.root(fetchQueryNode(fetchWeather, "skip"));
        Retree.on(node, "nodeChanged", () => undefined);

        expect(fetchWeather).not.toHaveBeenCalled();
        expect(node.result).toEqual({ status: "skipped" });
    });

    it("refetches when args change through updateArgs", async () => {
        const fetchWeather = vi.fn((args: IWeatherArgs) =>
            Promise.resolve({ city: args.city, temperature: 21 })
        );
        const node = Retree.root(
            fetchQueryNode(fetchWeather, { args: { city: "Seattle" } })
        );
        Retree.on(node, "nodeChanged", () => undefined);
        await vi.advanceTimersByTimeAsync(0);

        node.updateArgs({ city: "Portland" });
        await vi.advanceTimersByTimeAsync(0);

        expect(fetchWeather).toHaveBeenCalledTimes(2);
        expect(node.state?.city).toBe("Portland");
    });

    it("throws a pinpointed error for a non-positive refetchInterval", () => {
        expect(() =>
            createFetchQuerySource(() => Promise.resolve("x"), {
                refetchInterval: 0,
            })
        ).toThrow(
            "createFetchQuerySource: expected refetchInterval to be greater than 0 milliseconds."
        );
    });
});
