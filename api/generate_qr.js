import { createQrToken, QR_TTL_SECONDS, setApiHeaders } from './_qrToken.js';
import process from 'node:process';

export default function handler(request, response) {
  setApiHeaders(response);
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'POST') return response.status(405).json({ status: 'error', message: 'Method not allowed' });

  const secret = process.env.QR_SECRET;
  const adminKey = process.env.QR_ADMIN_KEY;
  if (!secret || secret.length < 32 || !adminKey || adminKey.length < 24) {
    return response.status(503).json({ status: 'error', message: 'QR service is not configured' });
  }
  if (request.headers['x-qr-admin-key'] !== adminKey) {
    return response.status(401).json({ status: 'error', message: 'Unauthorized' });
  }

  const studentId = String(request.body?.student_id || '').trim();
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(studentId)) {
    return response.status(400).json({ status: 'error', message: 'Invalid student_id' });
  }

  const token = createQrToken(studentId, secret);
  return response.status(200).json({ status: 'success', student_id: studentId, token, expires_in: QR_TTL_SECONDS });
}
