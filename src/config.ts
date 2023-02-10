import path from "path";
import { promises as fs } from "fs";
import os from "os";
import { normalizePattern, pick, readFileSafe, toBytes } from "./utils";
import yaml from "yaml";

const CONFIGURATION_DIR_PATH = path.join(os.homedir(), "Yandex.Disk.localized", ".last-hope");
const CONFIG_FILE_PATH = path.join(CONFIGURATION_DIR_PATH, "config.yaml");

export type RawConfig = {
    track?: string[];
    ignore?: string[];
    ignoreFrom?: string[];
    maxFileSize?: string;
};

export type Config = {
    trackPaths: string[];
    ignorePatterns: string[];
    ignoreFrom: string[];
    maxFileSize: number;
    configDirPath: string;
};

export const getConfig = async (): Promise<Config> => {
    const rawConfig: RawConfig = yaml.parse(await readFileSafe(CONFIG_FILE_PATH));
    // here
    return {
        trackPaths: await parseTrackPaths(rawConfig.track),
        ignoreFrom: pick(rawConfig, "ignoreFrom", []),
        ignorePatterns: pick(rawConfig, "ignore", [])
            .map(normalizePattern)
            .map((pat) => `*/**/${pat}`),
        maxFileSize: toBytes(pick(rawConfig, "maxFileSize", "42mb")),
        configDirPath: CONFIGURATION_DIR_PATH,
    };
};

const parseTrackPaths = async (value?: string[]) => {
    const handleOne = async (pathOrPattern: string) => {
        if (pathOrPattern.endsWith("/*")) {
            const dirPath = normalizePattern(pathOrPattern);
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            return entries.filter((stat) => stat.isDirectory()).map((stat) => path.join(dirPath, stat.name));
        }

        const stat = await fs.lstat(pathOrPattern);

        if (!stat.isDirectory()) {
            throw new Error(`Track path should refer to directory or directories`);
        }

        return pathOrPattern;
    };

    return (await Promise.all((value ?? []).map(handleOne))).flat();
};
