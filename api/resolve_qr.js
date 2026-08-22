import { setApiHeaders, verifyQrToken } from './_qrToken.js';
import process from 'node:process';

export default function handler(request, response) {
  setApiHeaders(response);
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'GET') return response.status(405).json({ status: 'error', message: 'Method not allowed' });

  const secret = process.env.QR_SECRET;
  if (!secret || secret.length < 32) {
    return response.status(503).json({ status: 'error', message: 'QR service is not configured' });
  }

  try {
    const data = verifyQrToken(request.query?.token, secret);
    return response.status(200).json({ status: 'success', student_id: data.student_id, expires_at: data.exp });
  } catch (error) {
    const expired = error?.message === 'expired_token';
    return response.status(expired ? 410 : 400).json({
      status: 'error',
      message: expired ? 'QR code expired' : 'Invalid QR code'
    });
  }
}
