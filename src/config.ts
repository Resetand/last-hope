import path from "path";
import { promises as fs } from "fs";
import os from "os";
import { normalizePattern, pick, readFileSafe, toBytes } from "./utils";
import yaml from "yaml";

const CONFIG_FILE_PATH = path.join(os.homedir(), ".lh-config.yaml");

export type RawConfig = {
    track?: string[];
    ignore?: string[];
    ignoreFrom?: string[];
    maxFileSize?: string;
    cloudFolder?: string;
};

export type Config = {
    trackPaths: string[];
    ignorePatterns: string[];
    ignoreFrom: string[];
    maxFileSize: number;
    backupDir: string;
};

export const getConfig = async (): Promise<Config> => {
    const rawConfig: RawConfig = yaml.parse(await readFileSafe(CONFIG_FILE_PATH));
    const backupDir = path.join(rawConfig.cloudFolder!, ".lh-backup");

    return {
        backupDir,
        trackPaths: await parseTrackPaths(rawConfig.track),
        maxFileSize: toBytes(pick(rawConfig, "maxFileSize", "42mb")),
        ignoreFrom: pick(rawConfig, "ignoreFrom", []),
        ignorePatterns: pick(rawConfig, "ignore", []).map(normalizePattern),
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

export async function initConfig(raw: RawConfig) {
    const filePath = path.join(os.homedir(), ".lh-config.yaml");
    await fs.writeFile(filePath, yaml.stringify(raw));
    return filePath;
}
