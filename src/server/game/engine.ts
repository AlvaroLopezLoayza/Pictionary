import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type {
  AdminState, Difficulty, MatchState, PersistedState, Player, PlayerRole, PlayerState,
  Point, PublicState, ScoreEffect, ScoreReason, Stroke, TeamId, TurnState, WordCard,
} from '../../shared/types.js';

export type DomainEvent =
  | { type: 'phase'; phase: MatchState['phase'] }
  | { type: 'score'; effect: ScoreEffect }
  | { type: 'knows'; playerId: string }
  | { type: 'draw'; action: 'start' | 'points' | 'end' | 'undo' | 'clear'; payload?: unknown };

const otherTeam = (team: TeamId): TeamId => team === 'A' ? 'B' : 'A';
const shuffled = <T>(items: T[]): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

export const normalizeAnswer = (value: string): string => value
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLocaleLowerCase('es')
  .trim()
  .replace(/\s+/g, ' ');

export const majorityFor = (eligible: number): number => eligible > 0 ? Math.floor(eligible / 2) + 1 : 0;

export const freshMatch = (): MatchState => ({
  phase: 'lobby', resumePhase: null, phaseEndsAt: null, pausedRemainingMs: null,
  lobbyOpen: true, turnIndex: 0, startingTeam: Math.random() < .5 ? 'A' : 'B', turn: null,
  usedWordIds: [], drawerQueues: { A: [], B: [] }, scores: [],
});

export class GameError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export class GameEngine {
  private events: DomainEvent[] = [];
  public revision = 0;

  constructor(public state: PersistedState) {}

  static create(words: WordCard[]): GameEngine {
    return new GameEngine({
      version: 1, savedAt: Date.now(), eventToken: randomBytes(24).toString('base64url'),
      players: [], words, match: freshMatch(),
    });
  }

  private changed(): void { this.revision++; }
  drainEvents(): DomainEvent[] { return this.events.splice(0); }
  private phase(phase: MatchState['phase'], durationMs: number | null, now: number): void {
    this.state.match.phase = phase;
    this.state.match.phaseEndsAt = durationMs === null ? null : now + durationMs;
    this.state.match.resumePhase = null;
    this.state.match.pausedRemainingMs = null;
    this.events.push({ type: 'phase', phase });
    this.changed();
  }

  score(teamId: TeamId): number {
    return this.state.match.scores.filter(x => x.teamId === teamId).reduce((sum, x) => sum + x.points, 0);
  }

  register(eventToken: string, name: string, avatarId: number): { playerId: string; token: string } {
    if (eventToken !== this.state.eventToken) throw new GameError('INVALID_EVENT', 'El enlace del evento no es válido.');
    if (!this.state.match.lobbyOpen || this.state.match.phase !== 'lobby') throw new GameError('LOBBY_CLOSED', 'El lobby está cerrado.');
    if (this.state.players.length >= 100) throw new GameError('LOBBY_FULL', 'El evento alcanzó 100 jugadores.');
    if (this.state.players.some(p => normalizeAnswer(p.name) === normalizeAnswer(name))) throw new GameError('NAME_TAKEN', 'Ese nombre ya está en uso.');
    const token = randomBytes(32).toString('base64url');
    const player: Player = {
      id: randomUUID(), name: name.trim(), avatarId, teamId: null, connected: true,
      disconnectAt: null, sessionHash: this.hash(token),
    };
    this.state.players.push(player);
    this.changed();
    return { playerId: player.id, token };
  }

  resumePlayer(token: string): Player {
    const hash = this.hash(token);
    const player = this.state.players.find(p => p.sessionHash === hash);
    if (!player) throw new GameError('INVALID_SESSION', 'La sesión del jugador no es válida.');
    player.connected = true;
    player.disconnectAt = null;
    this.changed();
    return player;
  }

  disconnect(playerId: string, now = Date.now()): void {
    const player = this.state.players.find(candidate => candidate.id === playerId);
    if (!player) return;
    player.disconnectAt = now;
    this.changed();
  }

  assign(playerId: string, teamId: TeamId | null): void {
    if (this.state.match.phase !== 'lobby') throw new GameError('MATCH_RUNNING', 'Los equipos quedan bloqueados durante la partida.');
    this.player(playerId).teamId = teamId;
    this.changed();
  }

