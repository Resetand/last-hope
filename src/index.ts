#!/usr/bin/env node

import path from "path";
import logger from "./logger";
import chokidar from "chokidar";
import { promises as fs } from "fs";
import { Config, getConfig } from "./config";
import { collectIgnoreFilePatterns } from "./ignore";
import { gzip } from "./gzip";
import { getFilenames, createHash } from "./utils";

async function main() {
    const config = await getConfig();
    logger.debug("config", config);

    const objectsDir = path.join(config.configDirPath, "objects");
    const unhandledObjects = new Set(await getFilenames(objectsDir));

    await Promise.all(
        config.trackPaths.map((target) =>
            processTarget(target, config, {
                onPersisted: (objFilename) => unhandledObjects.delete(objFilename),
            })
        )
    );

    const filesToRemove = Array.from(unhandledObjects);
    logger.debug(`COMPLETE ALL SCANS!, ${unhandledObjects.size} outdated objects`, filesToRemove);
    await Promise.all(filesToRemove.map((file) => fs.rm(path.join(objectsDir, file))));
}

type ProcessOptions = {
    onPersisted?: (objFilename: string) => void;
};

async function processTarget(targetPath: string, config: Config, options?: ProcessOptions): Promise<void> {
    const targetStat = await fs.stat(targetPath);
    const targetDir = targetStat.isDirectory() ? targetPath : path.dirname(targetPath);
    const ignorePatterns = [...config.ignorePatterns, ...(await collectIgnoreFilePatterns(targetDir, config.ignoreFrom))];

    const destinationDir = path.join(config.configDirPath, "objects");

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

function getObjectFilename(filePath: string) {
    return `${createHash(filePath)}.gz`;
}

// ============================================
main();
// ============================================
