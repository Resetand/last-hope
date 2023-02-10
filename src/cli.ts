#!/usr/bin/env node
import inquirer from "inquirer";
import os from "os";
import path from "path";
import logger from "./logger";

import { program } from "commander";
import { promises as fs } from "fs";
import { getConfig, initConfig } from "./config";
import { startDaemonOn } from "./daemon";
import { collectIgnoreFilePatterns, parseIgnoreFileContent } from "./ignore";
import { restoreFromBackup } from "./restore";
import { getFilenames, ensureDir } from "./utils";

program
    .command("init")
    .description("Setup a config")
    .version("0.0.1")
    .action(() => init());

program
    .command("restore")
    .description("Restore a backup")
    .version("0.0.1")
    .action(() => restore());

program
    .command("start")
    .description("Start a file watcher demon for the specified folders")
    .version("0.0.1")
    .action(() => start());

program.parse(process.argv);

async function start() {
    let processedCount = 0;
    const config = await getConfig();
    const objectsStoreDir = await ensureDir(path.join(config.backupDir, "objects"));
    const unhandledObjects = new Set(await getFilenames(objectsStoreDir));

    logger.debug("config", config);

    const onProcessed = (objFilename: string) => {
        processedCount++;
        unhandledObjects.delete(objFilename);
    };

    for (const target of config.trackPaths) {
        const ignorePatterns = [...config.ignorePatterns, ...(await collectIgnoreFilePatterns(target, config.ignoreFrom))];

        await startDaemonOn(target, {
            ignorePatterns,
            objectsStoreDir,
            maxFileSize: config.maxFileSize,
            onPersisted: onProcessed,
            onSkipped: onProcessed,
        });
    }

    const filesToRemove = Array.from(unhandledObjects);
    // await Promise.all(filesToRemove.map((file) => fs.rm(path.join(objectsStoreDir, file))));
    logger.debug(`SCAN IS COMPLETED!, Processed ${processedCount} files, found ${unhandledObjects.size} unlinked objects`);
}

async function restore() {
    const config = await getConfig();
    const devDir = path.join(process.cwd(), "restored-dev-only");
    const outputDir = process.env.NODE_ENV === "dev" ? await ensureDir(devDir) : process.cwd();

    logger.debug("config", config);

    return restoreFromBackup(config.backupDir, outputDir);
}

async function init() {
    const answers = await inquirer.prompt([
        {
            name: "trackPath",
            message: "Which folders do you want to track?",
            default: `${path.join(process.cwd(), "/*")}`,
        },
        {
            name: "cloudFolder",
            message: "Specify a cloud sync folder where the backup will live",
            default: `${path.join(os.homedir(), "Yandex.Disk.localized")}`,
        },
        {
            name: "maxFileSize",
            message: "What is the max file size that can be store?",
            default: "42mb",
        },
        {
            type: "confirm",
            name: "shouldIgnore",
            message: "Should ignore files listed in .gitignore?",
            default: true,
        },
    ]);

    const cloudFolder = ensureAbsolute(answers.cloudFolder);

    const DEFAULT_IGNORE_FROM = [".gitignore"];

    const configPath = await initConfig({
        cloudFolder,
        maxFileSize: answers.maxFileSize,
        track: [ensureAbsolute(answers.trackPath)],
        ignore: answers.shouldIgnore ? await getCommonIgnorePatterns() : undefined,
        ignoreFrom: answers.shouldIgnore ? DEFAULT_IGNORE_FROM : undefined,
    });

    await ensureDir(path.join(cloudFolder, ".lh-backup/objects"));
    console.log(`Config successfully created at "${configPath}"\n`);
    console.log(await fs.readFile(configPath, "utf-8"));
}

function ensureAbsolute(pathValue: string) {
    return path.isAbsolute(pathValue.trim()) ? pathValue : path.resolve(process.cwd(), pathValue.trim());
}

async function getCommonIgnorePatterns() {
    const fileContent = await fs.readFile(path.join(__dirname, "../assets/common-ignore"), "utf-8");
    const lines = parseIgnoreFileContent(fileContent);
    return lines.map((line) => path.join("*/**", line));
}
