export function BulletinSourceBadge({ source }: { source?: string }) {
  if (!source) return null;
  return <span className="source-badge">{source}</span>;
}
