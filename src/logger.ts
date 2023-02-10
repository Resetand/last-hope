import winston from "winston";

const logLevels = {
    fatal: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
    trace: 5,
};

const myFormat = winston.format.printf(({ timestamp, level, message, ...other }) => {
    return `${timestamp} [${level}] ${message} ${Object.keys(other).length > 0 ? "\n" + JSON.stringify(other, null, 2) : ""}`;
});

const format = winston.format.combine(
    winston.format.simple(),
    winston.format.colorize(),
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.json(),
    myFormat
);

const logger = winston.createLogger({
    levels: logLevels,
    level: "debug",
    handleExceptions: true,

    exitOnError: false,
    silent: process.env.LOGGER !== "true",
    transports: [new winston.transports.Console({ format })],
});

export default logger;
