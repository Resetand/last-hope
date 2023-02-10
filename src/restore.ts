import path from "path";
import tar from "tar";
import zlib from "zlib";
import logger from "./logger";

import { createReadStream } from "fs";
import { getFilenames, tryCatch } from "./utils";

type Options = {
    onExtracted?: (objectFilePath: string) => void;
};

export async function restoreFromBackup(backupDir: string, outputDir: string, options?: Options) {
    const objectsDir = path.join(backupDir, "objects");
    const objectsFiles = (await getFilenames(objectsDir)).map((name) => path.join(objectsDir, name));

    for (const filePath of objectsFiles) {
        if (!filePath.endsWith(".gz")) {
            continue;
        }
        await tryCatch(() => extractObject(filePath, outputDir));
        options?.onExtracted?.(filePath);
        logger.debug(`Extract object ${path.basename(filePath)}`);
    }
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
