import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TeamId, WordCard } from '../src/shared/types.js';
import { GameEngine, GameError, majorityFor, normalizeAnswer } from '../src/server/game/engine.js';
import { StateStore } from '../src/server/persistence/store.js';

const words = (): WordCard[] => [
  ...Array.from({ length: 8 }, (_, i) => ({ id: randomUUID(), word: i ? `facil ${String.fromCharCode(97 + i)}` : 'café', aliases: i ? [] : ['cafetería'], difficulty: 'easy' as const, enabled: true })),
  ...Array.from({ length: 10 }, (_, i) => ({ id: randomUUID(), word: `dificil ${String.fromCharCode(97 + i)}`, aliases: [], difficulty: 'hard' as const, enabled: true })),
];

function prepared(size = 4, now = 1_000) {
  const engine = GameEngine.create(words());
  for (const teamId of ['A', 'B'] as TeamId[]) {
    for (let i = 0; i < size; i++) {
      const joined = engine.register(engine.state.eventToken, `${teamId} jugador ${i}`, i);
      engine.assign(joined.playerId, teamId);
    }
  }
  engine.startMatch(now);
  engine.tick(now + 10_000);
  return engine;
}

function demo(now = 1_000) {
  const engine = GameEngine.create(words());
  const drawer = engine.register(engine.state.eventToken, 'Dibujante', 9);
  const guesser = engine.register(engine.state.eventToken, 'Adivinador', 10);
  engine.startDemo(drawer.playerId, now);
  return { engine, drawerId: drawer.playerId, drawerToken: drawer.token, guesserId: guesser.playerId, guesserToken: guesser.token };
}

function playDemoTurn(engine: GameEngine): number {
  engine.tick(engine.state.match.phaseEndsAt!);
  const turn = engine.state.match.turn!;
  const startedAt = turn.drawingStartedAt!;
  const pattern = turn.index % 4;
  let now = startedAt;
  if (pattern === 0) {
    for (const delay of [8_000, 12_000, 16_000]) engine.tick(now = startedAt + delay);
    engine.tick(now = engine.state.match.phaseEndsAt! - 3_000);
    engine.tick(now = engine.state.match.phaseEndsAt!);
  } else if (pattern === 1) {
    engine.tick(now = engine.state.match.phaseEndsAt!);
    engine.tick(now = engine.state.match.phaseEndsAt! - 7_000);
  } else if (pattern === 2) {
    for (const delay of [25_000, 35_000, 45_000]) engine.tick(now = startedAt + delay);
    engine.tick(now = engine.state.match.phaseEndsAt!);
  } else {
    engine.tick(now = engine.state.match.phaseEndsAt!);
    engine.tick(now = engine.state.match.phaseEndsAt!);
  }
  assert.equal(engine.state.match.phase, 'results');
  return now;
}

test('normaliza mayúsculas, tildes y espacios sin fuzzy matching', () => {
  assert.equal(normalizeAnswer('  CAFÉ  '), 'cafe');
  assert.equal(normalizeAnswer('Trabajo   en Equipo'), 'trabajo en equipo');
  assert.notEqual(normalizeAnswer('izla'), normalizeAnswer('isla'));
  assert.equal(majorityFor(6), 4);
  assert.equal(majorityFor(5), 3);
});

test('demo exige dos humanos, roles válidos y crea ocho NPCs balanceados', () => {
  const empty = GameEngine.create(words());
  assert.throws(() => empty.startDemo(randomUUID()), (error: unknown) => error instanceof GameError && error.code === 'DEMO_PLAYERS');
  const one = empty.register(empty.state.eventToken, 'Uno', 0);
  assert.throws(() => empty.startDemo(one.playerId), (error: unknown) => error instanceof GameError && error.code === 'DEMO_PLAYERS');
  empty.register(empty.state.eventToken, 'Dos', 1);
  assert.throws(() => empty.startDemo(randomUUID()), (error: unknown) => error instanceof GameError && error.code === 'DEMO_DRAWER');

  const { engine, drawerId, guesserId } = demo();
  assert.equal(engine.state.match.mode, 'demo');
  assert.equal(engine.state.match.demoDrawerId, drawerId);
  assert.equal(engine.state.match.demoGuesserId, guesserId);
  assert.equal(engine.state.players.find(player => player.id === drawerId)?.teamId, null);
  assert.equal(engine.state.players.find(player => player.id === guesserId)?.teamId, null);
  assert.equal(engine.state.players.filter(player => player.npc).length, 8);
  assert.equal(engine.state.players.filter(player => player.npc && player.teamId === 'A').length, 4);
  assert.equal(engine.state.players.filter(player => player.npc && player.teamId === 'B').length, 4);
  assert.equal(engine.publicState().players.filter(player => player.npc).length, 8);
  assert.equal(engine.publicState().players.find(player => player.id === drawerId)?.demoRole, 'drawer');
  assert.equal(engine.publicState().players.find(player => player.id === guesserId)?.demoRole, 'guesser');
  assert.throws(() => engine.startDemo(drawerId), (error: unknown) => error instanceof GameError && error.code === 'BAD_PHASE');
});

