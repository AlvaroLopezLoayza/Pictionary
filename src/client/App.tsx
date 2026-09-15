import { AdminPage } from './pages/AdminPage';
import { HostPage } from './pages/HostPage';
import { PlayerPage } from './pages/PlayerPage';

const crew = ['violet', 'lime', 'pink', 'gold', 'cyan', 'orange', 'pink', 'lime', 'blue', 'cyan', 'violet', 'orange'];

function PixelCrew() {
  return <div className="pixel-crew" aria-hidden="true">
    {crew.map((color, index) => <svg key={`${color}-${index}`} className={`landing-sprite sprite-${color} sprite-${index % 4}`} viewBox="0 0 16 16">
      <path d="M5 1h2v2h2V1h2v3h2v2h2v6h-2v2h-3v-3H6v3H3v-2H1V6h2V4h2V1Zm0 5v2h2V6H5Zm4 0v2h2V6H9Z" />
    </svg>)}
  </div>;
}

function Landing() {
  return <main className="landing scanlines">
    <section className="landing-card panel">
      <div className="landing-console">
        <div className="console-lights" aria-hidden="true"><i /><i /><i /><i /></div>
        <p className="eyebrow">ARCADE PARTY SYSTEM</p>
        <h1>PICTIONARY<br /><span>MASIVO</span></h1>
        <p className="landing-copy">Dibuja. Adivina.<br />Conquista el marcador.</p>
        <div className="landing-actions">
          <a className="button primary play-button" href="/player"><i aria-hidden="true" />Entrar a jugar</a>
          <a className="button secondary admin-button" href="/admin"><i aria-hidden="true" />Panel admin</a>
        </div>
        <div className="landing-meta"><span>2—100 PLAYERS</span><span>● ONLINE</span></div>
      </div>
      <div className="landing-crew">
        <div className="crew-heading"><span>SELECT</span><strong>YOUR PIXEL</strong></div>
        <PixelCrew />
        <div className="pixel-hearts" aria-hidden="true"><span>♥</span><span>♥</span><span>♥</span></div>
        <p>READY?</p>
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