  removePlayer(playerId: string): void {
    if (this.state.match.phase !== 'lobby') throw new GameError('MATCH_RUNNING', 'No puedes expulsar jugadores durante la partida.');
    this.state.players = this.state.players.filter(p => p.id !== playerId);
    this.changed();
  }

  setLobby(open: boolean): void {
    if (this.state.match.phase !== 'lobby') throw new GameError('MATCH_RUNNING', 'El lobby está bloqueado durante la partida.');
    this.state.match.lobbyOpen = open;
    this.changed();
  }

  startMatch(now = Date.now()): void {
    if (this.state.match.phase !== 'lobby') throw new GameError('BAD_PHASE', 'La partida ya comenzó.');
    const a = this.connectedTeam('A');
    const b = this.connectedTeam('B');
    if (a.length < 2 || b.length < 2 || a.length !== b.length) throw new GameError('UNBALANCED_TEAMS', 'Los equipos deben tener el mismo tamaño y al menos 2 jugadores conectados.');
    if (this.availableWords('easy').length < 4 || this.availableWords('hard').length < 6) throw new GameError('WORD_BANK', 'Se requieren al menos 4 palabras fáciles y 6 difíciles habilitadas.');
    this.state.match = { ...freshMatch(), startingTeam: Math.random() < .5 ? 'A' : 'B', lobbyOpen: false };
    this.startTurn(now);
  }

  nextTurn(now = Date.now()): void {
    const match = this.state.match;
    if (match.phase !== 'results' && match.phase !== 'betweenTurns') throw new GameError('BAD_PHASE', 'Solo puedes avanzar desde resultados.');
    if (match.phase === 'results') match.turnIndex++;
    if (match.turnIndex >= 10) return this.phase('finished', null, now);
    this.startTurn(now);
  }

  private startTurn(now: number): void {
    const match = this.state.match;
    const activeTeamId = match.turnIndex % 2 === 0 ? match.startingTeam : otherTeam(match.startingTeam);
    const roundNumber = Math.floor(match.turnIndex / 2) + 1;
    const difficulty: Difficulty = roundNumber <= 2 ? 'easy' : 'hard';
    const candidates = this.availableWords(difficulty).filter(w => !match.usedWordIds.includes(w.id));
    if (!candidates.length) throw new GameError('NO_WORDS', `No quedan palabras ${difficulty === 'easy' ? 'fáciles' : 'difíciles'} sin usar.`);
    const word = candidates[Math.floor(Math.random() * candidates.length)];
    let queue = match.drawerQueues[activeTeamId].filter(id => this.isConnected(id));
    if (!queue.length) queue = shuffled(this.connectedTeam(activeTeamId).map(p => p.id));
    const drawerId = queue.shift();
    if (!drawerId) throw new GameError('NO_DRAWER', 'No hay dibujante conectado para este equipo.');
    match.drawerQueues[activeTeamId] = queue;
    match.usedWordIds.push(word.id);
    match.turn = {
      id: randomUUID(), index: match.turnIndex, roundNumber, activeTeamId, drawerId, wordId: word.id,
      initialGuesserIds: [], attempts: {}, correctAt: {}, strokes: [], drawingStartedAt: null,
    };
    this.phase('reveal', 10_000, now);
  }

  tick(now = Date.now()): boolean {
    const before = this.revision;
    for (const player of this.state.players) {
      if (player.connected && player.disconnectAt && now - player.disconnectAt >= 5_000) {
        player.connected = false;
        player.disconnectAt = null;
        this.changed();
        if (this.state.match.turn?.drawerId === player.id && ['reveal', 'drawing', 'grace'].includes(this.state.match.phase)) this.pause(now);
      }
    }
    if (this.state.match.phase === 'drawing') this.maybeReachMajority(now);
    const deadline = this.state.match.phaseEndsAt;
    if (deadline !== null && now >= deadline) {
      switch (this.state.match.phase) {
        case 'reveal': this.beginDrawing(now); break;
        case 'drawing': this.beginSteal(now); break;
        case 'grace':
        case 'steal': this.phase('results', null, now); break;
      }
    }
    return before !== this.revision;
  }

  private beginDrawing(now: number): void {
    const turn = this.turn();
    turn.initialGuesserIds = this.connectedTeam(turn.activeTeamId).filter(p => p.id !== turn.drawerId).map(p => p.id);
    if (!turn.initialGuesserIds.length) {
      this.phase('paused', null, now);
      this.state.match.resumePhase = 'drawing';
      this.state.match.pausedRemainingMs = 60_000;
      return;
    }
    turn.drawingStartedAt = now;
    this.phase('drawing', 60_000, now);
  }

