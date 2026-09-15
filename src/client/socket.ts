import { io, type Socket } from 'socket.io-client';
import type { Ack } from '../shared/types';

export const connectSocket = (auth: Record<string, unknown> = {}): Socket => io({ auth, withCredentials: true });

export function emitAck<T = unknown>(socket: Socket, event: string, payload?: unknown): Promise<Ack<T>> {
  return new Promise(resolve => {
    const callback = (result: Ack<T>) => resolve(result);
    if (payload === undefined) socket.emit(event, callback);
    else socket.emit(event, payload, callback);
  });
}

export const eventTokenFromUrl = (): string => {
  const token = location.hash.replace(/^#/, '').trim();
  if (token) localStorage.setItem('pictionary.eventToken', token);
  return token || localStorage.getItem('pictionary.eventToken') || '';
};
