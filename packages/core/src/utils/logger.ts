import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';

let currentLevel: LogLevel = 'info';

const levelOrder: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  success: 1,
};

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return levelOrder[level] >= levelOrder[currentLevel];
}

export const logger = {
  debug(message: string, context?: string): void {
    if (!shouldLog('debug')) return;
    const prefix = context ? chalk.gray(`[${context}] `) : '';
    console.log(`${prefix}${chalk.dim(message)}`);
  },

  info(message: string, context?: string): void {
    if (!shouldLog('info')) return;
    const prefix = context ? chalk.blue(`[${context}] `) : '';
    console.log(`${prefix}${message}`);
  },

  warn(message: string, context?: string): void {
    if (!shouldLog('warn')) return;
    const prefix = context ? chalk.yellow(`[${context}] `) : '';
    console.warn(`${prefix}${chalk.yellow(message)}`);
  },

  error(message: string, context?: string): void {
    if (!shouldLog('error')) return;
    const prefix = context ? chalk.red(`[${context}] `) : '';
    console.error(`${prefix}${chalk.red(message)}`);
  },

  success(message: string, context?: string): void {
    if (!shouldLog('success')) return;
    const prefix = context ? chalk.green(`[${context}] `) : '';
    console.log(`${prefix}${chalk.green(message)}`);
  },

  banner(title: string): void {
    console.log('');
    console.log(chalk.bold.cyan(`  ${'─'.repeat(50)}`));
    console.log(chalk.bold.cyan(`  ${title}`));
    console.log(chalk.bold.cyan(`  ${'─'.repeat(50)}`));
    console.log('');
  },
};
