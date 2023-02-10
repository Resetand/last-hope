#!/usr/bin/env node
import os from "os";
import tar, { Extract } from "tar";
import path from "path";
import logger from "./logger";
import chokidar from "chokidar";
import inquirer from "inquirer";

import { promises as fs, createReadStream } from "fs";
import { Config, getConfig, initConfig } from "./config";
import { collectIgnoreFilePatterns } from "./ignore";
import { gzip } from "./gzip";
import { getFilenames, createHash } from "./utils";
import { program } from "commander";
import zlib from "zlib";

program
    .command("init")
    .description("Setup config")
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
    const DEFAULT_IGNORE = ["*/**/node_modules"];
    const DEFAULT_IGNORE_FROM = [".gitignore"];

    const configPath = await initConfig({
        cloudFolder,
        maxFileSize: answers.maxFileSize,
        track: [ensureAbsolute(answers.trackPath)],
        ignore: answers.shouldIgnore ? DEFAULT_IGNORE : undefined,
        ignoreFrom: answers.shouldIgnore ? DEFAULT_IGNORE_FROM : undefined,
    });

    const backupDir = path.join(cloudFolder, ".lh-backup");
    try {
        await fs.mkdir(backupDir);
        await fs.mkdir(path.join(backupDir, "objects"));
    } catch (error: any) {
        if (error.code !== "EEXIST") {
            throw error;
        }
    }

    console.log(`Backup folder init at "${backupDir}"`);
    console.log(`Config successfully created at "${configPath}"\n`);
    console.log(await fs.readFile(configPath, "utf-8"));
}

async function restore() {
    const outputDir = process.cwd();
    const objectsDir = path.join(await (await getConfig()).backupDir, "objects");

    const objectsFiles = (await getFilenames(objectsDir)).map((name) => path.join(objectsDir, name));

    for (const filePath of objectsFiles) {
        if (!filePath.endsWith(".gz")) {
            continue;
        }
        try {
            await extractObject(filePath, outputDir).catch((error) => {
                logger.debug("Error while extract an object in catch", filePath, error);
            });
            await new Promise((res) => setTimeout(res, 250));
            logger.debug(`Extract object ${path.basename(filePath)}`);
        } catch (error) {
            logger.debug("Error while extract an object", filePath, error);
            continue; // silence
        }
    }
}

async function start() {
    const config = await getConfig();

    const objectsDir = path.join(config.backupDir, "objects");
    const unhandledObjects = new Set(await getFilenames(objectsDir));
    for (const target of config.trackPaths) {
        await processTarget(target, config, {
            onPersisted: (objFilename) => unhandledObjects.delete(objFilename),
        });
    }

    const filesToRemove = Array.from(unhandledObjects);
    logger.debug(`COMPLETE ALL SCANS!, ${unhandledObjects.size} outdated objects`, filesToRemove.join(", "));
    await Promise.all(filesToRemove.map((file) => fs.rm(path.join(objectsDir, file))));
}

type ProcessOptions = {
    onPersisted?: (objFilename: string) => void;
};

async function processTarget(targetPath: string, config: Config, options?: ProcessOptions): Promise<void> {
    const targetStat = await fs.stat(targetPath);
    const targetDir = targetStat.isDirectory() ? targetPath : path.dirname(targetPath);
    const ignorePatterns = [...config.ignorePatterns, ...(await collectIgnoreFilePatterns(targetDir, config.ignoreFrom))];

    const destinationDir = path.join(config.backupDir, "objects");

    const persistObject = async (filePath: string) => {
        const t1 = performance.now();
        const objectFilename = await getObjectFilename(filePath);
        const destination = path.join(destinationDir, objectFilename);

        await gzip(filePath, {
            destination,
            maxFileSize: config.maxFileSize,
        });
        options?.onPersisted?.(objectFilename);
        logger.debug(`in ${(performance.now() - t1).toFixed(6)}ms gzipped ${objectFilename} ${path.basename(filePath)}`);
    };

    return new Promise((resolve) => {
        chokidar
            .watch(targetPath, { ignored: ignorePatterns })
            .on("add", (filePath) => persistObject(filePath))
            .on("change", (filePath) => persistObject(filePath))
            .on("unlink", (filePath) => fs.rm(path.join(destinationDir, getObjectFilename(filePath))))
            .on("ready", () => {
                logger.debug(`COMPLETE SCAN OF ${targetPath}`);
                resolve();
            });
    });
}

async function extractObject(filePath: string, extractTo: string) {
    await new Promise<void>((resolve, reject) => {
        try {
            const unzip = zlib.createGunzip().on("error", reject);
            const extractor = tar.extract({ cwd: extractTo, newer: true }).on("error", reject);

            createReadStream(filePath, { autoClose: true })
                //
                .on("end", resolve)
                .on("error", reject)
                .pipe(unzip)
                .pipe(extractor);
        } catch (error) {
            logger.debug("error while extractObject", error);
            reject(error);
        }
    });
}

function getObjectFilename(filePath: string) {
    return `${createHash(filePath)}.gz`;
}

function ensureAbsolute(pathValue: string) {
    return path.isAbsolute(pathValue.trim()) ? pathValue : path.resolve(process.cwd(), pathValue.trim());
}
