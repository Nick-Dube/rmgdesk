'use strict';
// Shared AWS clients, created once per Lambda container.

const { S3Client } = require('@aws-sdk/client-s3');
const { SQSClient } = require('@aws-sdk/client-sqs');

const s3 = new S3Client({});
const sqs = new SQSClient({});

module.exports = { s3, sqs };
