'use strict';
// POST /uploads - returns a presigned URL so the browser uploads a photo straight to the private bucket.
// The file lands under uploads/<userId>/ and is only kept if a ticket claims it within 7 days.

const crypto = require('crypto');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { wrap, json, parseBody } = require('../lib/http');
const { resolveUser } = require('../lib/users');
const { uploadRequestSchema, ALLOWED_UPLOAD_TYPES } = require('../lib/validation');
const { s3 } = require('../lib/aws');

exports.handler = wrap(async (event) => {
  const user = await resolveUser(event);
  const input = uploadRequestSchema.parse(parseBody(event));
  const key = `uploads/${user.id}/${crypto.randomUUID()}${ALLOWED_UPLOAD_TYPES[input.contentType]}`;
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: process.env.ATTACHMENTS_BUCKET, Key: key, ContentType: input.contentType }),
    { expiresIn: 300 },
  );
  return json(200, { key, url, expiresIn: 300 });
});
