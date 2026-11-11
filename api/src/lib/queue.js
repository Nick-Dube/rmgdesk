'use strict';
// Hand work to a background queue. A failure is logged, never thrown: the user's change is already saved,
// and losing an email must not turn a successful request into an error.

const { SendMessageCommand } = require('@aws-sdk/client-sqs');
const { sqs } = require('./aws');

async function enqueue(queueUrl, message) {
  if (!queueUrl) return false;
  try {
    await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
    return true;
  } catch (err) {
    console.log(JSON.stringify({ level: 'error', message: 'Could not queue background work', queued: message, error: err.message }));
    return false;
  }
}

const notify = (message) => enqueue(process.env.NOTIFICATIONS_QUEUE_URL, message);
const integrate = (message) => enqueue(process.env.INTEGRATIONS_QUEUE_URL, message);

module.exports = { enqueue, notify, integrate };
