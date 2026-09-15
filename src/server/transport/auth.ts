import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { parse, serialize } from 'cookie';
import type { Request, Response } from 'express';

const COOKIE = 'pictionary_admin';

export class AdminAuth {
  private failures = new Map<string, { count: number; resetAt: number }>();

  constructor(private adminCode: string, private secret: string, private secure: boolean) {
    if (adminCode.length < 8) throw new Error('ADMIN_CODE debe tener al menos 8 caracteres.');
    if (secret.length < 32) throw new Error('SESSION_SECRET debe tener al menos 32 caracteres.');
  }

  login(req: Request, res: Response): boolean {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const attempt = this.failures.get(ip);
    if (attempt && attempt.resetAt > now && attempt.count >= 5) {
      res.status(429).json({ ok: false, code: 'RATE_LIMIT', message: 'Demasiados intentos. Espera 15 minutos.' });
      return false;
    }
    const supplied = typeof req.body?.code === 'string' ? req.body.code : '';
    const valid = supplied.length === this.adminCode.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(this.adminCode));
    if (!valid) {
      const current = attempt && attempt.resetAt > now ? attempt : { count: 0, resetAt: now + 15 * 60_000 };
      current.count++;
      this.failures.set(ip, current);
      res.status(401).json({ ok: false, code: 'INVALID_CODE', message: 'Código incorrecto.' });
      return false;
    }
    this.failures.delete(ip);
    const payload = `${now + 12 * 60 * 60_000}.${randomBytes(16).toString('base64url')}`;
    const token = `${payload}.${this.sign(payload)}`;
    res.setHeader('Set-Cookie', serialize(COOKIE, token, {
      httpOnly: true, secure: this.secure, sameSite: 'strict', path: '/', maxAge: 12 * 60 * 60,
    }));
    res.json({ ok: true });
    return true;
  }

  logout(res: Response): void {
    res.setHeader('Set-Cookie', serialize(COOKIE, '', { httpOnly: true, secure: this.secure, sameSite: 'strict', path: '/', maxAge: 0 }));
    res.json({ ok: true });
  }

  validCookie(header?: string): boolean {
    const token = parse(header ?? '')[COOKIE];
    if (!token) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const payload = `${parts[0]}.${parts[1]}`;
    const expected = this.sign(payload);
    if (expected.length !== parts[2].length || !timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return false;
    return Number(parts[0]) > Date.now();
  }

  private sign(payload: string): string { return createHmac('sha256', this.secret).update(payload).digest('base64url'); }
}
