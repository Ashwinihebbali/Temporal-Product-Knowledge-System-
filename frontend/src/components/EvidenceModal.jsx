import React from 'react';
import { Icon } from '../icons';

export function EvidenceModal({ evidence, onClose }) {
  if (!evidence) return null;

  const isHistoryEvent = evidence.kind === 'history_event' || evidence.event_id;
  const quote = evidence.evidence_span || evidence.text || evidence.comment || evidence.summary;
  const title = evidence.summary || evidence.event?.event || evidence.event || evidence.issue_id || evidence.commit_hash || 'Evidence Record';
  const confidence = evidence.confidence != null ? Math.round(evidence.confidence * 100) : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-evidence" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-badge-row">
            <span className="badge badge-accent">
              <Icon name="file-text" size={13} />
              {evidence.kind?.toUpperCase() || 'EVIDENCE SOURCE'}
            </span>
            {confidence != null && (
              <span className={`badge ${confidence >= 70 ? 'badge-success' : 'badge-warning'}`}>
                {confidence}% Confidence
              </span>
            )}
            {evidence.inferred && <span className="badge badge-subtle">Inferred</span>}
          </div>
          <button type="button" className="icon-button close-button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>

        <h3 className="modal-title-text">{title}</h3>

        <div className="evidence-metadata-grid">
          {evidence.date && (
            <div className="meta-item">
              <span className="meta-label">Occurred Date</span>
              <strong className="meta-value">{new Date(evidence.date).toLocaleDateString(undefined, { dateStyle: 'medium' })}</strong>
            </div>
          )}
          {evidence.author && (
            <div className="meta-item">
              <span className="meta-label">Author / Reporter</span>
              <strong className="meta-value">{evidence.author}</strong>
            </div>
          )}
          {(evidence.event_type || evidence.status) && (
            <div className="meta-item">
              <span className="meta-label">Event Type / Status</span>
              <strong className="meta-value">{evidence.event_type || evidence.status}</strong>
            </div>
          )}
          {(evidence.entity_id || evidence.feature_ids) && (
            <div className="meta-item">
              <span className="meta-label">Linked Feature(s)</span>
              <strong className="meta-value">
                {Array.isArray(evidence.feature_ids) ? evidence.feature_ids.join(', ') : evidence.feature_ids || evidence.entity_id}
              </strong>
            </div>
          )}
        </div>

        {quote && (
          <div className="evidence-quote-box">
            <span className="quote-label">
              <Icon name="sparkles" size={13} /> Grounded Evidence Span
            </span>
            <blockquote className="evidence-blockquote">
              "{quote}"
            </blockquote>
          </div>
        )}

        {evidence.aim_objective && (
          <div className="evidence-objective-box">
            <span className="quote-label">Aim / Product Objective</span>
            <p>{evidence.aim_objective}</p>
          </div>
        )}

        {evidence.source_refs && evidence.source_refs.length > 0 && (
          <div className="evidence-sources-list">
            <span className="quote-label">Source References ({evidence.source_refs.length})</span>
            <div className="source-ref-chips">
              {evidence.source_refs.map((ref, idx) => (
                <span key={idx} className="source-pill">
                  {ref.type || 'source'}: {ref.id || ref.issue_id || 'ref'}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
