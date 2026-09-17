import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PersistedState, WordCard } from '../../shared/types.js';
import { GameEngine } from '../game/engine.js';

interface SeedWord { word: string; aliases: string[]; difficulty: 'easy' | 'hard' }

export class StateStore {
  private pending: Promise<void> = Promise.resolve();
  private file: string;

  constructor(private dataDir: string) { this.file = path.join(dataDir, 'state.json'); }

  async load(): Promise<GameEngine> {
    await mkdir(this.dataDir, { recursive: true });
    try {
      const state = JSON.parse(await readFile(this.file, 'utf8')) as PersistedState;
      if (state.version !== 1) throw new Error('Versión de snapshot no soportada');
      state.match.mode ??= 'live';
      state.match.demoDrawerId ??= null;
      state.players.forEach(player => { player.connected = Boolean(player.npc); player.disconnectAt = null; });
      const phase = state.match.phase;
      if (!['lobby', 'finished', 'paused'].includes(phase)) {
        state.match.resumePhase = phase;
        state.match.pausedRemainingMs = Math.max(0, (state.match.phaseEndsAt ?? state.savedAt) - state.savedAt);
        state.match.phase = 'paused';
        state.match.phaseEndsAt = null;
      }
      return new GameEngine(state);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Snapshot ignorado:', (error as Error).message);
      const seedPath = path.resolve(process.cwd(), 'data', 'default-words.json');
      const seed = JSON.parse(await readFile(seedPath, 'utf8')) as SeedWord[];
      const words: WordCard[] = seed.map(word => ({ ...word, enabled: true, id: randomUUID() }));
      return GameEngine.create(words);
    }
  }

  save(state: PersistedState): Promise<void> {
    this.pending = this.pending.then(async () => {
      state.savedAt = Date.now();
      const temp = `${this.file}.tmp`;
      await writeFile(temp, JSON.stringify(state), 'utf8');
      await rename(temp, this.file);
    });
    return this.pending;
  }

  flush(): Promise<void> { return this.pending; }
}
