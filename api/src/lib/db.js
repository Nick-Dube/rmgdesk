'use strict';
// MySQL access through RDS Proxy. Credentials come from Secrets Manager (cached for the life of the
// Lambda container). For local development set DB_USER / DB_PASSWORD / DB_HOST and DB_SSL=false.

const mysql = require('mysql2/promise');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

let poolPromise;

async function getCredentials() {
  if (process.env.DB_USER) {
    return { username: process.env.DB_USER, password: process.env.DB_PASSWORD || '' };
  }
  const client = new SecretsManagerClient({});
  const res = await client.send(new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN }));
  const secret = JSON.parse(res.SecretString);
  return { username: secret.username, password: secret.password };
}

function getPool() {
  if (!poolPromise) {
    poolPromise = (async () => {
      const creds = await getCredentials();
      return mysql.createPool({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        user: creds.username,
        password: creds.password,
        database: process.env.DB_NAME || 'rmgdesk',
        // RDS Proxy presents a certificate from Amazon's public CA, which Node trusts by default.
        ssl: process.env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: true },
        connectionLimit: 2, // one Lambda container handles one request at a time
        waitForConnections: true,
        timezone: 'Z',
        enableKeepAlive: true,
        decimalNumbers: true,
      });
    })().catch((err) => {
      poolPromise = undefined; // retry on the next request instead of caching the failure
      throw err;
    });
  }
  return poolPromise;
}

/** Run one statement. Returns rows for SELECT, the result header for INSERT/UPDATE. */
async function query(sql, params = []) {
  const pool = await getPool();
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** Run fn(conn) inside a transaction. conn.q(sql, params) returns rows like query(). */
async function withTransaction(fn) {
  const pool = await getPool();
  const conn = await pool.getConnection();
  conn.q = async (sql, params = []) => (await conn.execute(sql, params))[0];
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

async function closePool() {
  if (poolPromise) {
    const pool = await poolPromise;
    poolPromise = undefined;
    await pool.end();
  }
}

module.exports = { query, withTransaction, closePool };
