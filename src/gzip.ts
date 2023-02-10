import tar from "tar";
import zlib from "zlib";
import match from "micromatch";
import logger from "./logger";
import { normalizePattern } from "./utils";
import { createReadStream, createWriteStream } from "fs";

type GzipDirectoryOptions = {
    ignorePatterns?: string[];
    maxFileSize?: number;
};

export async function gzip(targetPath: string, destinationPath: string, options?: GzipDirectoryOptions) {
    const filterEntity = (path: string, stat: tar.FileStat) => {
        if (options?.maxFileSize && stat.size > options.maxFileSize) {
            logger.debug(`Skipping ${path} because it's larger than ${options.maxFileSize} bytes.`);
            return false;
        }

        if (options?.ignorePatterns?.length && match.some(path, options.ignorePatterns.map(normalizePattern), {})) {
            logger.debug(`Skipping ${path} because it's match some ignore patterns`);
            return false;
        }

        return true;
    };

    const tarOptions: tar.CreateOptions = {
        gzip: true, // perform the compression too
        filter: filterEntity,
        follow: true,
    };

    return new Promise<void>((resolve, reject) => {
        tar.create(tarOptions, [targetPath])
            //
            .pipe(createWriteStream(destinationPath))
            .on("finish", resolve)
            .on("error", reject);
    });
}

export async function extractObject(filePath: string, extractTo: string) {
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
