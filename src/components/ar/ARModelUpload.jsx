import { useState } from 'react';
import { AR_FORMATS, AR_RECOMMENDED_MB, validateModelFile } from '../../services/arModelService';

// Controlled by the parent form: `changes` = { glb: {file, remove}, usdz: {file, remove} }.
// Nothing is uploaded here; the parent uploads on Save (the menu item id must exist first).
export default function ARModelUpload({ current, changes, onChange, disabled }) {
  return (
    <fieldset className="ar-upload">
      <legend>3D / AR model (optional)</legend>
      <p className="form-hint">
        Customers get a &quot;View in 3D / AR&quot; button when a model is added. Keep files light: under{' '}
        {AR_RECOMMENDED_MB} MB each (max 15 MB), modest polygon count, textures no larger than 2K.
        GLB works everywhere; USDZ enables AR on iPhone/iPad.
      </p>
      <Row format="glb" currentUrl={current.glb} change={changes.glb} onChange={onChange} disabled={disabled} />
      <Row format="usdz" currentUrl={current.usdz} change={changes.usdz} onChange={onChange} disabled={disabled} />
    </fieldset>
  );
}

function Row({ format, currentUrl, change, onChange, disabled }) {
  const spec = AR_FORMATS[format];
  const [error, setError] = useState('');
  const removed = !!change.remove;
  const hasExisting = !!currentUrl && !removed;

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await validateModelFile(format, file);
      setError('');
      onChange(format, { file, remove: false });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="ar-upload-row">
      <div className="ar-upload-label">
        <strong>{spec.label} model</strong>
        <span className="form-hint">{format === 'glb' ? 'Android, web, 3D viewer' : 'iPhone / iPad AR'}</span>
      </div>

      <div className="ar-upload-status">
        {change.file ? (
          <span>
            New: {change.file.name} ({(change.file.size / 1024 / 1024).toFixed(1)} MB) — uploads when you press Save
          </span>
        ) : hasExisting ? (
          <span>✓ Model uploaded</span>
        ) : removed ? (
          <span>Will be removed when you press Save</span>
        ) : (
          <span>No model</span>
        )}
      </div>

      <div className="ar-upload-actions">
        <label className={`btn btn-secondary btn-small ${disabled ? 'is-disabled' : ''}`}>
          {hasExisting || change.file ? 'Replace' : 'Choose file'}
          <input type="file" accept={`.${spec.ext}`} onChange={pick} disabled={disabled} hidden />
        </label>
        {(hasExisting || change.file || removed) && (
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={disabled}
            onClick={() => {
              setError('');
              if (change.file) onChange(format, { file: null, remove: false }); // undo pending pick
              else if (removed) onChange(format, { file: null, remove: false }); // undo removal
              else onChange(format, { file: null, remove: true });
            }}
          >
            {change.file || removed ? 'Undo' : 'Remove'}
          </button>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
