import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import type { Socket } from 'socket.io-client';
import type { AdminState, TeamId, WordCard } from '../../shared/types';
import { connectSocket, emitAck } from '../socket';
import { Avatar } from '../components/Avatar';

export function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  useEffect(() => { void fetch('/api/admin/session').then(r => setAuthenticated(r.ok)).catch(() => setAuthenticated(false)); }, []);
  if (authenticated === null) return <main className="center-page"><div className="loader">VERIFICANDO...</div></main>;
  if (!authenticated) return <AdminLogin onSuccess={() => setAuthenticated(true)} />;
  return <AdminDashboard onLogout={() => setAuthenticated(false)} />;
}

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [code, setCode] = useState(''); const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const response = await fetch('/api/admin/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    const data = await response.json(); if (response.ok) onSuccess(); else setError(data.message ?? 'No se pudo iniciar sesión.');
  };
  return <main className="center-page scanlines"><form className="panel login-card" onSubmit={submit}><p className="eyebrow">CONTROL ROOM</p><h1>ADMIN</h1><label>Código de acceso<input type="password" value={code} onChange={e => setCode(e.target.value)} minLength={8} required autoFocus /></label>{error && <p className="form-error">{error}</p>}<button className="button primary">ENTRAR</button></form></main>;
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const socket = useMemo(() => connectSocket(), []);
  const [state, setState] = useState<AdminState | null>(null);
  const [notice, setNotice] = useState('');
  const [qr, setQr] = useState('');
  useEffect(() => { socket.on('state:admin', setState); return () => { socket.disconnect(); }; }, [socket]);
  useEffect(() => { if (state) void QRCode.toDataURL(`${location.origin}/player#${state.eventToken}`, { width: 220, margin: 1 }).then(setQr); }, [state?.eventToken]);
  const send = async (event: string, payload?: unknown) => {
    setNotice(''); const result = await emitAck(socket, event, payload);
    if (!result.ok) setNotice(result.message); return result.ok;
  };
  const logout = async () => { await fetch('/api/admin/session', { method: 'DELETE' }); socket.disconnect(); onLogout(); };
  if (!state) return <main className="center-page"><div className="loader">ABRIENDO PANEL...</div></main>;
  const players = (team: TeamId | null) => state.players.filter(p => p.teamId === team);
  return <main className="admin-page">
    <header className="admin-header"><div><p className="eyebrow">CONTROL ROOM</p><h1>GARABATO PARTY</h1></div><div className="admin-score"><span>A</span><strong>{state.scores.A}</strong><i>VS</i><strong>{state.scores.B}</strong><span>B</span></div><div className="header-actions"><a className="button secondary" href={`/host#${state.eventToken}`} target="_blank">Abrir Host</a><button className="button ghost" onClick={logout}>Salir</button></div></header>
    {notice && <div className="admin-notice" role="alert">{notice}<button onClick={() => setNotice('')}>×</button></div>}
    <div className="admin-grid">
      <section className="panel admin-game">
        <div className="section-title"><div><p className="eyebrow">PARTIDA</p><h2>Ronda {state.roundNumber ?? '—'} · {labelPhase(state.phase)}</h2></div>{state.currentWord && <div className="current-word"><span>PALABRA</span><strong>{state.currentWord.word}</strong></div>}</div>
        <div className="control-grid">
          {state.phase === 'lobby' && <><button className="button secondary" onClick={() => void send('admin:lobby:set', { open: !state.lobbyOpen })}>{state.lobbyOpen ? 'Cerrar lobby' : 'Abrir lobby'}</button><button className="button primary" onClick={() => void send('admin:match:start')}>Iniciar partida</button></>}
          {['reveal', 'drawing', 'grace', 'steal'].includes(state.phase) && <button className="button secondary" onClick={() => void send('admin:match:pause')}>Pausar</button>}
          {state.phase === 'paused' && <button className="button primary" onClick={() => void send('admin:match:resume')}>Reanudar</button>}
          {['results', 'betweenTurns'].includes(state.phase) && <button className="button primary" onClick={() => void send('admin:turn:next')}>Siguiente turno</button>}
          {state.currentWord && !['lobby', 'finished'].includes(state.phase) && <><button className="button warning" onClick={() => confirm('¿Revertir puntos y repetir con nueva palabra/dibujante?') && void send('admin:turn:repeat')}>Repetir</button><button className="button danger" onClick={() => confirm('¿Anular este turno y revertir sus puntos?') && void send('admin:turn:annul')}>Anular</button></>}
          {!['lobby', 'finished'].includes(state.phase) && <button className="button danger" onClick={() => confirm('¿Terminar la partida ahora?') && void send('admin:match:finish')}>Terminar</button>}
          {state.phase === 'finished' && <button className="button danger" onClick={() => confirm('Se borrarán jugadores, equipos y puntajes. ¿Continuar?') && void send('admin:match:new')}>Nueva partida</button>}
        </div>
        <div className="event-access">{qr && <img src={qr} alt="QR del evento" />}<div><span>ACCESO JUGADORES</span><code>{`${location.origin}/player#${state.eventToken}`}</code><small>{state.lobbyOpen ? 'Lobby abierto' : 'Lobby cerrado'} · {state.players.length}/100</small></div></div>
      </section>
      <section className="panel roster-panel"><div className="section-title"><div><p className="eyebrow">LOBBY</p><h2>Jugadores</h2></div><span className="status-pill">{state.players.filter(p => p.connected).length} conectados</span></div>
        <TeamColumn title="Sin equipo" team={null} players={players(null)} socket={socket} send={send} editable={state.phase === 'lobby'} />
        <div className="teams-row"><TeamColumn title="Equipo A" team="A" players={players('A')} socket={socket} send={send} editable={state.phase === 'lobby'} /><TeamColumn title="Equipo B" team="B" players={players('B')} socket={socket} send={send} editable={state.phase === 'lobby'} /></div>
      </section>
      <WordBank state={state} socket={socket} send={send} />
      <section className="panel ledger-panel"><div className="section-title"><div><p className="eyebrow">AUDITORÍA</p><h2>Puntos</h2></div></div><div className="ledger-list">{[...state.scoreEntries].reverse().slice(0, 30).map(entry => <div key={entry.id} className={`ledger-item team-${entry.teamId}`}><strong>+{entry.points}</strong><span>Equipo {entry.teamId} · {labelReason(entry.reason)}</span></div>)}{!state.scoreEntries.length && <p className="empty">Aún no hay puntos.</p>}</div></section>
    </div>
  </main>;
}

