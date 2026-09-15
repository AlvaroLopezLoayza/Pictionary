import { io } from 'socket.io-client';
import { readFile } from 'node:fs/promises';

const url = process.env.LOAD_URL ?? 'http://127.0.0.1:3100';
const eventToken = process.env.LOAD_EVENT_TOKEN ?? JSON.parse(await readFile('data/state.json', 'utf8')).eventToken as string;

const clients = Array.from({ length: 100 }, () => io(url, { auth: { viewer: 'host', eventToken }, transports: ['websocket'], reconnection: false }));
const started = performance.now();
const connections = clients.map(client => new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Timeout de conexión')), 10_000);
  client.once('connect', () => { clearTimeout(timeout); resolve(); });
  client.once('connect_error', reject);
}));
const snapshotPromises = clients.map(client => new Promise<number>(resolve => client.once('state:public', state => resolve(state.version))));
await Promise.all(connections);
const snapshots = await Promise.all(snapshotPromises);
if (new Set(snapshots).size !== 1) throw new Error('Los clientes recibieron revisiones divergentes.');
console.log(`100 sockets conectados y sincronizados en ${Math.round(performance.now() - started)} ms.`);
clients.forEach(client => client.disconnect());
