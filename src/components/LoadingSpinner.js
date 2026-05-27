import React from 'react';

const SPIN_STYLE = `@keyframes ls-spin { to { transform: rotate(360deg); } }`;

export default function LoadingSpinner({ size = 32, label = null, fullPage = false }) {
  const borderWidth = Math.max(2, Math.round(size / 10));

  const containerStyle = fullPage
    ? {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        width: '100%',
        gap: 14,
        background: 'var(--bg, #ffffff)',
      }
    : {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        minHeight: 200,
        padding: '48px 24px',
        boxSizing: 'border-box',
        gap: 12,
      };

  const ringStyle = {
    width: size,
    height: size,
    borderWidth,
    borderStyle: 'solid',
    borderColor: 'var(--border, #e5e7eb)',
    borderTopColor: 'var(--ink, #0a0a0a)',
    borderRadius: '50%',
    animation: 'ls-spin 0.8s linear infinite',
    flexShrink: 0,
  };

  return (
    <div style={containerStyle}>
      <style>{SPIN_STYLE}</style>
      <div style={ringStyle} role="status" aria-label={label || 'Loading'} />
      {label && (
        <div style={{ fontSize: 13, color: 'var(--ink3, #6b7280)', textAlign: 'center' }}>
          {label}
        </div>
      )}
    </div>
  );
}
