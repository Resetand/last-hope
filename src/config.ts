import path from "path";
import { promises as fs, existsSync } from "fs";
import os from "os";
import { ensureDir, normalizePattern, pick, toBytes, tryCatch } from "./utils";
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

class InvalidConfigError extends Error {}

const invalid = (message: string) => {
    throw new InvalidConfigError(message);
};

type Mode = "replace" | "update";
type Action = (prev: RawConfig | null) => RawConfig;

export async function upsertConfig(action: RawConfig | Action, mode: Mode = "replace") {
    const filePath = path.join(os.homedir(), ".lh-config.yaml");
    const prev = await tryCatch(() => fs.readFile(filePath, "utf8").then((value) => yaml.parse(value)), null);

    if (mode === "update" && !prev) {
        if (!prev) return invalid('Config does not exists yes. Run "ls-backup init" to setup config');
    }

    const raw = validateRawConfig({
        ...(mode === "update" ? prev : {}),
        ...(action instanceof Function ? action(prev) : action),
    });

    await fs.writeFile(filePath, yaml.stringify(raw), "utf-8");
    return filePath;
}

export const getConfig = async (): Promise<Config> => {
    if (process.env.NODE_ENV === "dev") {
        return getDevConfig();
    }

    const raw: RawConfig = await validateRawConfig(yaml.parse(await fs.readFile(CONFIG_FILE_PATH, "utf-8")));

    const backupDir = path.join(pick(raw, "cloudFolder"), ".lh-backup");
    const maxFileSize = toBytes(pick(raw, "maxFileSize", "42mb"));
    const ignorePatterns = pick(raw, "ignore", []);
    const ignoreFrom = pick(raw, "ignoreFrom", []);
    const trackPaths = pick(raw, "track").map(normalizePattern);
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

async function validateRawConfig(cfg: RawConfig) {
    if (!cfg.track?.length) {
        return invalid(
            'No track paths specified. Run "ls-backup init" to setup config or "ls-backup add [path]" to add path to the existing config'
        );
    }
    if (!cfg.cloudFolder) {
        return invalid('No cloudFolder specified. Run "ls-backup init" to setup config');
    }

    for (const trackPath of cfg.track) {
        if (!(await (await fs.stat(normalizePattern(trackPath))).isDirectory())) {
            return invalid(`The path "${trackPath}" should refer to a directory`);
        }
    }

    if (!(await (await fs.stat(cfg.cloudFolder)).isDirectory())) {
        return invalid(`The path "${cfg.cloudFolder}" should refer to a directory`);
    }

    return cfg;
}

async function getCommonIgnorePatterns() {
    const fileContent = await fs.readFile(path.join(ASSETS_FOLDER, "common-ignore"), "utf-8");
    const lines = parseIgnoreFileContent(fileContent);
    return lines.map((line) => path.join("*/**", line));
}
