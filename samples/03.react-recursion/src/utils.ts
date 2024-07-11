
export function isErrorLike(value: unknown): value is {
    message: string
} {
    if (value === undefined || value === null) return false;
    if (typeof value !== "object") return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return typeof (value as any).message === "string";
}