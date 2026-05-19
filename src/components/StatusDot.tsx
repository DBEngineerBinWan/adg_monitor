import { HealthStatus } from '../types';

interface StatusDotProps {
  status: HealthStatus;
  size?: 'sm' | 'md';
}

export default function StatusDot({ status, size = 'md' }: StatusDotProps) {
  const scale = size === 'sm' ? 0.7 : 1;
  return (
    <span
      className={`status-dot status-dot-${status}`}
      style={{ transform: `scale(${scale})` }}
    >
      <span className="status-dot-ring">
        <span className="status-dot-core" />
      </span>
    </span>
  );
}
