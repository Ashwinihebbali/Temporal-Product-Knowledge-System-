import React, { useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';

export function AddRecordModal({ isOpen, onClose, onAdded, onToast }) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    source_type: 'issue',
    source_id: '',
    summary: '',
    description: '',
    occurred_at: '',
    feature: '',
  });

  if (!isOpen) return null;

  const handleChange = (key) => (e) => {
    setForm((curr) => ({ ...curr, [key]: e.target.value }));
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        source_type: form.source_type,
        source_id: form.source_id.trim(),
        summary: form.summary.trim(),
        description: form.description.trim(),
        feature: form.feature.trim() || null,
        occurred_at: form.occurred_at ? new Date(form.occurred_at).toISOString() : null,
      };

      const result = await api.addRecord(payload);
      if (result.duplicate) {
        onToast?.(`Record ${result.source_id} already exists in knowledge store.`, 'info');
      } else {
        onToast?.(`Successfully ingested ${result.source_id} under ${result.feature_id || 'new feature'}!`, 'success');
        onAdded?.();
      }
      onClose();
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-record" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="badge badge-accent">
              <Icon name="database" size={13} /> SOURCE INGESTION PIPELINE
            </span>
            <h2 className="modal-title-text" style={{ marginTop: 6 }}>Ingest Historical Record</h2>
          </div>
          <button type="button" className="icon-button close-button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>

        <p className="modal-description">
          Add an Apache Axis2 source record. ChronoDev AI extracts dated lifecycle events, grounds them in evidence quotes, and maps them to a canonical feature ID.
        </p>

        <form onSubmit={handleSubmit} className="record-form">
          <div className="form-row-2">
            <label className="form-label">
              <span>Record Type</span>
              <select className="form-select" value={form.source_type} onChange={handleChange('source_type')}>
                <option value="issue">Jira Issue</option>
                <option value="commit">Git Commit</option>
                <option value="meeting">Architecture / Team Meeting</option>
                <option value="ticket">Customer Ticket</option>
                <option value="pull_request">Pull Request / Patch</option>
              </select>
            </label>

            <label className="form-label">
              <span>Source ID <span className="required-star">*</span></span>
              <input
                type="text"
                required
                className="form-input"
                placeholder="e.g. AXIS2-CUSTOM-001"
                value={form.source_id}
                onChange={handleChange('source_id')}
              />
            </label>
          </div>

          <label className="form-label">
            <span>Summary <span className="required-star">*</span></span>
            <input
              type="text"
              required
              minLength={3}
              className="form-input"
              placeholder="e.g. Added WS-Security signature verification handler"
              value={form.summary}
              onChange={handleChange('summary')}
            />
          </label>

          <div className="form-row-2">
            <label className="form-label">
              <span>Date & Time (Optional)</span>
              <input
                type="datetime-local"
                className="form-input"
                value={form.occurred_at}
                onChange={handleChange('occurred_at')}
              />
            </label>

            <label className="form-label">
              <span>Feature Name Override (Optional)</span>
              <input
                type="text"
                className="form-input"
                placeholder="Leave blank for automatic Ollama extraction"
                value={form.feature}
                onChange={handleChange('feature')}
              />
            </label>
          </div>

          <label className="form-label">
            <span>Source Text & Evidence Body</span>
            <textarea
              className="form-textarea"
              rows={4}
              placeholder="Paste the source text, commit message, or meeting transcript to automatically extract dated milestones and exact quote citations…"
              value={form.description}
              onChange={handleChange('description')}
            />
          </label>

          <div className="modal-footer" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !form.source_id || !form.summary}>
              {busy ? (
                <>
                  <div className="loading-spinner-sm" /> Ingesting & Extracting…
                </>
              ) : (
                <>
                  <Icon name="zap" size={15} /> Save to Knowledge Store
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
