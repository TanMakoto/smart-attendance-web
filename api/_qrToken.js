import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

export const QR_TTL_SECONDS = 60;

const encode = (value) => Buffer.from(value).toString('base64url');
const sign = (payload, secret) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

export function createQrToken(studentId, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const payload = encode(JSON.stringify({ student_id: studentId, iat: nowSeconds, exp: nowSeconds + QR_TTL_SECONDS }));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyQrToken(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || token.length > 4096) throw new Error('invalid_token');
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) throw new Error('invalid_token');

  const expected = sign(payload, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('invalid_signature');
  }

  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!data.student_id || !Number.isInteger(data.exp) || nowSeconds >= data.exp) throw new Error('expired_token');
  return data;
}

export function setApiHeaders(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-qr-admin-key');
}
