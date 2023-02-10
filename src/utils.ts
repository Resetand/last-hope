import type { OmitByValue } from "utility-types";
import { promises as fs } from "fs";
import crypto from "crypto";

export const objectFilter = <T extends Record<string, unknown>>(
    source: T,
    predicate: <TKey extends keyof T>(key: TKey, value: T[TKey]) => boolean
) => {
    return Object.entries(source).reduce((acc, [key, value]) => {
        if (predicate(key, value as T[keyof T])) {
            acc[key] = value;
        }
        return acc;
    }, {} as Record<string, unknown>) as T;
};

type ExcludeNillFunction = {
    <T extends Array<unknown>>(items: T): Array<Exclude<T[number], undefined | null>>;
    <T extends Record<PropertyKey, unknown>>(obj: T): OmitByValue<T, null | undefined>;
};

export const excludeNil: ExcludeNillFunction = (values: Array<unknown> | Record<PropertyKey, unknown>) => {
    return Array.isArray(values)
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (values.filter((value) => !isNil(value)) as any)
        : objectFilter(values, (_, value) => !isNil(value));
};

export const isNil = <TValue>(value: TValue): value is Exclude<TValue, null | undefined> => {
    return value === null || value === undefined;
};

export function trimChar(str: string, char: string | [string | false, string | false]) {
    const [left, right] = Array.isArray(char) ? char : [char, char];
    const esc = (ch: string) => ch.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const pattern = [left && `^[${esc(left)}]*`, right && `[${esc(right)}]*$`].filter(Boolean).join("|");

    const regEx = new RegExp(pattern, "g");

    const trimmedString = str.replace(regEx, "");
    return trimmedString;
}

export function normalizePattern(pattern: string) {
    return trimChar(trimChar(pattern, [false, "/"]), [false, "/*"]);
}

export function partitionBy<T>(items: T[], predicate: (item: T) => boolean) {
    const initial: [T[], T[]] = [[], []];

    return items.reduce((acc, item) => {
        const [left, right] = acc;
        predicate(item) ? left.push(item) : right.push(item);
        return acc;
    }, initial);
}

export const readFileSafe = async (path: string, encoding: BufferEncoding = "utf8"): Promise<string> => {
    try {
        return fs.readFile(path, encoding);
    } catch (error) {
        return "";
    }
};

export function toBytes(size: string): number {
    const units = {
        b: 1,
        kb: 1024,
        mb: 1024 * 1024,
        gb: 1024 * 1024 * 1024,
        tb: 1024 * 1024 * 1024 * 1024,
    };

    const [_, amount, unit] = (size.toLowerCase().match(/^(\d+)\s*([a-z]+)?$/) ?? []) as [string, string, keyof typeof units];

    if (!units[unit]) {
        throw new Error("Invalid size string");
    }

    return parseInt(amount, 10) * units[unit];
}

export function pick<TObj extends Record<PropertyKey, unknown>, TKey extends keyof TObj, TFallback extends TObj[TKey] = never>(
    obj: TObj,
    key: TKey,
    fallback?: TFallback
) {
    const value = obj[key];
    if (value !== undefined) {
        return value;
    }
    if (fallback !== undefined) {
        return fallback;
    }
    throw new Error(`missing key ${String(key)}`);
}

export function createHash(data: crypto.BinaryLike) {
    return crypto.createHash("sha1").update(data).digest("hex");
}

export async function getFilenames(dir: string) {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    return dirents.filter((dirent) => dirent.isFile()).map((dirent) => dirent.name);
}
