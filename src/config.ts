import path from "path";
import { promises as fs } from "fs";
import os from "os";
import { ensureDir, normalizePattern, pick, toBytes } from "./utils";
import yaml from "yaml";
import { parseIgnoreFileContent } from "./ignore";

const CONFIG_FILE_PATH = path.join(os.homedir(), ".lh-config.yaml");
const ASSETS_FOLDER = path.join(__dirname, "../assets");

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
    commonIgnorePatterns: string[];
};

export async function initConfig(raw: RawConfig) {
    const filePath = path.join(os.homedir(), ".lh-config.yaml");
    await fs.writeFile(filePath, yaml.stringify(raw));
    return filePath;
}

export const getConfig = async (): Promise<Config> => {
    if (process.env.NODE_ENV === "dev") {
        return getDevConfig();
    }

    const rawConfig: RawConfig = yaml.parse(await fs.readFile(CONFIG_FILE_PATH, "utf-8"));
    const backupDir = path.join(pick(rawConfig, "cloudFolder"), ".lh-backup");
    const maxFileSize = toBytes(pick(rawConfig, "maxFileSize", "42mb"));
    const ignorePatterns = pick(rawConfig, "ignore", []);
    const ignoreFrom = pick(rawConfig, "ignoreFrom", []);
    const trackPaths = await parseTrackPaths(pick(rawConfig, "track"));
    const commonIgnorePatterns = await getCommonIgnorePatterns();

    return {
        backupDir,
        trackPaths,
        maxFileSize,
        ignoreFrom,
        ignorePatterns,
        commonIgnorePatterns,
    };
};

async function getDevConfig(): Promise<Config> {
    const commonIgnorePatterns = await getCommonIgnorePatterns();
    return {
        trackPaths: [process.cwd()],
        ignoreFrom: [".gitignore"],
        ignorePatterns: commonIgnorePatterns,
        maxFileSize: toBytes("100mb"),
        backupDir: await ensureDir(path.join(process.cwd(), "backup-dev-only")),
        commonIgnorePatterns: commonIgnorePatterns,
    };
}

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

async function getCommonIgnorePatterns() {
    const fileContent = await fs.readFile(path.join(ASSETS_FOLDER, "common-ignore"), "utf-8");
    const lines = parseIgnoreFileContent(fileContent);
    return lines.map((line) => path.join("*/**", line));
}