test('demo mantiene los roles humanos y recorre los cuatro guiones durante diez turnos', () => {
  const { engine, drawerId } = demo();
  let now = 1_000;
  for (let index = 0; index < 10; index++) {
    const turn = engine.state.match.turn!;
    assert.equal(turn.index, index);
    assert.equal(turn.drawerId, drawerId);
    now = playDemoTurn(engine);
    const reasons = engine.state.match.scores.filter(entry => entry.turnId === turn.id).map(entry => entry.reason);
    if (index % 4 === 0) assert.deepEqual(reasons.sort(), ['grace', 'normal', 'normal', 'normal', 'speed']);
    if (index % 4 === 1) assert.deepEqual(reasons, ['steal']);
    if (index % 4 === 2) assert.deepEqual(reasons, ['normal', 'normal', 'normal']);
    if (index % 4 === 3) assert.deepEqual(reasons, []);
    engine.nextTurn(now + 1);
  }
  assert.equal(engine.state.match.phase, 'finished');
});

test('adivinador demo responde para el equipo activo y durante el robo', () => {
  const { engine, guesserId } = demo();
  engine.tick(engine.state.match.phaseEndsAt!);
  let turn = engine.state.match.turn!;
  let word = engine.state.words.find(item => item.id === turn.wordId)!;
  assert.equal(engine.playerState(guesserId).role, 'guesser');
  engine.submitGuess(guesserId, word.word, turn.drawingStartedAt! + 1_000);
  assert.equal(engine.state.match.scores.at(-1)?.teamId, turn.activeTeamId);
  engine.tick(engine.state.match.phaseEndsAt!);
  engine.tick(engine.state.match.phaseEndsAt!);
  engine.nextTurn();

  engine.tick(engine.state.match.phaseEndsAt!);
  turn = engine.state.match.turn!;
  word = engine.state.words.find(item => item.id === turn.wordId)!;
  engine.tick(engine.state.match.phaseEndsAt!);
  assert.equal(engine.playerState(guesserId).role, 'stealer');
  engine.submitGuess(guesserId, word.word);
  assert.equal(engine.state.match.scores.at(-1)?.reason, 'steal');
  assert.equal(engine.state.match.scores.at(-1)?.teamId, turn.activeTeamId === 'A' ? 'B' : 'A');
});

test('demo se pausa y exige reconexión de ambos humanos', () => {
  const { engine, drawerId, drawerToken, guesserId, guesserToken } = demo();
  engine.tick(engine.state.match.phaseEndsAt!);
  const now = engine.state.match.turn!.drawingStartedAt! + 1_000;
  engine.disconnect(guesserId, now);
  engine.tick(now + 5_000);
  assert.equal(engine.state.match.phase, 'paused');
  assert.throws(() => engine.resumeGame(), (error: unknown) => error instanceof GameError && error.code === 'GUESSER_OFFLINE');
  engine.resumePlayer(guesserToken);
  engine.resumeGame(now + 6_000);
  engine.disconnect(drawerId, now + 7_000);
  engine.tick(now + 12_000);
  assert.equal(engine.state.match.phase, 'paused');
  engine.resumePlayer(drawerToken);
  engine.resumeGame(now + 13_000);
  assert.equal(engine.state.match.phase, 'drawing');
});

test('acierto temprano de todo el equipo suma normal, velocidad y equipo completo', () => {
  const engine = prepared(2);
  const turn = engine.state.match.turn!;
  const guesser = turn.initialGuesserIds[0];
  const word = engine.state.words.find(x => x.id === turn.wordId)!;
  assert.equal(engine.submitGuess(guesser, word.word.toUpperCase(), 12_000), 'correct');
  assert.equal(engine.state.match.phase, 'grace');
  assert.equal(engine.score(turn.activeTeamId), 330);
  assert.deepEqual(engine.state.match.scores.map(x => x.reason).sort(), ['full-team', 'normal', 'speed']);
});

test('gracia da 30 y no concede bono completo', () => {
  const engine = prepared(4);
  const turn = engine.state.match.turn!;
  const word = engine.state.words.find(x => x.id === turn.wordId)!;
  engine.submitGuess(turn.initialGuesserIds[0], word.word, 25_000);
  engine.submitGuess(turn.initialGuesserIds[1], word.word, 26_000);
  assert.equal(engine.state.match.phase, 'grace');
  engine.submitGuess(turn.initialGuesserIds[2], word.word, 27_000);
  assert.equal(engine.score(turn.activeTeamId), 260);
  assert.equal(engine.state.match.scores.some(x => x.reason === 'full-team'), false);
  assert.equal(engine.state.match.scores.some(x => x.reason === 'speed'), true);
});

