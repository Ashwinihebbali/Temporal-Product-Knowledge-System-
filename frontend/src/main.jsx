import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class DashboardErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('ChronoDev render failure:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main
          style={{
            margin: '60px auto',
            maxWidth: 720,
            padding: 32,
            color: '#f8fafc',
            background: '#0f172a',
            border: '1px solid #ef4444',
            borderRadius: 16,
            fontFamily: "'JetBrains Mono', monospace",
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          }}
        >
          <h2 style={{ color: '#f87171', margin: '0 0 12px' }}>ChronoDev View Error Caught</h2>
          <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.6 }}>
            The UI intercepted an unexpected error:
          </p>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              background: '#070b14',
              padding: 16,
              borderRadius: 8,
              border: '1px solid #334155',
              color: '#fca5a5',
              fontSize: 12,
              maxHeight: 280,
              overflow: 'auto',
            }}
          >
            {String(this.state.error?.stack || this.state.error)}
          </pre>
          <button
            style={{
              marginTop: 16,
              padding: '10px 18px',
              borderRadius: 8,
              background: '#00e5ff',
              color: '#070b14',
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
            }}
            onClick={() => window.location.reload()}
          >
            Reload ChronoDev
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <DashboardErrorBoundary>
      <App />
    </DashboardErrorBoundary>
  </React.StrictMode>
);
