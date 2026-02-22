#!/usr/bin/env node

import { Command } from 'commander';
import { createDeployCommand } from '../src/cli/commands/deploy.js';
import { createAnalyzeCommand } from '../src/cli/commands/analyze.js';
import { createEstimateCommand } from '../src/cli/commands/estimate.js';
import { createSearchCommand } from '../src/cli/commands/search.js';
import { createIndexCommand } from '../src/cli/commands/index-cmd.js';

const program = new Command();

program
  .name('launchpilot')
  .description('Deploy vibe-coded apps to production infrastructure with security hardening and cost optimization')
  .version('0.1.0');

program.addCommand(createDeployCommand());
program.addCommand(createAnalyzeCommand());
program.addCommand(createEstimateCommand());
program.addCommand(createSearchCommand());
program.addCommand(createIndexCommand());

program.parse();