test('bloquea al tercer fallo y mantiene ortografía estricta', () => {
  const engine = prepared(4);
  const player = engine.state.match.turn!.initialGuesserIds[0];
  for (const answer of ['izla', 'caro', 'otra']) assert.equal(engine.submitGuess(player, answer), 'incorrect');
  assert.throws(() => engine.submitGuess(player, 'café'), (error: unknown) => error instanceof GameError && error.code === 'NO_ATTEMPTS');
});

test('desconexión recalcula mayoría después de cinco segundos', () => {
  const engine = prepared(4, 10_000);
  const turn = engine.state.match.turn!;
  const word = engine.state.words.find(x => x.id === turn.wordId)!;
  engine.submitGuess(turn.initialGuesserIds[0], word.word, 30_000);
  engine.disconnect(turn.initialGuesserIds[1], 31_000);
  engine.disconnect(turn.initialGuesserIds[2], 31_000);
  engine.tick(36_000);
  assert.equal(engine.state.match.phase, 'grace');
});

test('robo premia solo al primer rival', () => {
  const engine = prepared(3, 5_000);
  const turn = engine.state.match.turn!;
  const word = engine.state.words.find(x => x.id === turn.wordId)!;
  engine.tick(75_000);
  assert.equal(engine.state.match.phase, 'steal');
  const rival = engine.state.players.find(p => p.teamId !== turn.activeTeamId)!;
  assert.equal(engine.submitGuess(rival.id, word.word, 76_000), 'correct');
  assert.equal(engine.score(rival.teamId!), 250);
  assert.throws(() => engine.submitGuess(engine.state.players.find(p => p.teamId === rival.teamId && p.id !== rival.id)!.id, word.word, 76_001));
});

test('repetir revierte el ledger y cambia palabra/dibujante', () => {
  const engine = prepared(3);
  const old = engine.state.match.turn!;
  const word = engine.state.words.find(x => x.id === old.wordId)!;
  engine.submitGuess(old.initialGuesserIds[0], word.word, 15_000);
  assert.ok(engine.score(old.activeTeamId) > 0);
  engine.repeatTurn(20_000);
  assert.equal(engine.score(old.activeTeamId), 0);
  assert.notEqual(engine.state.match.turn!.id, old.id);
  assert.notEqual(engine.state.match.turn!.wordId, old.wordId);
});

test('estado público nunca expone la palabra y el dibujante sí la recibe', () => {
  const engine = prepared(2);
  const turn = engine.state.match.turn!;
  assert.equal(JSON.stringify(engine.publicState()).includes('secretWord'), false);
  assert.equal(engine.playerState(turn.drawerId).secretWord, engine.state.words.find(x => x.id === turn.wordId)!.word);
});

test('desconectar después de expulsar es idempotente', () => {
  const engine = GameEngine.create(words());
  const joined = engine.register(engine.state.eventToken, 'Temporal', 0);
  engine.removePlayer(joined.playerId);
  assert.doesNotThrow(() => engine.disconnect(joined.playerId));
});

test('snapshot activo se restaura pausado con el tiempo restante', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pictionary-'));
  try {
    const store = new StateStore(dir);
    const engine = prepared(2, 1_000);
    engine.state.match.phaseEndsAt = Date.now() + 50_000;
    await store.save(engine.state);
    const restored = await store.load();
    assert.equal(restored.state.match.phase, 'paused');
    assert.equal(restored.state.match.resumePhase, 'drawing');
    assert.ok((restored.state.match.pausedRemainingMs ?? 0) > 0);
    assert.equal(restored.state.players.every(p => !p.connected), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('snapshot demo conserva NPCs conectados y espera a ambos humanos', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'garabato-demo-'));
  try {
    const store = new StateStore(dir);
    const { engine, drawerId, guesserId } = demo(Date.now());
    await store.save(engine.state);
    const restored = await store.load();
    assert.equal(restored.state.match.mode, 'demo');
    assert.equal(restored.state.match.phase, 'paused');
    assert.equal(restored.state.players.filter(player => player.npc).every(player => player.connected), true);
    assert.equal(restored.state.players.find(player => player.id === drawerId)?.connected, false);
    assert.equal(restored.state.players.find(player => player.id === guesserId)?.connected, false);
    restored.newMatch();
    assert.equal(restored.state.match.mode, 'live');
    assert.equal(restored.state.players.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
