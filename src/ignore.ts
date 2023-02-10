import path from "path";
import { promises as fsPromises } from "fs";
import { excludeNil, normalizePattern } from "./utils";

// const FROM_FILE_PREFIX = "from-file:";

// export async function resolveIgnoreConfig(config: string, dir: string) {
//     const [rawPatterns, rawFiles] = partitionBy(parseIgnoreFileContent(config), (line) => !line.startsWith(FROM_FILE_PREFIX));

//     const commonPatterns = rawPatterns.map((r) => `*/**/${r}`);
//     const files = rawFiles.map((r) => r.replace(FROM_FILE_PREFIX, ""));

//     const collectedPatterns = await collectIgnoreFilePatterns(dir, files);

//     return [...commonPatterns, ...collectedPatterns];
// }

const parseIgnoreFileContent = (content: string) => {
    return content
        .split("\n")
        .filter((line) => line.length > 0 && line[0] !== "#")
        .map(normalizePattern);
};

const getIgnoreFilePatterns = async (ignoreFile: string): Promise<string[]> => {
    const content = await fsPromises.readFile(ignoreFile, "utf-8").catch(() => "");
    return parseIgnoreFileContent(content).map((line) => path.join(path.dirname(ignoreFile), line));
};

export async function collectIgnoreFilePatterns(relativeToPath: string, ignoreFiles: string[]): Promise<string[]> {
    const patterns = await Promise.all(ignoreFiles.map((ignoreFile) => getIgnoreFilePatterns(path.join(relativeToPath, ignoreFile))));
    const patternsSet = new Set(patterns.flat());

    const entries = await fsPromises.readdir(relativeToPath);
    const subDirs = await Promise.all(
        entries.map(async (entry) => {
            const entryPath = path.join(relativeToPath, entry);
            const entryStats = await fsPromises.lstat(entryPath);
            return entryStats.isDirectory() ? entryPath : null;
        })
    );

    const subDirPatterns = await Promise.all(
        excludeNil(subDirs)
            .filter((subDir) => !patternsSet.has(path.basename(subDir)))
            .map((subDir) => collectIgnoreFilePatterns(subDir, ignoreFiles))
    );

    return [...patterns, ...subDirPatterns].flat();
}
