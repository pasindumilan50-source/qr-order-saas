export function Loading({ label = 'Loading…', fullPage = false }) {
  if (fullPage) {
    return (
      <div className="full-page-message">
        <div className="spinner" />
        <p>{label}</p>
      </div>
    );
  }
  return (
    <div className="inline-loading">
      <div className="spinner spinner-sm" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ icon = '📭', title, description, action }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', description, onRetry }) {
  return (
    <div className="empty-state empty-state-error">
      <div className="empty-state-icon">⚠️</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {onRetry && (
        <button className="btn btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <h3>{title}</h3>
        {message && <p>{message}</p>}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SkeletonRow() {
  return <div className="skeleton-row" />;
}

export function Badge({ status }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}
