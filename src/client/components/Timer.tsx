import { useEffect, useState } from 'react';

export function Timer({ endsAt, serverNow, urgent = false }: { endsAt: number | null; serverNow: number; urgent?: boolean }) {
  const offset = serverNow - Date.now();
  const [remaining, setRemaining] = useState(() => endsAt ? Math.max(0, endsAt - (Date.now() + offset)) : 0);
  useEffect(() => {
    const update = () => setRemaining(endsAt ? Math.max(0, endsAt - (Date.now() + offset)) : 0);
    update(); const id = setInterval(update, 50); return () => clearInterval(id);
  }, [endsAt, offset]);
  const seconds = Math.ceil(remaining / 1_000);
  return <span className={`timer ${urgent || seconds <= 5 ? 'urgent' : ''}`}>{String(seconds).padStart(2, '0')}</span>;
}
