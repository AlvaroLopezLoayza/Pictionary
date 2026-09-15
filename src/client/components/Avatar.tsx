import type { PublicPlayer } from '../../shared/types';

export function Avatar({ player, compact = false }: { player: PublicPlayer; compact?: boolean }) {
  return (
    <div className={`avatar-card team-${player.teamId ?? 'none'} ${player.knows ? 'knows' : ''} ${player.connected ? '' : 'offline'} ${compact ? 'compact' : ''}`}>
      {player.knows && <span className="knows-badge" aria-label="Sabe la respuesta">LO SABE</span>}
      {player.drawer && <span className="pencil-badge" aria-label="Dibujante">✎</span>}
      <svg className={`pixel-avatar avatar-tone-${player.avatarId}`} viewBox="0 0 48 48" role="img" aria-label={`Avatar de ${player.name}`}>
        <path className="avatar-shadow" d="M9 42h30v4H9z" />
        <path className="avatar-body" d="M10 28h28v14H10zM14 20h20v8H14z" />
        <path className="avatar-head" d="M12 8h24v16H12zM16 4h16v4H16z" />
        <path className="avatar-eye" d="M17 13h4v5h-4zM27 13h4v5h-4z" />
        <path className="avatar-mouth" d="M20 20h8v2h-8z" />
        <path className="avatar-accent" d="M6 30h4v10H6zM38 30h4v10h-4zM16 42h6v4h-6zM26 42h6v4h-6z" />
      </svg>
      <span className="avatar-name">{player.name}</span>
      {!player.connected && <span className="status-label">OFF</span>}
    </div>
  );
}
