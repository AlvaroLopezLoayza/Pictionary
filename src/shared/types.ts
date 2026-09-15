export type TeamId = 'A' | 'B';
export type Difficulty = 'easy' | 'hard';
export type Phase = 'lobby' | 'betweenTurns' | 'reveal' | 'drawing' | 'grace' | 'steal' | 'results' | 'paused' | 'finished';
export type ScoreReason = 'normal' | 'grace' | 'speed' | 'full-team' | 'steal';

export interface Point { x: number; y: number }
export interface Stroke { id: string; points: Point[] }

export interface Player {
  id: string;
  name: string;
  avatarId: number;
  teamId: TeamId | null;
  connected: boolean;
  disconnectAt: number | null;
  sessionHash: string;
}

export interface WordCard {
  id: string;
  word: string;
  aliases: string[];
  difficulty: Difficulty;
  enabled: boolean;
}

export interface ScoreEntry {
  id: string;
  turnId: string;
  teamId: TeamId;
  playerId?: string;
  reason: ScoreReason;
  points: number;
  createdAt: number;
}

export interface TurnState {
  id: string;
  index: number;
  roundNumber: number;
  activeTeamId: TeamId;
  drawerId: string;
  wordId: string;
  initialGuesserIds: string[];
  attempts: Record<string, number>;
  correctAt: Record<string, { at: number; phase: 'drawing' | 'grace' }>;
  strokes: Stroke[];
  drawingStartedAt: number | null;
}

export interface MatchState {
  phase: Phase;
  resumePhase: Phase | null;
  phaseEndsAt: number | null;
  pausedRemainingMs: number | null;
  lobbyOpen: boolean;
  turnIndex: number;
  startingTeam: TeamId;
  turn: TurnState | null;
  usedWordIds: string[];
  drawerQueues: Record<TeamId, string[]>;
  scores: ScoreEntry[];
}

export interface PersistedState {
  version: 1;
  savedAt: number;
  eventToken: string;
  players: Player[];
  words: WordCard[];
  match: MatchState;
}

export interface PublicPlayer {
  id: string;
  name: string;
  avatarId: number;
  teamId: TeamId | null;
  connected: boolean;
  knows: boolean;
  drawer: boolean;
}

export interface PublicState {
  version: number;
  serverNow: number;
  phase: Phase;
  phaseEndsAt: number | null;
  roundNumber: number | null;
  turnNumber: number;
  activeTeamId: TeamId | null;
  scores: Record<TeamId, number>;
  players: PublicPlayer[];
  guessed: number;
  majority: number;
  eligible: number;
  strokes: Stroke[];
  lastWord?: string;
}

export type PlayerRole = 'unassigned' | 'drawer' | 'guesser' | 'rival' | 'stealer' | 'waiting';

export interface PlayerState extends PublicState {
  self: PublicPlayer;
  role: PlayerRole;
  secretWord?: string;
  attemptsUsed: number;
  attemptsLeft: number;
  answeredCorrectly: boolean;
}

export interface AdminState extends PublicState {
  eventToken: string;
  lobbyOpen: boolean;
  currentWord?: WordCard;
  words: WordCard[];
  scoreEntries: ScoreEntry[];
}

export type Ack<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

export interface ScoreEffect {
  teamId: TeamId;
  playerId?: string;
  points: number;
  reason: ScoreReason;
  total: number;
}
