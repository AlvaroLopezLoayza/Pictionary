import { useEffect, useState } from 'react';

function AnimatedNumber({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (shown === value) return;
    const difference = value - shown;
    const step = Math.sign(difference) * Math.max(1, Math.ceil(Math.abs(difference) / 24));
    const id = setInterval(() => setShown(current => Math.abs(value - current) <= Math.abs(step) ? value : current + step), 22);
    return () => clearInterval(id);
  }, [shown, value]);
  return <>{shown.toLocaleString('es-PE')}</>;
}

export function Scoreboard({ a, b, center }: { a: number; b: number; center?: React.ReactNode }) {
  return <header className="scoreboard">
    <div className="team-score team-A"><span>EQUIPO A</span><strong><AnimatedNumber value={a} /></strong></div>
    <div className="score-center">{center ?? <span>VS</span>}</div>
    <div className="team-score team-B"><span>EQUIPO B</span><strong><AnimatedNumber value={b} /></strong></div>
  </header>;
}
