import { useEffect, useState } from 'react';
import { createHeartbeatDetector } from 'formdraft';

export default function HeartbeatPage() {
  const [transitions, setTransitions] = useState<string[]>([]);
  const [isOnline, setIsOnline] = useState<boolean>(true);

  useEffect(() => {
    // Create the detector inside the effect (not useMemo) so React 18's
    // StrictMode double-mount creates a fresh one on each pass; otherwise the
    // first cleanup would .destroy() the shared detector and the second
    // subscription would land on a dead instance.
    const detector = createHeartbeatDetector({
      // Route name the e2e test can intercept via page.route().
      url: '/__heartbeat__',
      intervalMs: 1000,
      timeoutMs: 500,
    });
    setIsOnline(detector.isOnline());
    const unsub = detector.subscribe((online) => {
      setIsOnline(online);
      setTransitions((t) => [...t, `${new Date().toISOString()}: ${online ? 'online' : 'offline'}`]);
    });
    return () => {
      unsub();
      detector.destroy();
    };
  }, []);

  return (
    <div className="page">
      <div className="shell">
        <header className="header">
          <h1 className="title">Heartbeat detector</h1>
          <p className="subtitle">
            Background HEAD probe every 1s. Cached sync read; subscribers fire only on transitions.
          </p>
        </header>
        <div className="card">
          <div className="card-body">
            <p data-testid="heartbeat-online" style={{ fontSize: 18 }}>
              Cached <code>isOnline()</code>:{' '}
              <strong data-testid="heartbeat-online-value" style={{ color: isOnline ? '#28a745' : '#dc3545' }}>
                {String(isOnline)}
              </strong>
            </p>
            <p style={{ fontSize: 13, color: '#555' }}>
              Transitions observed: <strong data-testid="transitions-count">{transitions.length}</strong>
            </p>
            {transitions.length > 0 && (
              <ul data-testid="transitions-log" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                {transitions.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