  private beginSteal(now: number): void {
    const turn = this.turn();
    if (!this.connectedTeam(otherTeam(turn.activeTeamId)).length) return this.phase('results', null, now);
    this.phase('steal', 10_000, now);
  }

  submitGuess(playerId: string, answer: string, now = Date.now()): 'correct' | 'incorrect' {
    const player = this.player(playerId);
    const turn = this.turn();
    const phase = this.state.match.phase;
    const activeGuess = (phase === 'drawing' || phase === 'grace') && player.teamId === turn.activeTeamId && player.id !== turn.drawerId;
    const stealGuess = phase === 'steal' && player.teamId === otherTeam(turn.activeTeamId);
    if (!player.connected || (!activeGuess && !stealGuess)) throw new GameError('NOT_ALLOWED', 'No puedes responder en esta fase.');
    if (turn.correctAt[playerId]) throw new GameError('ALREADY_CORRECT', 'Ya acertaste esta palabra.');
    const used = turn.attempts[playerId] ?? 0;
    if (used >= 3) throw new GameError('NO_ATTEMPTS', 'Agotaste tus 3 intentos.');
    const word = this.word(turn.wordId);
    const normalized = normalizeAnswer(answer);
    const validAnswers = [word.word, ...word.aliases].map(normalizeAnswer);
    if (!validAnswers.includes(normalized)) {
      turn.attempts[playerId] = used + 1;
      this.changed();
      return 'incorrect';
    }
    turn.correctAt[playerId] = { at: now, phase: phase === 'grace' ? 'grace' : 'drawing' };
    this.events.push({ type: 'knows', playerId });
    if (stealGuess) {
      this.award(turn.activeTeamId === 'A' ? 'B' : 'A', 'steal', 250, now, playerId);
      this.phase('results', null, now);
    } else {
      this.award(turn.activeTeamId, phase === 'grace' ? 'grace' : 'normal', phase === 'grace' ? 30 : 100, now, playerId);
      if (phase === 'drawing') {
        const complete = turn.initialGuesserIds.length > 0 && turn.initialGuesserIds.every(id => Boolean(turn.correctAt[id]));
        if (complete) this.award(turn.activeTeamId, 'full-team', 200, now);
        this.maybeReachMajority(now);
      }
    }
    this.changed();
    return 'correct';
  }

  private maybeReachMajority(now: number): void {
    if (this.state.match.phase !== 'drawing') return;
    const turn = this.turn();
    const eligible = this.connectedTeam(turn.activeTeamId).filter(p => p.id !== turn.drawerId);
    const correct = eligible.filter(p => Boolean(turn.correctAt[p.id])).length;
    if (eligible.length && correct >= majorityFor(eligible.length)) {
      const elapsed = now - (turn.drawingStartedAt ?? now);
      if (elapsed <= 20_000) this.award(turn.activeTeamId, 'speed', 30, now);
      this.phase('grace', 5_000, now);
    }
  }

  private award(teamId: TeamId, reason: ScoreReason, points: number, now: number, playerId?: string): void {
    const turn = this.turn();
    if (this.state.match.scores.some(x => x.turnId === turn.id && x.reason === reason && (!playerId || x.playerId === playerId))) return;
    this.state.match.scores.push({ id: randomUUID(), turnId: turn.id, teamId, playerId, reason, points, createdAt: now });
    this.events.push({ type: 'score', effect: { teamId, playerId, points, reason, total: this.score(teamId) } });
    this.changed();
  }

  pause(now = Date.now()): void {
    const match = this.state.match;
    if (!['reveal', 'drawing', 'grace', 'steal'].includes(match.phase)) throw new GameError('BAD_PHASE', 'Esta fase no se puede pausar.');
    match.resumePhase = match.phase;
    match.pausedRemainingMs = Math.max(0, (match.phaseEndsAt ?? now) - now);
    match.phase = 'paused';
    match.phaseEndsAt = null;
    this.events.push({ type: 'phase', phase: 'paused' });
    this.changed();
  }

