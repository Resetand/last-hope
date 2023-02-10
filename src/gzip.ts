import * as fs from "fs";
import match from "micromatch";
import tar from "tar";
import logger from "./logger";
import { normalizePattern } from "./utils";

type GzipDirectoryOptions = {
    ignorePatterns?: string[];
    maxFileSize: number;
    destination: string;
};

export async function gzip(targetPath: string, options: GzipDirectoryOptions) {
    const filterEntity = (path: string, stat: tar.FileStat) => {
        if (stat.size > options.maxFileSize) {
            logger.debug(`Skipping ${path} because it's larger than ${options.maxFileSize} bytes.`);
            return false;
        }

        if (options.ignorePatterns?.length && match.some(path, options.ignorePatterns.map(normalizePattern), {})) {
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

    tar.create(tarOptions, [targetPath]).pipe(fs.createWriteStream(options.destination));
}
