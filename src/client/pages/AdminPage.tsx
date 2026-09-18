import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { AdminState, TeamId, WordCard } from '../../shared/types';
import { connectSocket, emitAck } from '../socket';
import { Avatar } from '../components/Avatar';

type SetupMode = 'demo' | 'live';
type Notice = { kind: 'error' | 'success'; text: string };

export function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  useEffect(() => { void fetch('/api/admin/session').then(r => setAuthenticated(r.ok)).catch(() => setAuthenticated(false)); }, []);
  if (authenticated === null) return <main className="center-page"><div className="loader">VERIFICANDO...</div></main>;
  if (!authenticated) return <AdminLogin onSuccess={() => setAuthenticated(true)} />;
  return <AdminDashboard onLogout={() => setAuthenticated(false)} />;
}

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const response = await fetch('/api/admin/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    const data = await response.json();
    if (response.ok) onSuccess(); else setError(data.message ?? 'No se pudo iniciar sesión. Revisa el código e inténtalo otra vez.');
  };
  return <main className="center-page scanlines"><form className="panel login-card" onSubmit={submit}>
    <p className="eyebrow">CONTROL DE PARTIDA</p><h1>ADMIN</h1>
    <p>Introduce el código para preparar y dirigir la partida.</p>
    <label>Código de acceso<input type="password" value={code} onChange={e => setCode(e.target.value)} minLength={8} required autoFocus /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button primary">Entrar al panel</button>
  </form></main>;
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const socket = useMemo(() => connectSocket(), []);
  const [state, setState] = useState<AdminState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [qr, setQr] = useState('');
  const [step, setStep] = useState(1);
  const [setupMode, setSetupMode] = useState<SetupMode | null>(null);
  const [drawerId, setDrawerId] = useState('');
  const stepHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { socket.on('state:admin', setState); return () => { socket.disconnect(); }; }, [socket]);
  useEffect(() => { if (state) void QRCode.toDataURL(`${location.origin}/player#${state.eventToken}`, { width: 220, margin: 1 }).then(setQr); }, [state?.eventToken]);
  useEffect(() => { if (state?.phase === 'lobby') stepHeading.current?.focus(); }, [step, state?.phase]);

  const send = async (event: string, payload?: unknown, success?: string) => {
    setNotice(null);
    const result = await emitAck(socket, event, payload);
    if (!result.ok) { setNotice({ kind: 'error', text: result.message }); return false; }
    if (success) setNotice({ kind: 'success', text: success });
    return true;
  };
  const logout = async () => { await fetch('/api/admin/session', { method: 'DELETE' }); socket.disconnect(); onLogout(); };
  if (!state) return <main className="center-page"><div className="loader">ABRIENDO PANEL...</div></main>;

  const humans = state.players.filter(player => !player.npc);
  const connectedHumans = humans.filter(player => player.connected);
  const connectedA = connectedHumans.filter(player => player.teamId === 'A');
  const connectedB = connectedHumans.filter(player => player.teamId === 'B');
  const demoReady = connectedHumans.length === 2;
  const liveReady = connectedA.length >= 2 && connectedA.length === connectedB.length;
  const selectedDrawer = connectedHumans.find(player => player.id === drawerId);
  const selectedGuesser = connectedHumans.find(player => player.id !== drawerId);
  const nextAllowed = step === 1 ? Boolean(setupMode)
    : step === 2 ? setupMode === 'demo' ? demoReady : connectedHumans.length >= 4
      : setupMode === 'demo' ? demoReady && Boolean(selectedDrawer) : liveReady;

  const copyAccess = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/player#${state.eventToken}`);
      setNotice({ kind: 'success', text: 'Enlace de jugadores copiado.' });
    } catch { setNotice({ kind: 'error', text: 'No se pudo copiar. Selecciona el enlace y cópialo manualmente.' }); }
  };

  return <main className="admin-page">
    <header className="admin-header">
      <div><p className="eyebrow">CONTROL DE PARTIDA</p><h1>GARABATO PARTY {state.mode === 'demo' && <span className="demo-badge">DEMO</span>}</h1></div>
      {state.phase !== 'lobby' && <div className="admin-score" aria-label={`Equipo A ${state.scores.A}, Equipo B ${state.scores.B}`}><span>A</span><strong>{state.scores.A}</strong><i>VS</i><strong>{state.scores.B}</strong><span>B</span></div>}
      <div className="header-actions"><a className="button secondary" href={`/host#${state.eventToken}`} target="_blank" rel="noreferrer">Abrir pantalla Host</a><button className="button ghost" onClick={logout}>Cerrar sesión</button></div>
    </header>

    {notice && <div className={`admin-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'} aria-live="polite"><span>{notice.text}</span><button aria-label="Cerrar aviso" onClick={() => setNotice(null)}>×</button></div>}

    {state.phase === 'lobby'
      ? <SetupWizard state={state} step={step} mode={setupMode} setMode={mode => { setSetupMode(mode); setDrawerId(''); }} drawerId={drawerId} setDrawerId={setDrawerId}
          qr={qr} humans={humans} connectedHumans={connectedHumans} demoReady={demoReady} liveReady={liveReady} selectedDrawer={selectedDrawer} selectedGuesser={selectedGuesser}
          nextAllowed={nextAllowed} headingRef={stepHeading} send={send} copyAccess={copyAccess} onBack={() => setStep(value => Math.max(1, value - 1))} onNext={() => setStep(value => Math.min(4, value + 1))} />
      : <GameCockpit state={state} send={send} headingRef={stepHeading} />}

    <section className="admin-secondary" aria-label="Opciones secundarias">
      <details><summary>Jugadores y equipos <span>{state.players.filter(player => player.connected).length} conectados</span></summary><Roster state={state} send={send} editable={state.phase === 'lobby'} /></details>
      <details><summary>Banco de palabras <span>{state.words.filter(word => word.enabled).length} activas</span></summary><WordBank state={state} send={send} /></details>
      <details><summary>Historial de puntos <span>{state.scoreEntries.length} movimientos</span></summary><ScoreLedger state={state} /></details>
    </section>
  </main>;
}

function SetupWizard({ state, step, mode, setMode, drawerId, setDrawerId, qr, humans, connectedHumans, demoReady, liveReady, selectedDrawer, selectedGuesser, nextAllowed, headingRef, send, copyAccess, onBack, onNext }: {
  state: AdminState; step: number; mode: SetupMode | null; setMode: (mode: SetupMode) => void; drawerId: string; setDrawerId: (id: string) => void;
  qr: string; humans: AdminState['players']; connectedHumans: AdminState['players']; demoReady: boolean; liveReady: boolean;
  selectedDrawer?: AdminState['players'][number]; selectedGuesser?: AdminState['players'][number]; nextAllowed: boolean;
  headingRef: React.RefObject<HTMLHeadingElement | null>; send: (event: string, payload?: unknown, success?: string) => Promise<boolean>;
  copyAccess: () => Promise<void>; onBack: () => void; onNext: () => void;
}) {
  const start = () => mode === 'demo'
    ? void send('admin:demo:start', { drawerId }, 'Demo iniciada. Las fases avanzarán automáticamente.')
    : void send('admin:match:start', undefined, 'Partida iniciada.');
  const requirement = mode === 'demo'
    ? connectedHumans.length < 2 ? `Faltan ${2 - connectedHumans.length} jugadores.` : connectedHumans.length > 2 ? `Hay ${connectedHumans.length}. Quita ${connectedHumans.length - 2} para continuar.` : 'Los dos jugadores están listos.'
    : connectedHumans.length < 4 ? `Conecta al menos ${4 - connectedHumans.length} jugadores más.` : 'Ya puedes preparar los equipos.';

  return <section className="setup-shell">
    <ol className="setup-steps" aria-label="Preparación de partida">{['Modo', 'Jugadores', 'Preparar', 'Revisar'].map((label, index) => <li key={label} className={step === index + 1 ? 'current' : step > index + 1 ? 'done' : ''} aria-current={step === index + 1 ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
    <div className="panel setup-card">
      {step === 1 && <><p className="eyebrow">PASO 1 DE 4</p><h2 ref={headingRef} tabIndex={-1}>¿Qué vas a jugar?</h2><p className="step-copy">Elige un modo. Te mostraremos únicamente los pasos necesarios.</p>
        <div className="mode-options"><button className={mode === 'demo' ? 'mode-card selected' : 'mode-card'} aria-pressed={mode === 'demo'} onClick={() => setMode('demo')}><strong>Demo para 2 personas</strong><span>Una dibuja, otra adivina y 8 NPCs completan los equipos.</span><small>Ideal para probar el MVP</small></button><button className={mode === 'live' ? 'mode-card selected' : 'mode-card'} aria-pressed={mode === 'live'} onClick={() => setMode('live')}><strong>Partida en vivo</strong><span>Dos equipos humanos, equilibrados y con al menos 2 personas cada uno.</span><small>Para el evento real</small></button></div></>}

      {step === 2 && <><p className="eyebrow">PASO 2 DE 4</p><h2 ref={headingRef} tabIndex={-1}>Conecta {mode === 'demo' ? '2 jugadores' : 'a los jugadores'}</h2><p className="step-copy">Abre el enlace en cada teléfono o escanea el QR. Esta pantalla se actualiza sola.</p>
        <div className="connect-layout"><div className="qr-card">{qr && <img src={qr} alt="QR para conectar jugadores" />}<button className="button secondary" onClick={() => void copyAccess()}>Copiar enlace</button></div><div className="connected-list"><div className={`readiness ${nextAllowed ? 'ready' : ''}`} role="status" aria-live="polite"><strong>{connectedHumans.length}{mode === 'demo' ? '/2' : ''} conectados</strong><span>{requirement}</span></div>{humans.map(player => <div className="connected-player" key={player.id}><Avatar player={player} compact /><span>{player.connected ? 'Conectado' : 'Sin conexión'}</span><button className="text-action danger-text" onClick={() => confirm(`¿Quitar a ${player.name}?`) && void send('admin:player:remove', { playerId: player.id }, `${player.name} fue retirado.`)}>Quitar jugador</button></div>)}{!humans.length && <p className="empty">Aún no hay jugadores. Mantén esta pantalla abierta mientras escanean.</p>}</div></div></>}

      {step === 3 && mode === 'demo' && <><p className="eyebrow">PASO 3 DE 4</p><h2 ref={headingRef} tabIndex={-1}>Elige quién dibuja</h2><p className="step-copy">La otra persona será el adivinador durante todos los turnos y los robos.</p><div className="role-options">{connectedHumans.map(player => <button key={player.id} className={drawerId === player.id ? 'role-option selected' : 'role-option'} aria-pressed={drawerId === player.id} onClick={() => setDrawerId(player.id)}><Avatar player={player} compact /><span><strong>{player.name}</strong><small>{drawerId === player.id ? 'Dibujante' : drawerId ? 'Adivinador' : 'Elegir como dibujante'}</small></span></button>)}</div>{!demoReady && <p className="inline-guidance" role="status">Vuelve al paso anterior y deja exactamente dos jugadores conectados.</p>}</>}

      {step === 3 && mode === 'live' && <><p className="eyebrow">PASO 3 DE 4</p><h2 ref={headingRef} tabIndex={-1}>Forma dos equipos iguales</h2><p className="step-copy">Cada equipo necesita al menos 2 personas conectadas. Usa los botones con el nombre completo del equipo.</p><Roster state={state} send={send} editable /><p className={`inline-guidance ${liveReady ? 'success-text' : ''}`} role="status">{liveReady ? 'Equipos equilibrados y listos.' : 'Los equipos todavía no tienen el mismo número de jugadores conectados.'}</p></>}

      {step === 4 && <><p className="eyebrow">PASO 4 DE 4</p><h2 ref={headingRef} tabIndex={-1}>Todo listo para empezar</h2>{mode === 'demo' ? <div className="start-summary"><RoleSummary label="Dibujante" player={selectedDrawer} /><RoleSummary label="Adivinador" player={selectedGuesser} /><p>8 NPCs completarán los equipos y responderán automáticamente.</p></div> : <div className="start-summary"><strong>Equipo A: {state.players.filter(player => player.connected && player.teamId === 'A').length}</strong><strong>Equipo B: {state.players.filter(player => player.connected && player.teamId === 'B').length}</strong><p>La partida tendrá 5 rondas y 10 turnos.</p></div>}<button className="button primary start-button" disabled={!nextAllowed} onClick={start}>{mode === 'demo' ? 'Iniciar demo' : 'Iniciar partida'}</button>{!nextAllowed && <p className="inline-guidance" role="status">Revisa el paso anterior antes de iniciar.</p>}</>}

      <div className="wizard-actions">{step > 1 && <button className="button ghost" onClick={onBack}>Volver</button>}{step < 4 && <button className="button primary" disabled={!nextAllowed} onClick={onNext}>Continuar</button>}</div>
    </div>
  </section>;
}

function RoleSummary({ label, player }: { label: string; player?: AdminState['players'][number] }) {
  return <div className="role-summary"><span>{label}</span>{player ? <><Avatar player={player} compact /><strong>{player.name}</strong></> : <strong>Sin elegir</strong>}</div>;
}

function GameCockpit({ state, send, headingRef }: { state: AdminState; send: (event: string, payload?: unknown, success?: string) => Promise<boolean>; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  const missingDemoPlayers = state.mode === 'demo' ? state.players.filter(player => player.demoRole && !player.connected) : [];
  return <section className="cockpit-shell"><div className="panel now-card"><div><p className="eyebrow">AHORA</p><h2 ref={headingRef} tabIndex={-1}>{labelPhase(state.phase)}</h2><p>{phaseInstruction(state.phase)}</p></div><div className="now-meta"><span>Ronda {state.roundNumber ?? '—'} de 5</span>{state.currentWord && <span>Palabra: <strong>{state.currentWord.word}</strong></span>}</div><div className="now-action">{['reveal', 'drawing', 'grace', 'steal'].includes(state.phase) && <p className="automatic-note">Las fases avanzan automáticamente.</p>}{['results', 'betweenTurns'].includes(state.phase) && <button className="button primary" onClick={() => void send('admin:turn:next', undefined, 'Siguiente turno preparado.')}>Siguiente turno</button>}{state.phase === 'paused' && <><button className="button primary" disabled={missingDemoPlayers.length > 0} onClick={() => void send('admin:match:resume', undefined, 'Partida reanudada.')}>Reanudar partida</button>{missingDemoPlayers.length > 0 && <p className="inline-guidance" role="status">Esperando a {missingDemoPlayers.map(player => player.name).join(' y ')}.</p>}</>}{state.phase === 'finished' && <button className="button primary" onClick={() => confirm('Se borrarán jugadores, equipos y puntajes. ¿Crear una nueva partida?') && void send('admin:match:new', undefined, 'Nueva partida creada.')}>Crear nueva partida</button>}</div></div>
    {state.mode === 'demo' && <div className="human-role-strip">{state.players.filter(player => player.demoRole).map(player => <div key={player.id}><span>{player.demoRole === 'drawer' ? 'Dibujante' : 'Adivinador'}</span><strong>{player.name}</strong><small>{player.connected ? 'Conectado' : 'Sin conexión'}</small></div>)}</div>}
    <details className="advanced-controls"><summary>Más controles</summary><div>{['reveal', 'drawing', 'grace', 'steal'].includes(state.phase) && <button className="button secondary" onClick={() => void send('admin:match:pause', undefined, 'Partida pausada.')}>Pausar partida</button>}{state.currentWord && state.phase !== 'finished' && <button className="button warning" onClick={() => confirm('Se revertirán los puntos de este turno y se usará otra palabra. ¿Repetir?') && void send('admin:turn:repeat', undefined, 'Turno repetido con una palabra nueva.')}>Repetir este turno</button>}{state.currentWord && state.phase !== 'finished' && <button className="button danger" onClick={() => confirm('Se revertirán los puntos y se saltará este turno. ¿Anular?') && void send('admin:turn:annul', undefined, 'Turno anulado.')}>Anular este turno</button>}{state.phase !== 'finished' && <button className="button danger" onClick={() => confirm('¿Terminar la partida antes de completar los 10 turnos?') && void send('admin:match:finish', undefined, 'Partida finalizada.')}>Terminar partida ahora</button>}</div></details>
  </section>;
}

function Roster({ state, send, editable }: { state: AdminState; send: (event: string, payload?: unknown, success?: string) => Promise<boolean>; editable: boolean }) {
  const players = (team: TeamId | null) => state.players.filter(player => !player.npc && player.teamId === team);
  return <div className="roster-columns"><TeamColumn title="Sin equipo" team={null} players={players(null)} send={send} editable={editable} /><TeamColumn title="Equipo A" team="A" players={players('A')} send={send} editable={editable} /><TeamColumn title="Equipo B" team="B" players={players('B')} send={send} editable={editable} /></div>;
}

function TeamColumn({ title, team, players, send, editable }: { title: string; team: TeamId | null; players: AdminState['players']; send: (event: string, payload?: unknown, success?: string) => Promise<boolean>; editable: boolean }) {
  return <div className={`team-column team-${team ?? 'none'}`}><h3>{title} <span>{players.length}</span></h3><div className="roster-list">{players.map(player => <div className="roster-player" key={player.id}><Avatar player={player} compact />{player.demoRole && <span className="role-chip">{player.demoRole === 'drawer' ? 'Dibujante' : 'Adivinador'}</span>}<div className="roster-actions">{editable && <>{team !== 'A' && <button onClick={() => void send('admin:player:assign', { playerId: player.id, teamId: 'A' }, `${player.name} pasó al Equipo A.`)}>Equipo A</button>}{team !== 'B' && <button onClick={() => void send('admin:player:assign', { playerId: player.id, teamId: 'B' }, `${player.name} pasó al Equipo B.`)}>Equipo B</button>}{team && <button onClick={() => void send('admin:player:assign', { playerId: player.id, teamId: null }, `${player.name} quedó sin equipo.`)}>Sin equipo</button>}</>}</div></div>)}{!players.length && <p className="empty">Ninguno</p>}</div></div>;
}

function WordBank({ state, send }: { state: AdminState; send: (event: string, payload?: unknown, success?: string) => Promise<boolean> }) {
  const empty = { word: '', aliases: '', difficulty: 'easy' as const, enabled: true };
  const [form, setForm] = useState<{ word: string; aliases: string; difficulty: 'easy' | 'hard'; enabled: boolean }>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const submit = async (event: React.FormEvent) => { event.preventDefault(); const value = { ...form, aliases: form.aliases.split('|').map(item => item.trim()).filter(Boolean) }; const done = await send(editing ? 'admin:word:update' : 'admin:word:create', editing ? { id: editing, value } : value, editing ? 'Palabra actualizada.' : 'Palabra agregada.'); if (done) { setForm(empty); setEditing(null); } };
  const edit = (word: WordCard) => { setEditing(word.id); setForm({ word: word.word, aliases: word.aliases.join(' | '), difficulty: word.difficulty, enabled: word.enabled }); };
  const importCsv = async (file?: File) => { if (file) await send('admin:words:import', { csv: await file.text() }, 'Archivo de palabras importado.'); };
  const visible = state.words.filter(word => word.word.toLocaleLowerCase('es').includes(filter.toLocaleLowerCase('es')));
  return <div className="word-panel"><div className="section-title"><div><h2>Banco de palabras</h2><p>Edita el contenido usado en las partidas.</p></div><label className="button secondary file-button">Importar archivo CSV<input type="file" accept=".csv,text/csv" onChange={event => void importCsv(event.target.files?.[0])} /></label></div><form className="word-form" onSubmit={submit}><label>Palabra<input value={form.word} onChange={event => setForm({ ...form, word: event.target.value })} required /></label><label>Alias, separados por |<input value={form.aliases} onChange={event => setForm({ ...form, aliases: event.target.value })} /></label><label>Dificultad<select value={form.difficulty} onChange={event => setForm({ ...form, difficulty: event.target.value as 'easy' | 'hard' })}><option value="easy">Fácil</option><option value="hard">Difícil</option></select></label><label className="check-label"><input type="checkbox" checked={form.enabled} onChange={event => setForm({ ...form, enabled: event.target.checked })} /> Disponible</label><button className="button primary">{editing ? 'Guardar cambios' : 'Agregar palabra'}</button>{editing && <button type="button" className="button ghost" onClick={() => { setEditing(null); setForm(empty); }}>Cancelar edición</button>}</form><label className="search-label">Buscar palabras<input className="word-search" placeholder="Escribe para filtrar..." value={filter} onChange={event => setFilter(event.target.value)} /></label><div className="word-table"><div className="word-row word-head"><span>Palabra</span><span>Nivel</span><span>Estado</span><span>Acciones</span></div>{visible.slice(0, 100).map(word => <div className="word-row" key={word.id}><span><strong>{word.word}</strong><small>{word.aliases.join(', ')}</small></span><span>{word.difficulty === 'easy' ? 'Fácil' : 'Difícil'}</span><span>{word.enabled ? 'Disponible' : 'Desactivada'}</span><span><button onClick={() => edit(word)}>Editar</button><button className="remove" onClick={() => confirm(`¿Eliminar “${word.word}”?`) && void send('admin:word:delete', { id: word.id }, 'Palabra eliminada.')}>Eliminar</button></span></div>)}</div></div>;
}

function ScoreLedger({ state }: { state: AdminState }) {
  return <div className="ledger-list">{[...state.scoreEntries].reverse().slice(0, 30).map(entry => <div key={entry.id} className={`ledger-item team-${entry.teamId}`}><strong>+{entry.points}</strong><span>Equipo {entry.teamId} · {labelReason(entry.reason)}</span></div>)}{!state.scoreEntries.length && <p className="empty">Aún no hay puntos. Aparecerán aquí durante la partida.</p>}</div>;
}

const labelPhase = (phase: AdminState['phase']) => ({ lobby: 'Preparación', betweenTurns: 'Turno terminado', reveal: 'El dibujante memoriza la palabra', drawing: 'Dibujando', grace: 'Tiempo de gracia', steal: 'Turno de robo', results: 'Revisa el resultado', paused: 'Partida en pausa', finished: 'Partida terminada' })[phase];
const phaseInstruction = (phase: AdminState['phase']) => ({ lobby: '', betweenTurns: 'Cuando todos estén listos, prepara el siguiente turno.', reveal: 'La palabra solo se muestra al dibujante. Espera unos segundos.', drawing: 'Los jugadores están respondiendo. Observa la pantalla Host.', grace: 'Quedan cinco segundos para los últimos aciertos.', steal: 'El equipo rival tiene una oportunidad para responder.', results: 'La palabra y los puntos ya están visibles. Avanza cuando el grupo esté listo.', paused: 'La partida no avanzará hasta que la reanudes.', finished: 'Revisa el marcador final o crea una partida nueva.' })[phase];
const labelReason = (reason: AdminState['scoreEntries'][number]['reason']) => ({ normal: 'Acierto', grace: 'Gracia', speed: 'Velocidad', 'full-team': 'Equipo completo', steal: 'Robo' })[reason];
