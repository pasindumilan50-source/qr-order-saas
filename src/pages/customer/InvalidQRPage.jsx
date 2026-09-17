export default function InvalidQRPage({ reason }) {
  return (
    <div className="full-page-message">
      <div className="empty-state-icon">📷</div>
      <h1>Can't load this menu</h1>
      <p>{reason || 'This QR code is invalid or expired.'}</p>
    </div>
  );
}
