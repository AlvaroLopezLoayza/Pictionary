import { useEffect, useRef, useState } from 'react';
import type { Ack, PlayerState, PublicPlayer } from '../../shared/types';
import type { Socket } from 'socket.io-client';
import { Avatar } from '../components/Avatar';
import { GameCanvas } from '../components/GameCanvas';
import { Scoreboard } from '../components/Scoreboard';
import { Timer } from '../components/Timer';
import { connectSocket, emitAck, eventTokenFromUrl } from '../socket';

export function PlayerPage() {
  const eventToken = useRef(eventTokenFromUrl()).current;
  const [socket, setSocket] = useState<Socket | null>(null);
  const [state, setState] = useState<PlayerState | null>(null);
  const [error, setError] = useState('');
  const playerToken = localStorage.getItem('pictionary.playerToken') ?? '';

  useEffect(() => {
    if (!eventToken) return;
    const next = connectSocket({ viewer: 'player', eventToken, playerToken });
    setSocket(next);
    next.on('state:player', setState);
    next.on('timer:sync', value => setState(current => current ? { ...current, ...value } : current));
    next.on('game:error', value => setError(value.message));
    return () => { next.disconnect(); };
  }, [eventToken, playerToken]);

  if (!eventToken) return <main className="center-page scanlines"><section className="panel"><h1>ENLACE INCOMPLETO</h1><p>Escanea el QR de la pantalla principal para entrar.</p></section></main>;
  if (!socket) return <main className="center-page"><div className="loader">CONECTANDO...</div></main>;
  if (!state) return <Registration socket={socket} eventToken={eventToken} error={error} setError={setError} />;

  return <main className={`player-page team-bg-${state.self.teamId ?? 'none'}`}>
    <Scoreboard a={state.scores.A} b={state.scores.B} center={<Timer endsAt={state.phaseEndsAt} serverNow={state.serverNow} urgent={state.phase === 'grace'} />} />
    <section className="player-content">
      <div className="player-identity"><Avatar player={state.self} compact /><div><span>{state.self.name}</span><strong>{state.self.teamId ? `EQUIPO ${state.self.teamId}` : 'SIN EQUIPO'}</strong></div></div>
      <RoleView state={state} socket={socket} setError={setError} />
      {error && <div className="error-box" role="alert">{error}<button aria-label="Cerrar" onClick={() => setError('')}>×</button></div>}
    </section>
  </main>;
}

function Registration({ socket, eventToken, error, setError }: { socket: Socket; eventToken: string; error: string; setError: (v: string) => void }) {
  const [name, setName] = useState('');
  const [avatarId, setAvatarId] = useState(0);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    const result = await emitAck<{ playerId: string; token: string }>(socket, 'player:register', { eventToken, name, avatarId });
    if (result.ok) localStorage.setItem('pictionary.playerToken', result.data.token); else setError(result.message);
  };
  return <main className="registration-page scanlines"><form className="panel registration-card" onSubmit={submit}>
    <p className="eyebrow">PLAYER SELECT</p><h1>ELIGE TU AVATAR</h1>
    <label>Tu nombre<input value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={20} autoComplete="nickname" required /></label>
    <div className="avatar-picker" role="radiogroup" aria-label="Avatares">
      {Array.from({ length: 12 }, (_, id) => {
        const fake: PublicPlayer = { id: String(id), name: `P${id + 1}`, avatarId: id, teamId: null, connected: true, knows: false, drawer: false };
        return <button type="button" className={avatarId === id ? 'selected' : ''} onClick={() => setAvatarId(id)} aria-label={`Avatar ${id + 1}`} aria-pressed={avatarId === id} key={id}><Avatar player={fake} compact /></button>;
      })}
    </div>
    {error && <p className="form-error">{error}</p>}
    <button className="button primary" disabled={!name.trim()}>ENTRAR AL LOBBY</button>
  </form></main>;
}

