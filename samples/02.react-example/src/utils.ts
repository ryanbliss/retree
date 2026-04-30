export function isErrorLike(value: unknown): value is {
    message: string;
} {
    if (value === undefined || value === null) return false;
    if (typeof value !== "object") return false;

    return typeof (value as any).message === "string";
}
