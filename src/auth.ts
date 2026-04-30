import { Request, Response, NextFunction } from 'express';

declare module 'express-session' {
  interface SessionData {
    authenticated?: boolean;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.authenticated) {
    next();
    return;
  }
  res.redirect('/admin/login');
}

export function loginHandler(req: Request, res: Response): void {
  const { password } = req.body as { password: string };
  const adminPassword = process.env.ADMIN_PASSWORD || 'clippy';

  if (password === adminPassword) {
    req.session.authenticated = true;
    res.redirect('/admin');
  } else {
    res.redirect('/admin/login?error=1');
  }
}

export function logoutHandler(req: Request, res: Response): void {
  req.session.destroy(() => res.redirect('/admin/login'));
}