function RoleView({ state, socket, setError }: { state: PlayerState; socket: Socket; setError: (v: string) => void }) {
  const drawing = state.role === 'drawer' && ['drawing', 'grace'].includes(state.phase);
  if (state.phase === 'finished') return <section className="role-card victory-card"><p>PARTIDA TERMINADA</p><h1>{state.scores.A === state.scores.B ? 'EMPATE' : `GANÓ EL EQUIPO ${state.scores.A > state.scores.B ? 'A' : 'B'}`}</h1></section>;
  if (state.phase === 'results') return <section className="role-card"><p>LA PALABRA ERA</p><h1 className="secret-word">{state.lastWord}</h1><p>Espera el siguiente turno.</p></section>;
  if (state.phase === 'paused') return <section className="role-card"><p className="eyebrow">PAUSA</p><h1>NO TE VAYAS</h1><p>El administrador reanudará el juego.</p></section>;
  if (state.role === 'unassigned') return <section className="role-card"><p className="eyebrow">LOBBY</p><h1>ESPERANDO EQUIPO</h1><p>El administrador te asignará al Equipo A o B.</p></section>;
  if (state.role === 'drawer') return <section className={`role-card drawer-card ${drawing ? 'drawing-card' : ''}`}>
    <p className="eyebrow">ERES DIBUJANTE</p>
    <h1 className="secret-word">{state.secretWord}</h1>
    {state.phase === 'reveal' && <><p>Memoriza la palabra. No dibujes letras ni números.</p><Timer endsAt={state.phaseEndsAt} serverNow={state.serverNow} /></>}
    {drawing && <GameCanvas strokes={state.strokes} enabled
      onStart={id => socket.emit('draw:start', { id })}
      onPoints={(id, points) => socket.emit('draw:points', { id, points })}
      onEnd={id => socket.emit('draw:end', { id })}
      onUndo={() => socket.emit('draw:undo')}
      onClear={() => socket.emit('draw:clear')}
    />}
    {!drawing && state.phase !== 'reveal' && <p>Tu lienzo se habilitará al comenzar.</p>}
  </section>;
  if ((state.role === 'guesser' && ['drawing', 'grace'].includes(state.phase)) || (state.role === 'stealer' && state.phase === 'steal')) {
    return <GuessCard state={state} socket={socket} setError={setError} />;
  }
  const message = state.role === 'rival' ? 'Observa el dibujo. Si fallan, tendrás 10 segundos para robar.' : 'Espera a que comience el siguiente turno.';
  return <section className="role-card"><p className="eyebrow">EN ESPERA</p><h1>{state.activeTeamId ? `JUEGA EL EQUIPO ${state.activeTeamId}` : 'PREPÁRATE'}</h1><p>{message}</p></section>;
}

function GuessCard({ state, socket, setError }: { state: PlayerState; socket: Socket; setError: (v: string) => void }) {
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await emitAck<'correct' | 'incorrect'>(socket, 'guess:submit', { answer });
    if (!result.ok) setError(result.message);
    else { setFeedback(result.data === 'correct' ? '¡CORRECTO!' : 'No es. Intenta otra vez.'); setAnswer(''); }
  };
  if (state.answeredCorrectly) return <section className="role-card correct-card"><span className="burst-icon">✓</span><h1>¡LO SABES!</h1><p>Tu avatar ya brilla en la pantalla.</p></section>;
  if (!state.attemptsLeft) return <section className="role-card locked-card"><h1>SIN INTENTOS</h1><p>Espera al siguiente turno.</p></section>;
  return <form className="role-card guess-card" onSubmit={submit}>
    <p className="eyebrow">{state.role === 'stealer' ? '¡ROBA 250 PUNTOS!' : state.phase === 'grace' ? 'TIEMPO DE GRACIA' : 'TU RESPUESTA'}</p>
    <h1>¿QUÉ ESTÁ DIBUJANDO?</h1>
    <label className="sr-only" htmlFor="answer">Respuesta</label>
    <input id="answer" value={answer} onChange={e => setAnswer(e.target.value)} maxLength={80} autoComplete="off" autoFocus placeholder="Escribe aquí..." />
    <button className="button primary" disabled={!answer.trim()}>ENVIAR</button>
    <div className="attempts">INTENTOS: {Array.from({ length: 3 }, (_, i) => <span className={i < state.attemptsLeft ? 'active' : ''} key={i} />)}</div>
    {feedback && <p className={feedback.startsWith('¡') ? 'success-text' : 'form-error'}>{feedback}</p>}
  </form>;
}
