import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import type { Ack, AdminState, PlayerState, PublicState } from '../src/shared/types.js';

const url = process.env.SMOKE_URL ?? 'http://127.0.0.1:3100';
const adminCode = process.env.SMOKE_ADMIN_CODE ?? 'arcade-admin';

const response = await fetch(`${url}/api/admin/session`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: adminCode }),
});
assert.equal(response.status, 200, 'El login admin debe responder 200.');
const cookie = response.headers.get('set-cookie');
assert.ok(cookie, 'El login debe entregar cookie HttpOnly.');

const once = <T>(socket: Socket, event: string, timeoutMs = 5_000) => new Promise<T>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Timeout esperando ${event}`)), timeoutMs);
  socket.once(event, value => { clearTimeout(timeout); resolve(value); });
});
const emit = <T>(socket: Socket, event: string, payload?: unknown) => new Promise<Ack<T>>(resolve => {
  if (payload === undefined) socket.emit(event, resolve); else socket.emit(event, payload, resolve);
});

const admin = io(url, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] });
const adminState = await once<AdminState>(admin, 'state:admin');
assert.equal(adminState.words.length >= 80, true);
for (const stale of adminState.players.filter(player => player.name.startsWith('Smoke '))) {
  const cleanup = await emit(admin, 'admin:player:remove', { playerId: stale.id });
  assert.equal(cleanup.ok, true);
}

const host = io(url, { auth: { viewer: 'host', eventToken: adminState.eventToken }, transports: ['websocket'] });
const publicPromise = once<PublicState>(host, 'state:public');
const player = io(url, { auth: { viewer: 'player', eventToken: adminState.eventToken }, transports: ['websocket'] });
await once<void>(player, 'connect');
const deniedDemo = await emit(player, 'admin:demo:start', { drawerId: randomUUID() });
assert.equal(deniedDemo.ok, false);
if (!deniedDemo.ok) assert.equal(deniedDemo.code, 'FORBIDDEN');
const playerPromise = once<PlayerState>(player, 'state:player');
const registration = await emit<{ playerId: string; token: string }>(player, 'player:register', {
  eventToken: adminState.eventToken, name: `Smoke ${Date.now().toString().slice(-6)}`, avatarId: 3,
});
assert.equal(registration.ok, true);
if (!registration.ok) throw new Error(registration.message);
const playerState = await playerPromise;
assert.equal(playerState.self.id, registration.data.playerId);
const publicState = await publicPromise;
const serialized = JSON.stringify(publicState);
for (const forbidden of ['eventToken', 'sessionHash', 'currentWord', 'secretWord', 'aliases']) assert.equal(serialized.includes(forbidden), false, `El estado público filtró ${forbidden}.`);

const removed = await emit(admin, 'admin:player:remove', { playerId: registration.data.playerId });
assert.equal(removed.ok, true, JSON.stringify(removed));
admin.disconnect(); host.disconnect(); player.disconnect();
console.log('Smoke HTTP/Socket.io correcto: auth, registro, snapshots por rol y limpieza.');