function TeamColumn({ title, team, players, send, editable }: { title: string; team: TeamId | null; players: AdminState['players']; socket: Socket; send: (e: string, p?: unknown) => Promise<boolean>; editable: boolean }) {
  return <div className={`team-column team-${team ?? 'none'}`}><h3>{title} <span>{players.length}</span></h3><div className="roster-list">{players.map(player => <div className="roster-player" key={player.id}><Avatar player={player} compact /><div className="roster-actions">{editable && <><button aria-label="Asignar al equipo A" onClick={() => void send('admin:player:assign', { playerId: player.id, teamId: 'A' })}>A</button><button aria-label="Asignar al equipo B" onClick={() => void send('admin:player:assign', { playerId: player.id, teamId: 'B' })}>B</button>{team && <button aria-label="Quitar del equipo" onClick={() => void send('admin:player:assign', { playerId: player.id, teamId: null })}>—</button>}<button className="remove" aria-label="Expulsar" onClick={() => confirm(`¿Expulsar a ${player.name}?`) && void send('admin:player:remove', { playerId: player.id })}>×</button></>}</div></div>)}</div></div>;
}

function WordBank({ state, socket, send }: { state: AdminState; socket: Socket; send: (e: string, p?: unknown) => Promise<boolean> }) {
  const empty = { word: '', aliases: '', difficulty: 'easy' as const, enabled: true };
  const [form, setForm] = useState<{ word: string; aliases: string; difficulty: 'easy' | 'hard'; enabled: boolean }>(empty);
  const [editing, setEditing] = useState<string | null>(null); const [filter, setFilter] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); const value = { ...form, aliases: form.aliases.split('|').map(x => x.trim()).filter(Boolean) };
    const done = await send(editing ? 'admin:word:update' : 'admin:word:create', editing ? { id: editing, value } : value);
    if (done) { setForm(empty); setEditing(null); }
  };
  const edit = (word: WordCard) => { setEditing(word.id); setForm({ word: word.word, aliases: word.aliases.join(' | '), difficulty: word.difficulty, enabled: word.enabled }); };
  const importCsv = async (file?: File) => { if (file) await send('admin:words:import', { csv: await file.text() }); };
  const visible = state.words.filter(w => w.word.toLocaleLowerCase('es').includes(filter.toLocaleLowerCase('es')));
  return <section className="panel word-panel"><div className="section-title"><div><p className="eyebrow">CONTENIDO</p><h2>Banco de palabras</h2></div><label className="button secondary file-button">Importar CSV<input type="file" accept=".csv,text/csv" onChange={e => void importCsv(e.target.files?.[0])} /></label></div>
    <form className="word-form" onSubmit={submit}><label>Palabra<input value={form.word} onChange={e => setForm({ ...form, word: e.target.value })} required /></label><label>Alias separados por |<input value={form.aliases} onChange={e => setForm({ ...form, aliases: e.target.value })} /></label><label>Dificultad<select value={form.difficulty} onChange={e => setForm({ ...form, difficulty: e.target.value as 'easy' | 'hard' })}><option value="easy">Fácil</option><option value="hard">Difícil</option></select></label><label className="check-label"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} /> Habilitada</label><button className="button primary">{editing ? 'Guardar' : 'Agregar'}</button>{editing && <button type="button" className="button ghost" onClick={() => { setEditing(null); setForm(empty); }}>Cancelar</button>}</form>
    <input className="word-search" placeholder="Buscar palabra..." value={filter} onChange={e => setFilter(e.target.value)} />
    <div className="word-table"><div className="word-row word-head"><span>Palabra</span><span>Nivel</span><span>Estado</span><span>Acciones</span></div>{visible.slice(0, 100).map(word => <div className="word-row" key={word.id}><span><strong>{word.word}</strong><small>{word.aliases.join(', ')}</small></span><span>{word.difficulty === 'easy' ? 'Fácil' : 'Difícil'}</span><span>{word.enabled ? 'Activa' : 'Off'}</span><span><button onClick={() => edit(word)}>Editar</button><button className="remove" onClick={() => confirm(`¿Eliminar “${word.word}”?`) && void send('admin:word:delete', { id: word.id })}>Eliminar</button></span></div>)}</div>
  </section>;
}

const labelPhase = (phase: AdminState['phase']) => ({ lobby: 'Lobby', betweenTurns: 'Entre turnos', reveal: 'Revelación', drawing: 'Dibujo', grace: 'Gracia', steal: 'Robo', results: 'Resultados', paused: 'Pausa', finished: 'Finalizada' })[phase];
const labelReason = (reason: AdminState['scoreEntries'][number]['reason']) => ({ normal: 'Acierto', grace: 'Gracia', speed: 'Velocidad', 'full-team': 'Equipo completo', steal: 'Robo' })[reason];
