export enum LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
    None = 4,
}

export class Logger {
    private static _level: LogLevel = LogLevel.Info;
    private static readonly PREFIX = '[Spector.GPU]';

    public static setLevel(level: LogLevel): void {
        Logger._level = level;
    }

    public static debug(...args: unknown[]): void {
        if (Logger._level <= LogLevel.Debug) {
            console.debug(Logger.PREFIX, ...args);
        }
    }

    public static info(...args: unknown[]): void {
        if (Logger._level <= LogLevel.Info) {
            console.info(Logger.PREFIX, ...args);
        }
    }

    public static warn(...args: unknown[]): void {
        if (Logger._level <= LogLevel.Warn) {
            console.warn(Logger.PREFIX, ...args);
        }
    }

    public static error(...args: unknown[]): void {
        if (Logger._level <= LogLevel.Error) {
            console.error(Logger.PREFIX, ...args);
        }
    }
}
