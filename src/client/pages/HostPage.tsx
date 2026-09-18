import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { PublicState, ScoreEffect, TeamId } from '../../shared/types';
import { connectSocket, eventTokenFromUrl } from '../socket';
import { Avatar } from '../components/Avatar';
import { GameCanvas } from '../components/GameCanvas';
import { Scoreboard } from '../components/Scoreboard';
import { Timer } from '../components/Timer';

const phaseText: Record<PublicState['phase'], string> = {
  lobby: 'LOBBY', betweenTurns: 'SIGUIENTE TURNO', reveal: 'PREPÁRATE', drawing: '¡DIBUJA!',
  grace: 'TIEMPO DE GRACIA', steal: '¡ROBO!', results: 'RESULTADOS', paused: 'PAUSA', finished: 'FIN DE PARTIDA',
};

export function HostPage() {
  const token = useRef(eventTokenFromUrl()).current;
  const [state, setState] = useState<PublicState | null>(null);
  const [qr, setQr] = useState('');
  const [effect, setEffect] = useState<ScoreEffect | null>(null);
  const [majority, setMajority] = useState(false);

  useEffect(() => {
    if (!token) return;
    const socket = connectSocket({ viewer: 'host', eventToken: token });
    socket.on('state:public', setState);
    socket.on('timer:sync', value => setState(current => current ? { ...current, ...value } : current));
    socket.on('score:changed', (value: ScoreEffect) => { setEffect(value); setTimeout(() => setEffect(null), 1800); });
    socket.on('phase:changed', ({ phase }) => { if (phase === 'grace') { setMajority(true); setTimeout(() => setMajority(false), 2200); } });
    return () => { socket.disconnect(); };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const url = `${location.origin}/player#${token}`;
    void QRCode.toDataURL(url, { width: 320, margin: 1, color: { dark: '#101018', light: '#ffffff' } }).then(setQr);
  }, [token]);

  if (!token) return <TokenMissing title="Pantalla Host" />;
  if (!state) return <main className="center-page scanlines"><div className="loader">CARGANDO PARTIDA...</div></main>;

  const teams = (id: TeamId) => state.players.filter(p => p.teamId === id);
  const demoHumans = state.mode === 'demo' ? state.players.filter(player => player.demoRole) : [];
  return <main className="host-page scanlines">
    <Scoreboard a={state.scores.A} b={state.scores.B} center={<div className="host-timer"><Timer endsAt={state.phaseEndsAt} serverNow={state.serverNow} urgent={state.phase === 'grace'} /><small>{phaseText[state.phase]}</small></div>} />
    <section className="host-stage">
      <TeamRail team="A" players={teams('A')} guessed={state.activeTeamId === 'A' ? state.guessed : 0} eligible={state.activeTeamId === 'A' ? state.eligible : teams('A').length} />
      <div className="host-canvas-area">
        <div className="round-strip"><span>RONDA {state.roundNumber ?? '—'}/5 {state.mode === 'demo' && <b className="demo-badge">DEMO</b>}</span><strong>{state.activeTeamId ? `TURNO EQUIPO ${state.activeTeamId}` : phaseText[state.phase]}</strong></div>
        {demoHumans.length > 0 && <div className="host-demo-roles">{demoHumans.map(player => <span key={player.id}><b>{player.demoRole === 'drawer' ? 'DIBUJA' : 'ADIVINA'}</b> {player.name}</span>)}</div>}
        <GameCanvas strokes={state.strokes} />
        {state.phase === 'lobby' && <div className="canvas-overlay lobby-overlay">
          {qr && <img src={qr} alt="Código QR para entrar al evento" />}
          <h2>ESCANEA Y ENTRA</h2><p>{state.players.length}/100 jugadores</p>
        </div>}
        {state.phase === 'paused' && <div className="canvas-overlay"><h2>JUEGO EN PAUSA</h2><p>{state.players.some(player => player.demoRole && !player.connected) ? `Esperando a ${state.players.filter(player => player.demoRole && !player.connected).map(player => player.name).join(' y ')}` : 'El Admin reanudará la partida'}</p></div>}
        {state.phase === 'results' && <div className="canvas-overlay result-overlay"><p>LA PALABRA ERA</p><h2>{state.lastWord}</h2></div>}
        {state.phase === 'finished' && <div className="canvas-overlay result-overlay"><p>CAMPEÓN</p><h2>{state.scores.A === state.scores.B ? 'EMPATE' : `EQUIPO ${state.scores.A > state.scores.B ? 'A' : 'B'}`}</h2></div>}
      </div>
      <TeamRail team="B" players={teams('B')} guessed={state.activeTeamId === 'B' ? state.guessed : 0} eligible={state.activeTeamId === 'B' ? state.eligible : teams('B').length} />
    </section>
    {majority && <div className="impact-overlay majority-impact"><span>BONUS STAGE</span><strong>¡MAYORÍA<br />ALCANZADA!</strong></div>}
    {state.phase === 'grace' && !majority && <div className="grace-banner">ÚLTIMOS 5 SEGUNDOS DE GRACIA</div>}
    {effect && <div className={`points-effect team-${effect.teamId}`}>+{effect.points}<small>{effect.reason === 'steal' ? ' ROBO' : ''}</small></div>}
    <button className="fullscreen-button" aria-label="Pantalla completa" onClick={() => void document.documentElement.requestFullscreen()}>⛶</button>
  </main>;
}

function TeamRail({ team, players, guessed, eligible }: { team: TeamId; players: PublicState['players']; guessed: number; eligible: number }) {
  return <aside className={`team-rail team-${team}`}>
    <div className="rail-title"><span>EQUIPO {team}</span><strong>{guessed}/{eligible}</strong><small>ADIVINARON</small></div>
    <div className="avatar-grid">{players.map(player => <Avatar key={player.id} player={player} compact />)}</div>
  </aside>;
}

function TokenMissing({ title }: { title: string }) {
  const [value, setValue] = useState('');
  return <main className="center-page scanlines"><form className="panel token-form" onSubmit={event => { event.preventDefault(); location.hash = value.trim(); location.reload(); }}>
    <p className="eyebrow">{title}</p><h1>FALTA EL TOKEN</h1><label>Token del evento<input value={value} onChange={e => setValue(e.target.value)} required /></label><button className="button primary">Conectar</button>
  </form></main>;
}
