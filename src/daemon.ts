import async from "async";
import path from "path";
import chokidar from "chokidar";
import logger from "./logger";

import { promises as fs, Stats } from "fs";
import { gzip } from "./gzip";
import { createHash, tryCatch } from "./utils";

type Options = {
    objectsStoreDir: string;
    ignorePatterns: string[];
    maxFileSize: number;
    onPersisted?: (objFilename: string, originalFileLik: string) => void;
    onSkipped?: (objFilename: string, originalFileLik: string) => void;
};

export async function startDaemonOn(targetPath: string, options: Options): Promise<void> {
    const persistQueue = async.priorityQueue((filePath: string, done) => {
        return tryCatch(() => persistFile(filePath, options)).then(() => done());
    }, 10);

    const unlinkQueue = async.queue((filePath: string) => {
        return tryCatch(() => fs.rm(path.join(options.objectsStoreDir, getObjectFilename(filePath))));
    }, 10);

    return new Promise((resolve) => {
        chokidar
            .watch(targetPath, { ignored: options.ignorePatterns })
            .on("add", (filePath) => persistQueue.push(filePath, 1))
            .on("change", (filePath) => persistQueue.push(filePath, 0))
            .on("unlink", (filePath) => unlinkQueue.push(filePath))
            .on("ready", () => persistQueue.drain(() => resolve()))
            .on("error", (error) => logger.debug("An error occurred while file watching", error));
    });
}

async function persistFile(filePath: string, options: Options) {
    const t1 = performance.now();

    const objectFilename = await getObjectFilename(filePath);
    const destination = path.join(options.objectsStoreDir, objectFilename);
    const origStat = await fs.stat(filePath);

    if (await isObjectRelevant(origStat, destination)) {
        options.onSkipped?.(objectFilename, filePath);
        logger.debug(`in ${(performance.now() - t1).toFixed(6)}ms skip ${objectFilename}`);
        return;
    }

    await gzip(filePath, destination, { maxFileSize: options.maxFileSize });

    // change a mod time of the gzipped file to be the same as original file
    // mode time, will be used as some sort of hash key of the file to avoid unnecessary changes
    await fs.utimes(destination, origStat.atime, origStat.mtime);

    options.onPersisted?.(objectFilename, filePath);
    logger.debug(`in ${(performance.now() - t1).toFixed(6)}ms gzipped ${objectFilename} ${path.basename(filePath)}`);
}

function getObjectFilename(filePath: string) {
    return `${createHash(filePath)}.gz`;
}

async function isObjectRelevant(originalFileStat: Stats, objectFilePath: string) {
    return tryCatch(async () => {
        //
        const objectStat = await fs.stat(objectFilePath);
        return String(originalFileStat.mtime) === String(objectStat.mtime);
    }, false);
}
