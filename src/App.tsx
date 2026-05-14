import { useState, useEffect } from 'react';
import { checkAuth } from './store';
import Login from './components/Login';
import Dashboard from './components/Dashboard';

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    setAuthenticated(checkAuth());
  }, []);

  if (!authenticated) {
    return <Login onLogin={() => setAuthenticated(true)} />;
  }

  return <Dashboard onLogout={() => setAuthenticated(false)} />;
}
