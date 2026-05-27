import { useState } from 'react';
import { SignupWizard } from './scenarios/SignupWizard';
import { ProfileSettings } from './scenarios/ProfileSettings';
import { CommentEditor } from './scenarios/CommentEditor';

type Scenario = 'signup' | 'profile' | 'comment';

export function App() {
  const [scenario, setScenario] = useState<Scenario>('signup');
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 20, maxWidth: 720, margin: '0 auto' }}>
      <h1>formdraft examples</h1>
      <nav style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <button onClick={() => setScenario('signup')} disabled={scenario === 'signup'}>Signup Wizard</button>
        <button onClick={() => setScenario('profile')} disabled={scenario === 'profile'}>Profile Settings</button>
        <button onClick={() => setScenario('comment')} disabled={scenario === 'comment'}>Comment Editor</button>
      </nav>
      {scenario === 'signup' && <SignupWizard />}
      {scenario === 'profile' && <ProfileSettings />}
      {scenario === 'comment' && <CommentEditor />}
    </div>
  );
}
