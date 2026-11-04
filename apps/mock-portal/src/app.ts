import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import * as T from './templates.js';
import { defaultChildren } from './seed.js';

/**
 * Mock GestIB portal (SPEC §16). A state machine that simulates the two-step idp login,
 * overnight-style session expiry, lockout after M failures, forced password changes,
 * multi-child switching and recorded submissions. Behaviour is configured per test.
 */

export interface MockAccount {
  username: string;
  password: string;
  mode?: 'ok' | 'forced_change' | 'expired' | 'captcha';
  children?: T.MockChild[];
}

export interface MockConfig {
  accounts: MockAccount[];
  sessionTtlMs: number;
  lockoutAfter: number;
  latencyMs: number;
  /** When true every page returns 503 (simulates PORTAL_DOWN). */
  down: boolean;
}

interface Session {
  username: string;
  expiresAt: number;
  childRef: string;
}

export interface MockState {
  loginAttempts: { username: string; ok: boolean; at: number }[];
  failures: Map<string, number>;
  locked: Set<string>;
  sessions: Map<string, Session>;
  pending: Map<string, string>;
  submissions: { id: string; username: string; childRef: string; itemRef: string; text: string }[];
  mutatingRequests: number;
}

export function createMockPortal(partial: Partial<MockConfig> = {}): {
  app: Express;
  state: MockState;
  config: MockConfig;
} {
  const config: MockConfig = {
    accounts: [{ username: 'parent1', password: 'escola123' }],
    sessionTtlMs: 60 * 60 * 1000,
    lockoutAfter: 3,
    latencyMs: 0,
    down: false,
    ...partial,
  };
  const state: MockState = {
    loginAttempts: [],
    failures: new Map(),
    locked: new Set(),
    sessions: new Map(),
    pending: new Map(),
    submissions: [],
    mutatingRequests: 0,
  };

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  const cookie = (req: Request, name: string) =>
    (req.headers.cookie ?? '')
      .split(';')
      .map((c) => c.trim().split('='))
      .find(([k]) => k === name)?.[1];

  const account = (u: string) => config.accounts.find((a) => a.username === u);
  const childrenOf = (u: string) => account(u)?.children ?? defaultChildren();

  // ---- test control plane ----
  app.get('/__mock/state', (_req, res) =>
    res.json({
      loginAttempts: state.loginAttempts,
      submissions: state.submissions,
      locked: [...state.locked],
      sessions: state.sessions.size,
      mutatingRequests: state.mutatingRequests,
    }),
  );
  app.post('/__mock/expire-sessions', (_req, res) => {
    state.sessions.clear();
    res.json({ ok: true });
  });
  app.post('/__mock/config', (req, res) => {
    Object.assign(config, req.body);
    res.json({ ok: true });
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/__mock')) return next();
    if (config.down) return res.status(503).send(T.downPage());
    if (req.method === 'POST' && req.path.startsWith('/families/') && req.path !== '/families/otherStudents')
      state.mutatingRequests++;
    setTimeout(next, config.latencyMs);
  });

  // ---- idp: two-step login ----
  app.get('/idp/usernameForm', (_req, res) => res.send(T.usernamePage()));
  app.post('/idp/username', (req, res) => {
    const flow = randomUUID();
    state.pending.set(flow, String(req.body.username ?? ''));
    res.setHeader('Set-Cookie', `mock_flow=${flow}; Path=/; HttpOnly`);
    res.redirect('/idp/passwordLoginForm');
  });
  app.get('/idp/passwordLoginForm', (_req, res) => res.send(T.passwordPage()));
  app.post('/idp/passwordLoginForm', (req, res) => {
    const username = state.pending.get(cookie(req, 'mock_flow') ?? '') ?? '';
    const acc = account(username);
    if (state.locked.has(username)) return res.send(T.lockedPage());
    if (acc?.mode === 'captcha') return res.send(T.captchaPage());
    const ok = !!acc && acc.password === String(req.body.password ?? '');
    state.loginAttempts.push({ username, ok, at: Date.now() });
    if (!ok) {
      const n = (state.failures.get(username) ?? 0) + 1;
      state.failures.set(username, n);
      if (n >= config.lockoutAfter) {
        state.locked.add(username);
        return res.send(T.lockedPage());
      }
      return res.send(T.passwordPage('Invalid username or password'));
    }
    state.failures.delete(username);
    if (acc.mode === 'forced_change') return res.send(T.forcedChangePage());
    if (acc.mode === 'expired') return res.send(T.expiredPasswordPage());
    const sid = randomUUID();
    state.sessions.set(sid, {
      username,
      expiresAt: Date.now() + config.sessionTtlMs,
      childRef: childrenOf(username)[0]!.ref,
    });
    res.setHeader('Set-Cookie', `mock_sid=${sid}; Path=/; HttpOnly`);
    res.redirect('/families/home');
  });

  // ---- families: authenticated area ----
  const auth = (req: Request, res: Response, next: NextFunction) => {
    const s = state.sessions.get(cookie(req, 'mock_sid') ?? '');
    if (!s || s.expiresAt < Date.now()) return res.redirect('/idp/usernameForm');
    res.locals.session = s;
    next();
  };

  app.get('/families/home', auth, (_req, res) => {
    const s: Session = res.locals.session;
    res.send(T.homePage(childrenOf(s.username), s.childRef));
  });

  app.post('/families/otherStudents', auth, (req, res) => {
    const s: Session = res.locals.session;
    const ref = String(req.body.childRef ?? '');
    if (childrenOf(s.username).some((c) => c.ref === ref)) s.childRef = ref;
    res.redirect('/families/home');
  });

  app.get('/families/attachment/:itemRef/:idx', auth, (req, res) => {
    const s: Session = res.locals.session;
    for (const c of childrenOf(s.username))
      for (const items of Object.values(c.sections))
        for (const it of items ?? [])
          if (it.ref === req.params.itemRef) {
            const a = it.attachments?.[Number(req.params.idx)];
            if (a) {
              res.setHeader('Content-Disposition', `attachment; filename="${a.name}"`);
              return res.type('application/pdf').send(Buffer.from(a.content));
            }
          }
    res.status(404).send('not found');
  });

  app.get('/families/missatges/:ref/reply', auth, (req, res) => res.send(T.replyFormPage(req.params.ref!)));
  app.post('/families/missatges/:ref/reply', auth, (req, res) => {
    const s: Session = res.locals.session;
    const id = randomUUID();
    state.submissions.push({
      id,
      username: s.username,
      childRef: s.childRef,
      itemRef: req.params.ref!,
      text: String(req.body.text ?? ''),
    });
    res.send(T.replySentPage(id));
  });

  app.get('/families/:slug', auth, (req, res) => {
    const s: Session = res.locals.session;
    const kids = childrenOf(s.username);
    const child = kids.find((c) => c.ref === s.childRef)!;
    res.send(T.sectionPage(req.params.slug!, kids, s.childRef, child.sections[req.params.slug!] ?? []));
  });

  return { app, state, config };
}
