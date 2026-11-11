import * as path from 'path';
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { EnvConfig } from './config';

const API_ROOT = path.join(__dirname, '..', '..', 'api');
const DB_NAME = 'rmgdesk';

export interface RmgDeskStackProps extends StackProps {
  config: EnvConfig;
}

export class RmgDeskStack extends Stack {
  constructor(scope: Construct, id: string, props: RmgDeskStackProps) {
    super(scope, id, props);
    const cfg = props.config;
    const prefix = `rmgdesk-${cfg.name}`;
    const removal = cfg.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    // Tags let AWS Budgets and Cost Explorer split costs by environment. (Proxy target groups reject tags.)
    const tagOpts = { excludeResourceTypes: ['AWS::RDS::DBProxyTargetGroup'] };
    Tags.of(this).add('project', 'rmgdesk', tagOpts);
    Tags.of(this).add('environment', cfg.name, tagOpts);
    Tags.of(this).add('cost-centre', 'VTX900', tagOpts);

    // ---------------------------------------------------------------- Alerts
    const alerts = new sns.Topic(this, 'Alerts', { topicName: `${prefix}-alerts` });
    alerts.addSubscription(new subs.EmailSubscription(cfg.alertEmail));

    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `${prefix}-monthly`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: cfg.monthlyBudgetUsd, unit: 'USD' },
        costFilters: { TagKeyValue: [`user:environment$${cfg.name}`] },
      },
      notificationsWithSubscribers: [
        {
          notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 80 },
          subscribers: [{ subscriptionType: 'EMAIL', address: cfg.alertEmail }],
        },
      ],
    });

    // --------------------------------------------------------------- Network
    const vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: prefix,
      maxAzs: 2,
      natGateways: cfg.natGateways,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'app', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    // Free gateway endpoint: S3 traffic from Lambdas skips the NAT gateway.
    vpc.addGatewayEndpoint('S3Endpoint', { service: ec2.GatewayVpcEndpointAwsService.S3 });

    const lambdaSg = new ec2.SecurityGroup(this, 'LambdaSg', { vpc, description: 'RMG Desk Lambdas' });
    const bastionSg = new ec2.SecurityGroup(this, 'BastionSg', { vpc, description: 'RMG Desk SSM bastion' });
    const dbSg = new ec2.SecurityGroup(this, 'DbSg', { vpc, description: 'RMG Desk database', allowAllOutbound: false });

    // -------------------------------------------------------------- Database
    const db = new rds.DatabaseInstance(this, 'Database', {
      instanceIdentifier: prefix,
      engine: rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_4_7 }),
      instanceType: new ec2.InstanceType(cfg.dbInstanceClass),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      databaseName: DB_NAME,
      credentials: rds.Credentials.fromGeneratedSecret('rmgadmin', { secretName: `${prefix}/db-admin` }),
      multiAz: cfg.dbMultiAz,
      allocatedStorage: cfg.dbAllocatedStorageGb,
      maxAllocatedStorage: 200,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      backupRetention: Duration.days(cfg.dbBackupDays),
      deletionProtection: cfg.retainData,
      removalPolicy: cfg.retainData ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
      autoMinorVersionUpgrade: true,
      cloudwatchLogsExports: ['error', 'slowquery'],
      cloudwatchLogsRetention: logs.RetentionDays.THREE_MONTHS,
      parameterGroup: new rds.ParameterGroup(this, 'DbParams', {
        engine: rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_4_7 }),
        parameters: {
          character_set_server: 'utf8mb4',
          collation_server: 'utf8mb4_0900_ai_ci',
          time_zone: 'UTC',
          require_secure_transport: '1',
          slow_query_log: '1',
          long_query_time: '2',
        },
      }),
    });

    const proxy = db.addProxy('Proxy', {
      dbProxyName: prefix,
      secrets: [db.secret!],
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      requireTLS: true,
    });

    // The proxy shares dbSg: allow it to reach the instance, and allow Lambdas to reach the proxy.
    dbSg.addIngressRule(dbSg, ec2.Port.tcp(3306), 'Proxy to database');
    dbSg.addEgressRule(dbSg, ec2.Port.tcp(3306), 'Proxy to database');
    dbSg.addIngressRule(lambdaSg, ec2.Port.tcp(3306), 'Lambdas to proxy');
    dbSg.addIngressRule(bastionSg, ec2.Port.tcp(3306), 'Bastion to database (MySQL Workbench, migrations)');

    // A tiny instance with no SSH and no public IP. You reach it only through AWS Systems Manager,
    // to forward a local port to the database for MySQL Workbench and dbmate.
    const bastion = new ec2.BastionHostLinux(this, 'Bastion', {
      vpc,
      instanceName: `${prefix}-bastion`,
      subnetSelection: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: new ec2.InstanceType('t4g.nano'),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 }),
      securityGroup: bastionSg,
    });

    // ------------------------------------------------------- Secrets (yours to fill)
    const evolutionSecret = new secrets.Secret(this, 'EvolutionSecret', {
      secretName: `${prefix}/mri-evolution`,
      description: 'MRI Evolution workflow REST endpoint and web service credentials. Fill in url/username/password in the console.',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          url: 'https://vertex.fsicloud.com/Evolution/webservices/workflowrest.aspx',
          workflow: 'RMGRaiseTask',
          username: 'CHANGE_ME',
          enabled: false,
        }),
        generateStringKey: 'password',
      },
    });

    // ------------------------------------------------------------ Attachments
    const attachments = new s3.Bucket(this, 'Attachments', {
      bucketName: `${prefix}-attachments-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: cfg.retainData,
      removalPolicy: removal,
      autoDeleteObjects: !cfg.retainData,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: cfg.appOrigins,
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: Duration.days(1) },
        // Uploads never attached to a ticket are removed after 7 days.
        { prefix: 'uploads/', expiration: Duration.days(7) },
      ],
    });

    // ----------------------------------------------------------------- Queues
    const integrationsDlq = new sqs.Queue(this, 'IntegrationsDlq', {
      queueName: `${prefix}-integrations-dlq`,
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    });
    const integrationsQueue = new sqs.Queue(this, 'IntegrationsQueue', {
      queueName: `${prefix}-integrations`,
      visibilityTimeout: Duration.seconds(120),
      deadLetterQueue: { queue: integrationsDlq, maxReceiveCount: 5 },
      enforceSSL: true,
    });

    const notificationsDlq = new sqs.Queue(this, 'NotificationsDlq', {
      queueName: `${prefix}-notifications-dlq`,
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    });
    const notificationsQueue = new sqs.Queue(this, 'NotificationsQueue', {
      queueName: `${prefix}-notifications`,
      visibilityTimeout: Duration.seconds(120),
      deadLetterQueue: { queue: notificationsDlq, maxReceiveCount: 5 },
      enforceSSL: true,
    });

    // ------------------------------------------------------------ Email (SES)
    if (cfg.createSesIdentity) {
      const identity = new ses.EmailIdentity(this, 'EmailIdentity', {
        identity: ses.Identity.domain(cfg.emailDomain),
        mailFromDomain: `mail.${cfg.emailDomain}`,
      });
      identity.dkimRecords.forEach((rec, i) => {
        new CfnOutput(this, `DkimRecord${i + 1}`, {
          value: `CNAME  ${rec.name}  ->  ${rec.value}`,
          description: 'Add to Cloudflare as a DNS-only CNAME',
        });
      });
    }

    // ----------------------------------------------------------------- Lambdas
    const common: Partial<nodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(15),
      projectRoot: API_ROOT,
      depsLockFilePath: path.join(API_ROOT, 'package-lock.json'),
      // Bundle our code with mysql2 and zod; use the AWS SDK v3 that ships in the Node.js 22 runtime.
      // Not minified, so the code stays readable in the Lambda console (which cannot open files over 3 MB);
      // source maps point errors at the original file and line in api/src.
      // Never edit code in the console: the next deploy overwrites it.
      bundling: {
        format: nodejs.OutputFormat.CJS,
        target: 'node22',
        minify: false,
        keepNames: true,
        sourceMap: true,
        sourcesContent: false,
        externalModules: ['@aws-sdk/*'],
        banner: '/* RMG Desk API - generated from api/src by CDK. Do not edit here: change the repo and deploy. */',
      },
      tracing: lambda.Tracing.ACTIVE,
    };
    const inVpc: Partial<nodejs.NodejsFunctionProps> = {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSg],
    };
    const dbEnv = {
      DB_HOST: proxy.endpoint,
      DB_NAME,
      DB_SECRET_ARN: db.secret!.secretArn,
      ATTACHMENTS_BUCKET: attachments.bucketName,
      INTEGRATIONS_QUEUE_URL: integrationsQueue.queueUrl,
      NOTIFICATIONS_QUEUE_URL: notificationsQueue.queueUrl,
      ENV_NAME: cfg.name,
      APP_URL: cfg.appOrigins[0],
      NODE_OPTIONS: '--enable-source-maps',
    };

    // Every function gets its own log group, kept for 3 months.
    const makeFn = (id: string, entry: string, props: Partial<nodejs.NodejsFunctionProps>) => {
      const functionName = `${prefix}-${id.toLowerCase()}`;
      const logGroup = new logs.LogGroup(this, `${id}Logs`, {
        logGroupName: `/aws/lambda/${functionName}`,
        retention: logs.RetentionDays.THREE_MONTHS,
        removalPolicy: removal,
      });
      return new nodejs.NodejsFunction(this, id, {
        ...common,
        functionName,
        logGroup,
        entry: path.join(API_ROOT, 'src', 'handlers', entry),
        handler: 'handler',
        ...props,
      });
    };
    const fn = (id: string, entry: string, extra: Partial<nodejs.NodejsFunctionProps> = {}) =>
      makeFn(id, entry, { ...inVpc, environment: dbEnv, ...extra });

    const healthFn = makeFn('Health', 'health.js', { environment: { ENV_NAME: cfg.name } });
    const meFn = fn('Me', 'me.js');
    const referenceFn = fn('Reference', 'reference.js');
    const ticketsFn = fn('Tickets', 'tickets.js');
    const uploadsFn = fn('Uploads', 'uploads.js');
    const evolutionWorker = fn('EvolutionWorker', 'evolutionWorker.js', {
      timeout: Duration.seconds(60),
      environment: { ...dbEnv, EVOLUTION_SECRET_ARN: evolutionSecret.secretArn },
    });

    const notifier = fn('Notifier', 'notifier.js', {
      timeout: Duration.seconds(60),
      environment: {
        ...dbEnv,
        EMAIL_FROM: `RMG Helpdesk <${cfg.fromAddress}>`,
        EMAIL_MODE: cfg.emailMode,
        EMAIL_REDIRECT_TO: cfg.emailRedirectTo,
      },
    });
    attachments.grantRead(notifier); // photos are embedded in the email
    notifier.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: [`arn:aws:ses:${this.region}:${this.account}:identity/*`],
      }),
    );
    notificationsQueue.grantSendMessages(ticketsFn);
    notifier.addEventSource(new SqsEventSource(notificationsQueue, { batchSize: 1, reportBatchItemFailures: true }));

    for (const f of [meFn, referenceFn, ticketsFn, uploadsFn, evolutionWorker, notifier]) {
      db.secret!.grantRead(f);
    }
    attachments.grantPut(uploadsFn);
    attachments.grantReadWrite(ticketsFn); // check uploads, copy them into the ticket's folder
    attachments.grantDelete(ticketsFn); // remove the temporary upload afterwards
    integrationsQueue.grantSendMessages(ticketsFn);
    evolutionSecret.grantRead(evolutionWorker);
    evolutionWorker.addEventSource(new SqsEventSource(integrationsQueue, { batchSize: 1, reportBatchItemFailures: true }));

    // Runs before Cognito accepts a self sign-up. Not in the VPC: it needs no database.
    const preSignUpFn = makeFn('PreSignUp', 'preSignUp.js', {
      timeout: Duration.seconds(5),
      environment: { SELF_SIGNUP_DOMAINS: cfg.selfSignupDomains.join(',') },
    });

    // ------------------------------------------------------------------ Cognito
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: prefix,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      selfSignUpEnabled: true,
      autoVerify: { email: true },
      keepOriginal: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: true, mutable: true },
        phoneNumber: { required: false, mutable: true },
      },
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { otp: true, sms: true },
      mfaMessage: 'Your RMG Helpdesk code is {####}',
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
        tempPasswordValidity: Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      deletionProtection: cfg.retainData,
      removalPolicy: removal,
      lambdaTriggers: { preSignUp: preSignUpFn },
      userVerification: {
        emailSubject: 'Your RMG Helpdesk verification code',
        emailBody: 'Your RMG Helpdesk verification code is {####}',
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      userInvitation: {
        emailSubject: 'You have been invited to the RMG Helpdesk',
        emailBody:
          'Hello {username},<br><br>You now have access to the RMG Helpdesk at https://app.rmgdesk.com.<br>Your temporary password is <b>{####}</b>. You will be asked to change it and set up two-step verification when you first sign in.',
      },
      email: cfg.cognitoEmailViaSes
        ? cognito.UserPoolEmail.withSES({
            fromEmail: cfg.fromAddress,
            fromName: 'RMG Helpdesk',
            sesRegion: cfg.region,
            sesVerifiedDomain: cfg.emailDomain,
          })
        : cognito.UserPoolEmail.withCognito(),
    });

    const webClient = userPool.addClient('WebClient', {
      userPoolClientName: `${prefix}-web`,
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      enableTokenRevocation: true,
    });

    // ------------------------------------------------------------------- API
    const authorizer = new HttpJwtAuthorizer(
      'CognitoAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [webClient.userPoolClientId] },
    );

    const api = new apigw.HttpApi(this, 'HttpApi', {
      apiName: prefix,
      corsPreflight: {
        allowOrigins: cfg.appOrigins,
        allowMethods: [apigw.CorsHttpMethod.ANY],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: Duration.hours(1),
      },
      defaultAuthorizer: authorizer,
    });

    api.addRoutes({
      path: '/health',
      methods: [apigw.HttpMethod.GET],
      integration: new HttpLambdaIntegration('HealthInt', healthFn),
      authorizer: new apigw.HttpNoneAuthorizer(),
    });
    api.addRoutes({ path: '/me', methods: [apigw.HttpMethod.GET], integration: new HttpLambdaIntegration('MeInt', meFn) });
    api.addRoutes({
      path: '/reference',
      methods: [apigw.HttpMethod.GET],
      integration: new HttpLambdaIntegration('RefInt', referenceFn),
    });
    const ticketsInt = new HttpLambdaIntegration('TicketsInt', ticketsFn);
    api.addRoutes({ path: '/tickets', methods: [apigw.HttpMethod.GET, apigw.HttpMethod.POST], integration: ticketsInt });
    api.addRoutes({ path: '/tickets/{id}', methods: [apigw.HttpMethod.GET], integration: ticketsInt });
    api.addRoutes({ path: '/tickets/{id}/comments', methods: [apigw.HttpMethod.POST], integration: ticketsInt });
    api.addRoutes({
      path: '/uploads',
      methods: [apigw.HttpMethod.POST],
      integration: new HttpLambdaIntegration('UploadsInt', uploadsFn),
    });

    // ------------------------------------------------------------- Alarms
    const alarm = (id: string, metric: cw.IMetric, description: string) => {
      const a = new cw.Alarm(this, id, {
        metric,
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
        alarmDescription: description,
      });
      a.addAlarmAction(new cwActions.SnsAction(alerts));
    };
    alarm(
      'DlqAlarm',
      integrationsDlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5) }),
      'A message reached the integrations dead-letter queue: a ticket did not reach MRI Evolution.',
    );
    alarm(
      'NotificationsDlqAlarm',
      notificationsDlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5) }),
      'A message reached the notifications dead-letter queue: new-ticket emails were not sent.',
    );
    for (const [id, f] of [['TicketsErrors', ticketsFn], ['EvolutionErrors', evolutionWorker], ['NotifierErrors', notifier]] as const) {
      alarm(`${id}Alarm`, f.metricErrors({ period: Duration.minutes(5) }), `${f.node.id} Lambda errors`);
    }

    // ------------------------------------------------------------- Outputs
    const out = (id: string, value: string, description?: string) => new CfnOutput(this, id, { value, description });
    out('ApiUrl', api.apiEndpoint, 'NEXT_PUBLIC_API_URL');
    out('UserPoolId', userPool.userPoolId, 'NEXT_PUBLIC_USER_POOL_ID');
    out('UserPoolClientId', webClient.userPoolClientId, 'NEXT_PUBLIC_USER_POOL_CLIENT_ID');
    out('AttachmentsBucket', attachments.bucketName);
    out('DbEndpoint', db.dbInstanceEndpointAddress, 'Tunnel target for MySQL Workbench and dbmate');
    out('DbProxyEndpoint', proxy.endpoint);
    out('DbSecretArn', db.secret!.secretArn, 'Admin username and password for the database');
    out('BastionInstanceId', bastion.instanceId, 'Use with aws ssm start-session for the database tunnel');
    out('EvolutionSecretArn', evolutionSecret.secretArn, 'Fill in the MRI Evolution credentials here');
    out('IntegrationsDlqUrl', integrationsDlq.queueUrl);
  }
}
