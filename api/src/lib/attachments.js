'use strict';
// Photos and files: check the browser's uploads, then move them into the ticket's own folder.

const { HeadObjectCommand, CopyObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { s3 } = require('./aws');
const { HttpError } = require('./http');
const { MAX_UPLOAD_BYTES } = require('./validation');

const BUCKET = () => process.env.ATTACHMENTS_BUCKET;

/** Every attachment must be one this user uploaded, and must really exist in the bucket. */
async function checkUploads(user, refs) {
  const ownPrefix = `uploads/${user.id}/`;
  const files = [];
  for (const a of refs || []) {
    if (!a.key.startsWith(ownPrefix) || a.key.includes('..')) throw new HttpError(400, 'One of the attachments is not valid.');
    let head;
    try {
      head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET(), Key: a.key }));
    } catch {
      throw new HttpError(400, `"${a.fileName}" did not finish uploading. Please attach it again.`);
    }
    if (head.ContentLength > MAX_UPLOAD_BYTES) throw new HttpError(400, `"${a.fileName}" is larger than 50 MB.`);
    files.push({ ...a, size: head.ContentLength, contentType: head.ContentType || a.contentType });
  }
  return files;
}

/** Copy checked uploads into tickets/<id>/ and record them. Call inside the transaction. */
async function attachUploads(conn, { ticketId, eventId, userId, files, stage }) {
  for (const f of files) {
    const finalKey = `tickets/${ticketId}/${f.key.split('/').pop()}`;
    await s3.send(new CopyObjectCommand({ Bucket: BUCKET(), Key: finalKey, CopySource: `${BUCKET()}/${encodeURIComponent(f.key)}` }));
    await conn.q(
      `INSERT INTO attachments (ticket_id, event_id, s3_key, file_name, content_type, size_bytes, stage, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [ticketId, eventId, finalKey, f.fileName, f.contentType, f.size, stage, userId],
    );
  }
}

/** After commit: remove the temporary copies. Best effort; the bucket also expires them after 7 days. */
function tidyUploads(files) {
  for (const f of files) s3.send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: f.key })).catch(() => {});
}

module.exports = { checkUploads, attachUploads, tidyUploads };
