import ora, { Ora } from 'ora';
import cliProgress from 'cli-progress';
import chalk from 'chalk';

export function createSpinner(text: string): Ora {
  return ora({
    text,
    color: 'cyan',
    spinner: 'dots',
  });
}

export function createProgressBar(total: number, label: string = 'Deploying'): cliProgress.SingleBar {
  const bar = new cliProgress.SingleBar({
    format: `  ${chalk.cyan(label)} ${chalk.cyan('{bar}')} {percentage}% | {value}/{total} | {task}`,
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true,
    clearOnComplete: false,
  });

  bar.start(total, 0, { task: 'Initializing...' });
  return bar;
}