  resumeGame(now = Date.now()): void {
    const match = this.state.match;
    if (match.phase !== 'paused' || !match.resumePhase) throw new GameError('BAD_PHASE', 'No hay una fase pausada.');
    const phase = match.resumePhase;
    const remaining = match.pausedRemainingMs ?? 0;
    if (match.turn && !this.isConnected(match.turn.drawerId)) throw new GameError('DRAWER_OFFLINE', 'El dibujante debe reconectarse antes de reanudar.');
    match.phase = phase;
    match.phaseEndsAt = now + remaining;
    match.resumePhase = null;
    match.pausedRemainingMs = null;
    this.events.push({ type: 'phase', phase });
    this.changed();
  }

  repeatTurn(now = Date.now()): void {
    const turn = this.turn();
    this.state.match.scores = this.state.match.scores.filter(x => x.turnId !== turn.id);
    this.state.match.turn = null;
    this.changed();
    this.startTurn(now);
  }

  annulTurn(now = Date.now()): void {
    const turn = this.turn();
    this.state.match.scores = this.state.match.scores.filter(x => x.turnId !== turn.id);
    this.state.match.turn = null;
    this.state.match.turnIndex++;
    this.changed();
    this.phase(this.state.match.turnIndex >= 10 ? 'finished' : 'betweenTurns', null, now);
  }

  finish(now = Date.now()): void { this.phase('finished', null, now); }

  newMatch(): void {
    this.state.players = [];
    this.state.eventToken = randomBytes(24).toString('base64url');
    this.state.match = freshMatch();
    this.changed();
  }

  startStroke(playerId: string, id: string): void {
    this.assertDrawer(playerId);
    if (this.turn().strokes.some(s => s.id === id)) throw new GameError('DUPLICATE_STROKE', 'Trazo duplicado.');
    this.turn().strokes.push({ id, points: [] });
    this.events.push({ type: 'draw', action: 'start', payload: { id } });
    this.changed();
  }

  addPoints(playerId: string, id: string, points: Point[]): void {
    this.assertDrawer(playerId);
    const stroke = this.turn().strokes.find(s => s.id === id);
    if (!stroke) throw new GameError('UNKNOWN_STROKE', 'Trazo inexistente.');
    stroke.points.push(...points);
    this.events.push({ type: 'draw', action: 'points', payload: { id, points } });
    this.changed();
  }

  endStroke(playerId: string, id: string): void {
    this.assertDrawer(playerId);
    this.events.push({ type: 'draw', action: 'end', payload: { id } });
  }

  undo(playerId: string): void {
    this.assertDrawer(playerId);
    this.turn().strokes.pop();
    this.events.push({ type: 'draw', action: 'undo' });
    this.changed();
  }

  clear(playerId: string): void {
    this.assertDrawer(playerId);
    this.turn().strokes = [];
    this.events.push({ type: 'draw', action: 'clear' });
    this.changed();
  }

  addWord(value: Omit<WordCard, 'id'>): WordCard {
    this.assertUniqueWord(value.word);
    const word = { ...value, id: randomUUID() };
    this.state.words.push(word); this.changed(); return word;
  }
  updateWord(id: string, value: Omit<WordCard, 'id'>): WordCard {
    if (this.state.match.turn?.wordId === id && !['lobby', 'finished'].includes(this.state.match.phase)) throw new GameError('WORD_IN_USE', 'No puedes editar la palabra de la ronda actual.');
    this.assertUniqueWord(value.word, id);
    const index = this.state.words.findIndex(w => w.id === id);
    if (index < 0) throw new GameError('WORD_NOT_FOUND', 'Palabra no encontrada.');
    this.state.words[index] = { ...value, id }; this.changed(); return this.state.words[index];
  }
  deleteWord(id: string): void {
    if (this.state.match.turn?.wordId === id) throw new GameError('WORD_IN_USE', 'No puedes eliminar la palabra actual.');
    const before = this.state.words.length;
    this.state.words = this.state.words.filter(w => w.id !== id);
    if (before === this.state.words.length) throw new GameError('WORD_NOT_FOUND', 'Palabra no encontrada.');
    this.changed();
  }
  importWords(values: Array<Omit<WordCard, 'id'>>): number {
    const normalized = new Set(this.state.words.map(w => normalizeAnswer(w.word)));
    for (const value of values) {
      const key = normalizeAnswer(value.word);
      if (normalized.has(key)) throw new GameError('DUPLICATE_WORD', `Palabra duplicada: ${value.word}`);
      normalized.add(key);
    }
    this.state.words.push(...values.map(value => ({ ...value, id: randomUUID() })));
    this.changed(); return values.length;
  }

