#!/usr/bin/env node
import inquirer from "inquirer";
import os from "os";
import path from "path";

import { program } from "commander";
import { promises as fs } from "fs";
import { getConfig, upsertConfig } from "./config";
import { startDaemonOn } from "./daemon";
import { collectIgnoreFilePatterns, parseIgnoreFileContent } from "./ignore";
import { restoreFromBackup } from "./restore";
import { getFilenames, ensureDir, consoleLoading } from "./utils";

program
    .command("init")
    .description("Setup a config")
    .action(() => init());

program
    .command("restore")
    .argument("[backup_dir]", "Path to a backup folder, by default will use cloudFolder specified in the config", "[cloudFolder]")
    .description("Restore a backup")
    .action(([backup_dir]) => restore(backup_dir === "[cloudFolder]" ? undefined : backup_dir));

program
    .command("start")
    .description("Start a file watcher demon for the specified folders")
    .action(() => start());

program
    .command("ls")
    .description("Returns all tracking directories")
    .action(() => getConfig().then((cfg) => console.table(cfg.trackPaths.map((path) => ({ path })))));

program
    .command("add")
    .description("Add a new directory to track")
    .argument("<path>", "Path to a directory")
    .action(([path]) => void upsertConfig((prev) => ({ track: [...(prev?.track ?? []), path] })));

program.parse(process.argv);

async function start() {
    let indexCount = 0;
    const config = await getConfig();
    const objectsStoreDir = await ensureDir(path.join(config.backupDir, "objects"));
    const objectsStoreFiles = await getFilenames(objectsStoreDir);
    const objectsStoreFilesCount = objectsStoreFiles.length;
    const unhandledObjects = new Set(objectsStoreFiles);

    const onProcessed = (objFilename: string) => {
        indexCount++;
        unhandledObjects.delete(objFilename);
    };

    // console.clear();
    // const cleanupLoader = consoleLoading(() => `${indexCount} / ${objectsStoreFilesCount} files are indexed`);

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

    // cleanupLoader();
    // console.clear();

    const filesToRemove = Array.from(unhandledObjects);
    await Promise.all(filesToRemove.map((file) => fs.rm(path.join(objectsStoreDir, file))));
    console.log(`Indexation is complete!, found ${unhandledObjects.size} outdated objects, keep track of ${indexCount} files!`);
}

async function restore(customBackupDir?: string) {
    const devDir = path.join(process.cwd(), "restored-dev-only");
    const outputDir = process.env.NODE_ENV === "dev" ? await ensureDir(devDir) : process.cwd();
    const backupDir = customBackupDir || (await (await getConfig()).backupDir);
    let count = 0;

    // console.clear();
    // const cleanupLoader = consoleLoading(() => `Extracted ${count} files`);

    await restoreFromBackup(backupDir, outputDir, {
        onExtracted: () => {
            count++;
        },
    });

    // cleanupLoader();
    // console.clear();

    console.log(`Successfully restored ${count} files into "${outputDir}". God bless you and your data 🙏🏼😒`);
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

    const configPath = await upsertConfig({
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
