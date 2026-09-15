import http from 'node:http';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { Server } from 'socket.io';
import { StateStore } from './persistence/store.js';
import { AdminAuth } from './transport/auth.js';
import { configureSocket } from './transport/socket.js';

const production = process.env.NODE_ENV === 'production' || import.meta.url.includes('/dist/');
const port = Number(process.env.PORT ?? 3000);
const origin = process.env.APP_ORIGIN ?? `http://localhost:${port}`;
const adminCode = process.env.ADMIN_CODE ?? 'arcade-admin';
const sessionSecret = process.env.SESSION_SECRET ?? 'development-secret-change-me-32-chars';
const dataDir = path.resolve(process.env.DATA_DIR ?? './data');

if (production && (!process.env.ADMIN_CODE || !process.env.SESSION_SECRET)) throw new Error('ADMIN_CODE y SESSION_SECRET son obligatorios en producción.');
if (!production && (!process.env.ADMIN_CODE || !process.env.SESSION_SECRET)) console.warn('Usando credenciales locales de desarrollo; configura .env.example antes de publicar.');

const store = new StateStore(dataDir);
const engine = await store.load();
const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: production ? {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'", 'ws:', 'wss:'],
    },
  } : false,
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '8kb' }));

const auth = new AdminAuth(adminCode, sessionSecret, origin.startsWith('https://'));
app.get('/healthz', (_req, res) => res.json({ ok: true, phase: engine.state.match.phase }));
app.post('/api/admin/session', (req, res) => { auth.login(req, res); });
app.delete('/api/admin/session', (_req, res) => auth.logout(res));
app.get('/api/admin/session', (req, res) => res.status(auth.validCookie(req.headers.cookie) ? 200 : 401).json({ ok: auth.validCookie(req.headers.cookie) }));

if (production) {
  const clientDir = path.resolve(process.cwd(), 'dist', 'client');
  app.use(express.static(clientDir, { maxAge: '1h', index: false }));
  app.use((_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

const server = http.createServer(app);
const io = new Server(server, { cors: { origin, credentials: true }, maxHttpBufferSize: 1_000_000, pingInterval: 15_000, pingTimeout: 10_000 });
const stopSockets = configureSocket(io, engine, store, auth);

server.listen(port, '0.0.0.0', () => console.log(`Garabato Party listo en ${origin}`));

const shutdown = async () => {
  stopSockets();
  try {
    if (['reveal', 'drawing', 'grace', 'steal'].includes(engine.state.match.phase)) engine.pause();
    await store.save(engine.state); await store.flush();
  } finally { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 8_000).unref(); }
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