  publicState(now = Date.now()): PublicState {
    const turn = this.state.match.turn;
    const activeEligible = turn ? this.connectedTeam(turn.activeTeamId).filter(p => p.id !== turn.drawerId) : [];
    const result: PublicState = {
      version: this.revision, serverNow: now, phase: this.state.match.phase,
      phaseEndsAt: this.state.match.phaseEndsAt, roundNumber: turn?.roundNumber ?? null,
      turnNumber: this.state.match.turnIndex + 1, activeTeamId: turn?.activeTeamId ?? null,
      scores: { A: this.score('A'), B: this.score('B') },
      players: this.state.players.map(p => ({
        id: p.id, name: p.name, avatarId: p.avatarId, teamId: p.teamId, connected: p.connected,
        knows: Boolean(turn?.correctAt[p.id]), drawer: turn?.drawerId === p.id,
      })),
      guessed: activeEligible.filter(p => Boolean(turn?.correctAt[p.id])).length,
      eligible: activeEligible.length, majority: majorityFor(activeEligible.length),
      strokes: turn?.strokes.map(stroke => ({ ...stroke, points: [...stroke.points] })) ?? [],
    };
    if (turn && ['results', 'finished'].includes(this.state.match.phase)) result.lastWord = this.word(turn.wordId).word;
    return result;
  }

  playerState(playerId: string, now = Date.now()): PlayerState {
    const base = this.publicState(now);
    const self = base.players.find(p => p.id === playerId);
    if (!self) throw new GameError('PLAYER_NOT_FOUND', 'Jugador no encontrado.');
    const turn = this.state.match.turn;
    const role = this.role(playerId);
    const attemptsUsed = turn?.attempts[playerId] ?? 0;
    return {
      ...base, self, role, attemptsUsed, attemptsLeft: Math.max(0, 3 - attemptsUsed),
      answeredCorrectly: Boolean(turn?.correctAt[playerId]),
      ...(role === 'drawer' && turn ? { secretWord: this.word(turn.wordId).word } : {}),
    };
  }

  adminState(now = Date.now()): AdminState {
    const turn = this.state.match.turn;
    return {
      ...this.publicState(now), eventToken: this.state.eventToken, lobbyOpen: this.state.match.lobbyOpen,
      words: this.state.words, scoreEntries: this.state.match.scores,
      ...(turn ? { currentWord: this.word(turn.wordId) } : {}),
    };
  }

  private role(playerId: string): PlayerRole {
    const player = this.player(playerId);
    const turn = this.state.match.turn;
    if (!player.teamId) return 'unassigned';
    if (!turn) return 'waiting';
    if (turn.drawerId === playerId) return 'drawer';
    if (player.teamId === turn.activeTeamId) return 'guesser';
    if (this.state.match.phase === 'steal') return 'stealer';
    return 'rival';
  }

  private assertDrawer(playerId: string): void {
    const turn = this.turn();
    if (turn.drawerId !== playerId || !['drawing', 'grace'].includes(this.state.match.phase)) throw new GameError('NOT_DRAWER', 'El lienzo no está habilitado.');
  }
  private assertUniqueWord(word: string, except?: string): void {
    if (this.state.words.some(w => w.id !== except && normalizeAnswer(w.word) === normalizeAnswer(word))) throw new GameError('DUPLICATE_WORD', 'Esa palabra ya existe.');
  }
  private connectedTeam(teamId: TeamId): Player[] { return this.state.players.filter(p => p.teamId === teamId && p.connected); }
  private isConnected(id: string): boolean { return Boolean(this.state.players.find(p => p.id === id)?.connected); }
  private availableWords(difficulty: Difficulty): WordCard[] { return this.state.words.filter(w => w.enabled && w.difficulty === difficulty); }
  private player(id: string): Player {
    const player = this.state.players.find(p => p.id === id);
    if (!player) throw new GameError('PLAYER_NOT_FOUND', 'Jugador no encontrado.');
    return player;
  }
  private word(id: string): WordCard {
    const word = this.state.words.find(w => w.id === id);
    if (!word) throw new GameError('WORD_NOT_FOUND', 'Palabra no encontrada.');
    return word;
  }
  private turn(): TurnState {
    if (!this.state.match.turn) throw new GameError('NO_TURN', 'No hay una ronda activa.');
    return this.state.match.turn;
  }
  private hash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
}
