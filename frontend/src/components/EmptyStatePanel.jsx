import { Link } from 'react-router-dom'

export default function EmptyStatePanel({
  title,
  description,
  actionLabel,
  actionTo,
  onAction,
}) {
  return (
    <div className="empty-state-panel">
      <p className="empty-state-panel-title">{title}</p>
      {description ? <p className="empty-state-panel-text">{description}</p> : null}
      {actionLabel && (actionTo || onAction) ? (
        actionTo ? (
          <Link to={actionTo} className="btn btn-outline btn-sm">
            {actionLabel}
          </Link>
        ) : (
          <button className="btn btn-outline btn-sm" onClick={onAction}>
            {actionLabel}
          </button>
        )
      ) : null}
    </div>
  )
}
