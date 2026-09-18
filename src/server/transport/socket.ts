import type { Server, Socket } from 'socket.io';
import { parse } from 'csv-parse/sync';
import { ZodError } from 'zod';
import type { Ack, Difficulty, WordCard } from '../../shared/types.js';
import {
  csvSchema, demoStartSchema, guessSchema, lobbySchema, playerIdSchema, pointsSchema, registerSchema,
  strokeStartSchema, teamSchema, tokenSchema, wordIdSchema, wordSchema, wordUpdateSchema,
} from '../../shared/validation.js';
import { GameEngine, GameError, type DomainEvent } from '../game/engine.js';
import type { StateStore } from '../persistence/store.js';
import type { AdminAuth } from './auth.js';

type Role = 'admin' | 'host' | 'player' | 'anonymous';
type SocketData = { role: Role; playerId?: string; eventToken?: string; counts?: Map<string, { n: number; reset: number }> };

const ok = <T>(data: T): Ack<T> => ({ ok: true, data });
const fail = (error: unknown): Ack => error instanceof GameError
  ? { ok: false, code: error.code, message: error.message }
  : error instanceof ZodError
    ? { ok: false, code: 'VALIDATION', message: error.issues[0]?.message ?? 'Datos inválidos.' }
  : { ok: false, code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado.' };

export function configureSocket(io: Server, engine: GameEngine, store: StateStore, auth: AdminAuth): () => void {
  const playerConnections = new Map<string, number>();
  let lastCanvasSave = 0;

  const emitEvents = (events: DomainEvent[]) => {
    for (const event of events) {
      if (event.type === 'phase') io.emit('phase:changed', { phase: event.phase });
      if (event.type === 'score') io.emit('score:changed', event.effect);
      if (event.type === 'knows') io.emit('player:knows', { playerId: event.playerId });
      if (event.type === 'draw') io.emit(`draw:${event.action}`, event.payload ?? {});
    }
  };

  const broadcast = () => {
    const now = Date.now();
    for (const socket of io.sockets.sockets.values()) {
      const data = socket.data as SocketData;
      if (data.role !== 'admin' && data.eventToken && data.eventToken !== engine.state.eventToken) {
        socket.emit('game:error', { code: 'EVENT_ROTATED', message: 'La partida terminó. Escanea el nuevo QR.' });
        socket.disconnect(true);
      } else if (data.role === 'admin') socket.emit('state:admin', engine.adminState(now));
      else if (data.playerId) {
        try { socket.emit('state:player', engine.playerState(data.playerId, now)); }
        catch { socket.disconnect(true); }
      } else if (data.role === 'host') socket.emit('state:public', engine.publicState(now));
    }
  };

  const commit = async (persist = true) => {
    emitEvents(engine.drainEvents());
    broadcast();
    if (persist) await store.save(engine.state);
  };

  const rate = (socket: Socket, key: string, limit: number, windowMs: number) => {
    const data = socket.data as SocketData;
    data.counts ??= new Map();
    const now = Date.now();
    const current = data.counts.get(key);
    if (!current || current.reset <= now) { data.counts.set(key, { n: 1, reset: now + windowMs }); return; }
    if (++current.n > limit) throw new GameError('RATE_LIMIT', 'Demasiadas acciones. Inténtalo más despacio.');
  };

  const action = <T>(socket: Socket, schema: { parse(value: unknown): T }, handler: (value: T) => unknown, options?: { admin?: boolean; player?: boolean; rate?: [string, number, number]; canvas?: boolean }) =>
    async (value: unknown, ack: (result: Ack<unknown>) => void = () => undefined) => {
      try {
        const data = socket.data as SocketData;
        if (options?.admin && data.role !== 'admin') throw new GameError('FORBIDDEN', 'Acceso de administrador requerido.');
        if (options?.player && !data.playerId) throw new GameError('FORBIDDEN', 'Sesión de jugador requerida.');
        if (options?.rate) rate(socket, ...options.rate);
        const result = handler(schema.parse(value));
        const persist = !options?.canvas || Date.now() - lastCanvasSave >= 1_000;
        if (persist && options?.canvas) lastCanvasSave = Date.now();
        await commit(persist);
        ack(ok(result));
      } catch (error) {
        if (!(error instanceof GameError)) console.error(error);
        ack(fail(error));
      }
    };

  const noPayload = (socket: Socket, handler: () => unknown, admin = true, rateLimit?: [string, number, number]) =>
    async (ack: (result: Ack<unknown>) => void = () => undefined) => {
      try {
        if (admin && (socket.data as SocketData).role !== 'admin') throw new GameError('FORBIDDEN', 'Acceso de administrador requerido.');
        if (rateLimit) rate(socket, ...rateLimit);
        const result = handler(); await commit(); ack(ok(result));
      } catch (error) { if (!(error instanceof GameError)) console.error(error); ack(fail(error)); }
    };

  io.on('connection', socket => {
    const handshake = socket.handshake.auth as Record<string, unknown>;
    const isAdmin = auth.validCookie(socket.handshake.headers.cookie);
    const eventToken = typeof handshake.eventToken === 'string' ? handshake.eventToken : '';
    const viewer = handshake.viewer === 'host' ? 'host' : 'anonymous';
    (socket.data as SocketData).role = isAdmin ? 'admin' : eventToken === engine.state.eventToken ? viewer : 'anonymous';
    (socket.data as SocketData).eventToken = eventToken || undefined;

    const resumeToken = typeof handshake.playerToken === 'string' ? handshake.playerToken : '';
    if (!isAdmin && eventToken === engine.state.eventToken && resumeToken) {
      try {
        const player = engine.resumePlayer(resumeToken);
        (socket.data as SocketData).role = 'player';
        (socket.data as SocketData).playerId = player.id;
        playerConnections.set(player.id, (playerConnections.get(player.id) ?? 0) + 1);
        void commit();
      } catch { socket.emit('game:error', { code: 'INVALID_SESSION', message: 'Tu sesión caducó; vuelve a registrarte.' }); }
    }

    socket.on('player:register', action(socket, registerSchema, value => {
      const result = engine.register(value.eventToken, value.name, value.avatarId);
      (socket.data as SocketData).role = 'player';
      (socket.data as SocketData).playerId = result.playerId;
      (socket.data as SocketData).eventToken = value.eventToken;
      playerConnections.set(result.playerId, 1);
      return result;
    }, { rate: ['register', 3, 60_000] }));
    socket.on('player:resume', action(socket, tokenSchema, value => {
      const player = engine.resumePlayer(value.token);
      (socket.data as SocketData).role = 'player';
      (socket.data as SocketData).playerId = player.id;
      playerConnections.set(player.id, (playerConnections.get(player.id) ?? 0) + 1);
      return { playerId: player.id };
    }, { rate: ['resume', 5, 60_000] }));
    socket.on('guess:submit', action(socket, guessSchema, value => engine.submitGuess((socket.data as SocketData).playerId!, value.answer), { player: true, rate: ['guess', 5, 1_000] }));
    socket.on('draw:start', action(socket, strokeStartSchema, value => engine.startStroke((socket.data as SocketData).playerId!, value.id), { player: true, rate: ['draw', 90, 1_000], canvas: true }));
    socket.on('draw:points', action(socket, pointsSchema, value => engine.addPoints((socket.data as SocketData).playerId!, value.id, value.points), { player: true, rate: ['draw', 90, 1_000], canvas: true }));
    socket.on('draw:end', action(socket, strokeStartSchema, value => engine.endStroke((socket.data as SocketData).playerId!, value.id), { player: true, rate: ['draw', 90, 1_000], canvas: true }));
    socket.on('draw:undo', noPayload(socket, () => engine.undo((socket.data as SocketData).playerId!), false, ['draw-tools', 5, 1_000]));
    socket.on('draw:clear', noPayload(socket, () => engine.clear((socket.data as SocketData).playerId!), false, ['draw-tools', 5, 1_000]));

    socket.on('admin:player:assign', action(socket, teamSchema, v => engine.assign(v.playerId, v.teamId), { admin: true }));
    socket.on('admin:player:remove', action(socket, playerIdSchema, v => engine.removePlayer(v.playerId), { admin: true }));
    socket.on('admin:lobby:set', action(socket, lobbySchema, v => engine.setLobby(v.open), { admin: true }));
    socket.on('admin:match:start', noPayload(socket, () => engine.startMatch()));
    socket.on('admin:demo:start', action(socket, demoStartSchema, value => engine.startDemo(value.drawerId), { admin: true }));
    socket.on('admin:match:pause', noPayload(socket, () => engine.pause()));
    socket.on('admin:match:resume', noPayload(socket, () => engine.resumeGame()));
    socket.on('admin:turn:next', noPayload(socket, () => engine.nextTurn()));
    socket.on('admin:turn:repeat', noPayload(socket, () => engine.repeatTurn()));
    socket.on('admin:turn:annul', noPayload(socket, () => engine.annulTurn()));
    socket.on('admin:match:finish', noPayload(socket, () => engine.finish()));
    socket.on('admin:match:new', noPayload(socket, () => engine.newMatch()));
    socket.on('admin:word:create', action(socket, wordSchema.omit({ id: true }), v => engine.addWord(v), { admin: true }));
    socket.on('admin:word:update', action(socket, wordUpdateSchema, v => engine.updateWord(v.id, v.value), { admin: true }));
    socket.on('admin:word:delete', action(socket, wordIdSchema, v => engine.deleteWord(v.id), { admin: true }));
    socket.on('admin:words:import', action(socket, csvSchema, value => {
      const rows = parse(value.csv, { columns: true, bom: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
      if (!rows.length) throw new GameError('EMPTY_CSV', 'El CSV no contiene filas.');
      const words: Array<Omit<WordCard, 'id'>> = rows.map((row, index) => {
        if (!('word' in row) || !('difficulty' in row) || !('aliases' in row) || !('enabled' in row)) throw new GameError('CSV_HEADERS', 'Cabeceras requeridas: word,difficulty,aliases,enabled');
        const enabled = row.enabled.toLowerCase();
        const parsed = wordSchema.omit({ id: true }).safeParse({
          word: row.word, difficulty: row.difficulty as Difficulty,
          aliases: row.aliases ? row.aliases.split('|').map(x => x.trim()).filter(Boolean) : [],
          enabled: ['true', '1', 'sí', 'si'].includes(enabled) ? true : ['false', '0', 'no'].includes(enabled) ? false : undefined,
        });
        if (!parsed.success) throw new GameError('CSV_ROW', `Fila ${index + 2} inválida: ${parsed.error.issues[0]?.message}`);
        return parsed.data;
      });
      return { imported: engine.importWords(words) };
    }, { admin: true }));

    if ((socket.data as SocketData).role === 'admin') socket.emit('state:admin', engine.adminState());
    else if ((socket.data as SocketData).role === 'host') socket.emit('state:public', engine.publicState());

    socket.on('disconnect', () => {
      const playerId = (socket.data as SocketData).playerId;
      if (!playerId) return;
      const remaining = Math.max(0, (playerConnections.get(playerId) ?? 1) - 1);
      if (remaining) playerConnections.set(playerId, remaining);
      else { playerConnections.delete(playerId); engine.disconnect(playerId); void commit(); }
    });
  });

  const ticker = setInterval(() => { if (engine.tick()) void commit(); }, 100);
  const timerSync = setInterval(() => io.emit('timer:sync', { serverNow: Date.now(), phaseEndsAt: engine.state.match.phaseEndsAt }), 1_000);
  return () => { clearInterval(ticker); clearInterval(timerSync); };
}
