import { AdminPage } from './pages/AdminPage';
import { HostPage } from './pages/HostPage';
import { PlayerPage } from './pages/PlayerPage';

function Landing() {
  return <main className="landing scanlines">
    <section className="landing-card panel">
      <p className="eyebrow">EVENT MODE</p>
      <h1>PICTIONARY<br /><span>MASIVO</span></h1>
      <p>Dibuja. Adivina. Conquista el marcador.</p>
      <div className="landing-actions">
        <a className="button primary" href="/player">Entrar como jugador</a>
        <a className="button secondary" href="/admin">Panel administrador</a>
      </div>
    </section>
  </main>;
}

export function App() {
  const route = location.pathname.replace(/\/$/, '') || '/';
  if (route === '/host') return <HostPage />;
  if (route === '/admin') return <AdminPage />;
  if (route === '/player') return <PlayerPage />;
  return <Landing />;
}
