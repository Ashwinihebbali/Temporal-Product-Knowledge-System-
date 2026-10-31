import React from 'react';
import { Icon } from '../icons';

export function FlagsView({ flags = [], onNavigateFeature }) {
  return (
    <div className="flags-view-container">
      {/* Header */}
      <div className="flags-header-card">
        <div className="badge-row">
          <span className="badge badge-accent">
            <Icon name="flags" size={13} /> DATA INTEGRITY AUDITOR
          </span>
          <span className={`badge ${flags.length === 0 ? 'badge-success' : 'badge-warning'}`}>
            {flags.length === 0 ? 'ALL AUDITS PASSED' : `${flags.length} REVIEW FLAGS`}
          </span>
        </div>

        <h1 className="flags-main-title">Quality & Review Flags</h1>
        <p className="flags-desc">
          Automated integrity checks flag chronological anomalies, unverified lifecycle transitions, orphan features, and confidence gaps across the Apache Axis2 dataset.
        </p>
      </div>

      {/* Flags List */}
      <div className="flags-panel-body">
        {flags.length === 0 ? (
          <div className="flags-clean-state">
            <div className="clean-icon-wrapper">
              <Icon name="check" size={32} color="var(--accent-emerald)" />
            </div>
            <h3>Zero Open Conflict Flags</h3>
            <p>
              All extracted historical events, canonical feature IDs, and source citations satisfy integrity constraints.
            </p>
            <div className="audit-checklist">
              <div className="check-item">
                <Icon name="check" size={14} color="var(--accent-emerald)" />
                <span>Source-to-feature assignments verified in Neo4j</span>
              </div>
              <div className="check-item">
                <Icon name="check" size={14} color="var(--accent-emerald)" />
                <span>PostgreSQL temporal ordering consistent with Git and Jira timestamps</span>
              </div>
              <div className="check-item">
                <Icon name="check" size={14} color="var(--accent-emerald)" />
                <span>Ollama groundings backed by verbatim quotes</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flags-list-grid">
            {flags.map((flag) => (
              <div key={flag.flag_id} className="flag-item-card">
                <div className="flag-card-top">
                  <div className="flag-type-badge">
                    <Icon name="alert" size={14} color="#f59e0b" />
                    <strong>{String(flag.flag_type || 'flag').replace(/_/g, ' ')}</strong>
                  </div>
                  <span className={`badge ${flag.severity === 'high' ? 'badge-danger' : 'badge-warning'}`}>
                    {flag.severity || 'review'}
                  </span>
                </div>

                <p className="flag-message">{flag.message}</p>

                <div className="flag-footer">
                  <span className="flag-entity-tag">
                    Entity: <b>{flag.entity_id || 'Project-Wide'}</b>
                  </span>
                  {flag.entity_id && (
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => onNavigateFeature?.(flag.entity_id)}
                    >
                      Inspect Feature →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
