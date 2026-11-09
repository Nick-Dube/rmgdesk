// Per-environment settings. Change values here, never inside the stack.
// Select an environment with:  npx cdk deploy -c env=prod   (or -c env=staging)

export interface EnvConfig {
  /** Short name used in resource names: rmgdesk-<name>-... */
  name: 'prod' | 'staging';
  region: string;
  /** Web addresses allowed to call the API (CORS) and to upload photos. */
  appOrigins: string[];
  /** Email for alarms and the monthly budget warning. */
  alertEmail: string;
  /** Monthly AWS budget in USD; a warning email goes out at 80%. */
  monthlyBudgetUsd: number;

  // Database
  dbInstanceClass: string; // e.g. 't4g.small'
  dbMultiAz: boolean;
  dbBackupDays: number;
  dbAllocatedStorageGb: number;

  // Network
  natGateways: number;

  // Sign-in
  /** Email domains allowed to register themselves (as Requesters). */
  selfSignupDomains: string[];
  /**
   * Send Cognito emails (codes, invites) through SES as no-reply@rmgdesk.com.
   * Leave false for the first deploy; switch to true once the SES domain is verified.
   */
  cognitoEmailViaSes: boolean;

  // Email
  /** Create the SES identity for rmgdesk.com. Only ONE environment should own it (prod). */
  createSesIdentity: boolean;
  emailDomain: string;
  fromAddress: string;

  // Protection
  /** Protect the database and user pool from accidental deletion. */
  retainData: boolean;
}

export const environments: Record<string, EnvConfig> = {
  prod: {
    name: 'prod',
    region: 'eu-west-2',
    appOrigins: ['https://app.rmgdesk.com', 'http://localhost:3000'],
    alertEmail: 'nick.dube@vertex.net',
    monthlyBudgetUsd: 300,
    dbInstanceClass: 't4g.small',
    dbMultiAz: false, // switch to true before the pilot
    dbBackupDays: 14,
    dbAllocatedStorageGb: 20,
    natGateways: 1,
    selfSignupDomains: ['rmg.co.uk', 'vertex.net'],
    cognitoEmailViaSes: true,
    createSesIdentity: true,
    emailDomain: 'rmgdesk.com',
    fromAddress: 'no-reply@rmgdesk.com',
    retainData: true,
  },
  staging: {
    name: 'staging',
    region: 'eu-west-2',
    appOrigins: ['https://staging.rmgdesk.com', 'http://localhost:3000'],
    alertEmail: 'nick.dube@vertex.net',
    monthlyBudgetUsd: 120,
    dbInstanceClass: 't4g.micro',
    dbMultiAz: false,
    dbBackupDays: 1,
    dbAllocatedStorageGb: 20,
    natGateways: 1,
    selfSignupDomains: ['vertex.net'],
    cognitoEmailViaSes: true,
    createSesIdentity: false,
    emailDomain: 'rmgdesk.com',
    fromAddress: 'no-reply@rmgdesk.com',
    retainData: false,
  },
};
