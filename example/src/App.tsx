import { useEffect, useState, lazy, Suspense } from 'react';
import './App.css';
import WizardPage from './pages/WizardPage';

const ConflictPage = lazy(() => import('./pages/ConflictPage'));
const AutoStoragePage = lazy(() => import('./pages/AutoStoragePage'));
const ExternalControlPage = lazy(() => import('./pages/ExternalControlPage'));
const HeartbeatPage = lazy(() => import('./pages/HeartbeatPage'));
const RhfPage = lazy(() => import('./pages/RhfPage'));
const FormikPage = lazy(() => import('./pages/FormikPage'));
const TanstackPage = lazy(() => import('./pages/TanstackPage'));
const SessionStoragePage = lazy(() => import('./pages/SessionStoragePage'));
const IndexedDBPage = lazy(() => import('./pages/IndexedDBPage'));

type Route =
  | 'wizard'
  | 'conflict'
  | 'auto-storage'
  | 'external-control'
  | 'heartbeat'
  | 'rhf'
  | 'formik'
  | 'tanstack'
  | 'session-storage'
  | 'indexeddb'
  | 'index';

function parseRoute(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  if (!h || h === 'wizard') return 'wizard';
  if (h === 'index') return 'index';
  if (
    h === 'conflict' ||
    h === 'auto-storage' ||
    h === 'external-control' ||
    h === 'heartbeat' ||
    h === 'rhf' ||
    h === 'formik' ||
    h === 'tanstack' ||
    h === 'session-storage' ||
    h === 'indexeddb'
  ) return h;
  return 'wizard';
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parseRoute);
  useEffect(() => {
    const handler = () => setRoute(parseRoute());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  return route;
}

const DEMOS: Array<{ hash: Route; title: string; desc: string }> = [
  { hash: 'wizard', title: 'Signup wizard (default)', desc: '5-step localStorage wizard with excludeFields + offline sync.' },
  { hash: 'conflict', title: 'Conflict UI', desc: 'multiTab=warn + <ConflictDialog>/<ConflictResolver> field-level merge.' },
  { hash: 'auto-storage', title: 'autoAdapter', desc: 'localStorage → IndexedDB fallback on quota or large payloads.' },
  { hash: 'external-control', title: 'getFormDraft + useFormDraftStatus', desc: 'Drive a draft programmatically from outside the React tree.' },
  { hash: 'heartbeat', title: 'Heartbeat detector', desc: 'Background HEAD probe for captive portals; cheap cached read.' },
  { hash: 'rhf', title: 'React Hook Form adapter', desc: 'register + watch wiring against useFormDraft.' },
  { hash: 'formik', title: 'Formik adapter', desc: 'getFieldProps + setValues wiring.' },
  { hash: 'tanstack', title: 'TanStack Form adapter', desc: 'FormApi wiring.' },
  { hash: 'session-storage', title: 'sessionStorageAdapter', desc: 'Per-tab persistence; survives reload, not close.' },
  { hash: 'indexeddb', title: 'indexedDBAdapter', desc: 'Async storage with quota headroom.' },
];

function Index() {
  return (
    <div className="page">
      <div className="shell">
        <header className="header">
          <h1 className="title">formdraft demos</h1>
          <p className="subtitle">Each page exercises one feature. Open in a browser and follow the steps.</p>
        </header>
        <div className="card">
          <div className="card-body">
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {DEMOS.map((d) => (
                <li key={d.hash}>
                  <a className="link" href={`#/${d.hash}`} data-testid={`nav-${d.hash}`} style={{ fontWeight: 600, fontSize: 15 }}>
                    {d.title}
                  </a>
                  <p style={{ margin: '4px 0 0', fontSize: 13, color: '#555' }}>{d.desc}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const route = useHashRoute();
  if (route === 'index') return <Index />;
  if (route === 'wizard') return <WizardPage />;
  return (
    <Suspense fallback={<div className="page"><div className="shell">Loading…</div></div>}>
      {route === 'conflict' && <ConflictPage />}
      {route === 'auto-storage' && <AutoStoragePage />}
      {route === 'external-control' && <ExternalControlPage />}
      {route === 'heartbeat' && <HeartbeatPage />}
      {route === 'rhf' && <RhfPage />}
      {route === 'formik' && <FormikPage />}
      {route === 'tanstack' && <TanstackPage />}
      {route === 'session-storage' && <SessionStoragePage />}
      {route === 'indexeddb' && <IndexedDBPage />}
    </Suspense>
  );
}
