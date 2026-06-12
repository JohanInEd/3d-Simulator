import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useSandboxStore } from './state/useSandboxStore';

// Dev-only scripting/debug surface: drive the sandbox from the console, e.g.
//   __sandbox.getState().actions.grabItem('driver-01')
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__sandbox = useSandboxStore;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
