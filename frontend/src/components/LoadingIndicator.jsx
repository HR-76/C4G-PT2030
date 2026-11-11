import './LoadingIndicator.css'

export default function LoadingIndicator({ children = 'A carregar…', className = '' }) {
  return <div className={`loading-indicator ${className}`} role="status" aria-live="polite">
    <svg className="loading-indicator-icon" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true" focusable="false">
      <circle className="loading-orbit-track" cx="32" cy="32" r="28" />
      <circle className="loading-orbit-track loading-orbit-track-inner" cx="32" cy="32" r="19" />
      <g className="loading-orbit loading-orbit-outer">
        <circle className="loading-orbit-arc" cx="32" cy="32" r="28" strokeDasharray="44 132" />
        <circle className="loading-orbit-dot" cx="60" cy="32" r="3" />
      </g>
      <g className="loading-orbit loading-orbit-inner">
        <circle className="loading-orbit-arc" cx="32" cy="32" r="19" strokeDasharray="24 96" />
        <circle className="loading-orbit-dot" cx="51" cy="32" r="2.5" />
      </g>
      <circle className="loading-orbit-core" cx="32" cy="32" r="8" />
      <circle className="loading-orbit-center" cx="32" cy="32" r="3" />
    </svg>
    <span>{children}</span>
  </div>
}
