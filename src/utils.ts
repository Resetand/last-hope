import type { OmitByValue } from "utility-types";
import { promises as fs } from "fs";
import crypto from "crypto";
import logger from "./logger";

export const memoize = <TFn extends (...args: any[]) => any>(fn: TFn): TFn => {
    const cache = new Map<string, ReturnType<TFn>>();

    return ((...args: Parameters<TFn>) => {
        const cacheKey = JSON.stringify(Array.from(args));

        if (cache.has(cacheKey)) {
            return cache.get(cacheKey);
        }

        const result = fn(...args);
        cache.set(cacheKey, result);
        return result;
    }) as TFn;
};

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

// should i need use memoize here?
export const createHash = (data: crypto.BinaryLike) => {
    return crypto.createHash("sha1").update(data).digest("hex");
};

export async function getFilenames(dir: string) {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    return dirents.filter((dirent) => dirent.isFile()).map((dirent) => dirent.name);
}

const isPromise = (value: unknown): value is Promise<unknown> => {
    const getTypeTag = (value: unknown) => Object.prototype.toString.call(value).slice(8, -1);
    return !!value && getTypeTag(value) === "Promise";
};

type Fallback<T> = ((err: unknown) => T) | T;
type TryCatch = {
    <T, E = T>(fn: () => T, fallback?: Fallback<E>): E | T;
    <T, E = T>(fn: () => Promise<T>, fallback?: Fallback<Promise<E> | E>): Promise<T | E>;
};

const _DEFAULT_FALLBACK = () => undefined!;

/**
 * Оборачивает вызов функции в try-catch
 * @param fn - исполняемая функция (Может возвращать Promise)
 * @param fallback - значение которое возвращается в случае исключения
 */
export const tryCatch: TryCatch = (fn: () => unknown | Promise<unknown>, fallback: Fallback<unknown> = _DEFAULT_FALLBACK) => {
    const onFallback = (e: unknown) => {
        if (fallback === _DEFAULT_FALLBACK) {
            // log an error
            logger.debug(`Error occurred during ${fn}, but handled`, e);
        }
        return fallback instanceof Function ? fallback(e) : fallback;
    };

    try {
        const resOrPromise = fn();
        return isPromise(resOrPromise) ? resOrPromise.catch((e) => onFallback(e)) : resOrPromise;
    } catch (error) {
        return onFallback(error);
    }
};

export async function ensureDir(path: string) {
    await tryCatch(
        () => fs.mkdir(path, { recursive: true }),
        (error: any) => {
            if (error.code !== "EEXIST") {
                throw error;
            }
        }
    );
    return path;
}
