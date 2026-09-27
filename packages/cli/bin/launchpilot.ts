#!/usr/bin/env node

import { Command } from 'commander';
import { createDeployCommand } from '../src/commands/deploy.js';
import { createAnalyzeCommand } from '../src/commands/analyze.js';
import { createEstimateCommand } from '../src/commands/estimate.js';
import { createSearchCommand } from '../src/commands/search.js';
import { createIndexCommand } from '../src/commands/index-cmd.js';
import { createArchitectureCommand } from '../src/commands/architecture.js';

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
program.addCommand(createArchitectureCommand());

program.parse();
