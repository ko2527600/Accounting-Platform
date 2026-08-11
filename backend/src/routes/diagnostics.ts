import { Router, Request, Response } from 'express';
import nodemailer from 'nodemailer';
import { BroadcastService } from '../services/broadcastService';

const router = Router();

interface SmtpAttemptResult {
  port: number;
  secure: boolean;
  ok: boolean;
  error?: string;
}

async function attemptSmtpSend(port: number, secure: boolean, to: string): Promise<SmtpAttemptResult> {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port,
    secure,
    requireTLS: !secure,
    connectionTimeout: 10000,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject: `Ledgio SMTP diagnostic (port ${port})`,
      text: `Direct SMTP send succeeded on port ${port} at ${new Date().toISOString()}.`,
    });
    return { port, secure, ok: true };
  } catch (error: any) {
    return { port, secure, ok: false, error: error?.message || String(error) };
  }
}

/**
 * One-off diagnostic to empirically re-check whether Render's outbound SMTP
 * block (documented in STATUS.md - ETIMEDOUT on both 465 and 587, which is
 * why the app moved to SendGrid's HTTP API) still applies now that billing
 * is active. Not part of the app's real send path - EmailService/SendGrid
 * is unaffected either way. Remove once the question is answered.
 */
router.post('/test-smtp', async (req: Request, res: Response): Promise<void> => {
  const { passcode, to } = req.body;

  if (!passcode || !BroadcastService.verifyPasscode(passcode)) {
    res.status(401).json({ success: false, error: 'Unauthorized: valid master passcode required.' });
    return;
  }

  if (!to) {
    res.status(400).json({ success: false, error: '"to" (recipient email) is required.' });
    return;
  }

  if (!process.env.EMAIL_USER?.trim() || !process.env.EMAIL_PASS?.trim()) {
    res.status(400).json({
      success: false,
      error: 'EMAIL_USER and EMAIL_PASS must be set (Gmail address + 16-character App Password) to run this diagnostic.',
    });
    return;
  }

  const results = [
    await attemptSmtpSend(465, true, to),
    await attemptSmtpSend(587, false, to),
  ];

  res.status(200).json({ success: results.some((r) => r.ok), results });
});

export default router;
