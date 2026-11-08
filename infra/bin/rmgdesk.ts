#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { RmgDeskStack } from '../lib/rmgdesk-stack';
import { environments } from '../lib/config';

const app = new App();
const envName = app.node.tryGetContext('env') ?? 'prod';
const config = environments[envName];
if (!config) {
  throw new Error(`Unknown env "${envName}". Use -c env=prod or -c env=staging`);
}

new RmgDeskStack(app, `RmgDesk-${config.name}`, {
  config,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: config.region },
  description: `RMG Helpdesk (${config.name}) - Vertex Services Group`,
  terminationProtection: config.retainData,
});
