import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';

const HISTORICAL_EPOCHS = [
  { label: 'Axis2 Inception (2005)', date: '2005-06-01', desc: 'Initial rewrite of Axis 1.x into high performance Axis2 engine' },
  { label: 'Axis2 1.2 Release (2007)', date: '2007-04-27', desc: 'Enterprise WS-Policy, WS-Security and Rampart integration' },
  { label: 'Axis2 1.5 Release (2009)', date: '2009-05-01', desc: 'JSON badging, clustering, and asynchronous HTTP client' },
  { label: 'Axis2 1.6 Release (2011)', date: '2011-06-15', desc: 'JAX-WS 2.2 and WSDL 2.0 full conformance milestone' },
  { label: 'Maintenance Era (2018)', date: '2018-01-01', desc: 'Modern JDK compatibility and security reviews' },
];

export function TimeMachineView({ features = [], onOpenEvidence, onOpenIssue }) {
  const [targetDate, setTargetDate] = useState('2007-05-01');
  const [selectedEntity, setSelectedEntity] = useState('');
  const [loading, setLoading] = useState(false);
  const [snapshotData, setSnapshotData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchSnapshot(targetDate, selectedEntity);
  }, [targetDate, selectedEntity]);

  async function fetchSnapshot(dateVal, entityVal) {
    if (!dateVal) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.asOf(dateVal, entityVal, 100);
      setSnapshotData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const items = snapshotData?.items || [];
  const implementedCount = snapshotData?.implemented_count || 0;

  return (
    <div className="timemachine-container">
      {/* Header Banner */}
      <section className="timemachine-hero">
        <div className="timemachine-hero-info">
          <div className="badge-row">
            <span className="badge badge-accent">
              <Icon name="timemachine" size={13} /> TEMPORAL AS-OF RECONSTRUCTION
            </span>
            <span className="badge badge-success">Time-Travel Engine</span>
          </div>

          <h1 className="timemachine-title">Historical Time Machine</h1>
          <p className="timemachine-desc">
            Reconstruct Apache Axis2's exact capability state at any historical point in time. Inspect which features, components, and architectural milestones were active and implemented up to your selected date.
          </p>
        </div>

        {/* Date Selection Box */}
        <div className="timemachine-picker-card">
          <label className="picker-label">
            <Icon name="clock" size={15} color="var(--accent-cyan)" /> SELECT TARGET DATE:
          </label>
          <input
            type="date"
            className="timemachine-date-input"
            value={targetDate}
            min="2004-01-01"
            max="2026-12-31"
            onChange={(e) => setTargetDate(e.target.value)}
          />

          <label className="picker-label" style={{ marginTop: 10 }}>
            OPTIONAL FEATURE SCOPE:
          </label>
          <select
            className="form-select"
            value={selectedEntity}
            onChange={(e) => setSelectedEntity(e.target.value)}
          >
            <option value="">All Features (Project-Wide)</option>
            {features.map((f) => (
              <option key={f.feature_id} value={f.feature_id}>
                {f.canonical_name || f.feature_id}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Preset Epochs Bar */}
      <div className="timemachine-epochs-bar">
        <span className="epochs-label">Historical Epochs:</span>
        <div className="epochs-list">
          {HISTORICAL_EPOCHS.map((epoch) => (
            <button
              key={epoch.date}
              type="button"
              className={`epoch-chip ${targetDate === epoch.date ? 'active-epoch' : ''}`}
              onClick={() => setTargetDate(epoch.date)}
            >
              <strong>{epoch.label}</strong>
              <small>{epoch.desc}</small>
            </button>
          ))}
        </div>
      </div>

      {/* State Snapshot Results */}
      <section className="timemachine-results-panel">
        <div className="panel-header">
          <div>
            <span className="badge badge-accent">
              STATE AS OF {targetDate}
            </span>
            <h2 className="panel-title">
              {implementedCount} Implemented Milestones Recorded
            </h2>
          </div>
          <span className="panel-note">
            Only explicitly extracted and recorded events prior to {targetDate} are included.
          </span>
        </div>

        {loading ? (
          <div className="timemachine-loading">
            <div className="loading-spinner" />
            <span>Traveling through time and reconstructing state as of {targetDate}…</span>
          </div>
        ) : error ? (
          <div className="modal-error-box">
            <Icon name="alert" size={20} color="#f87171" />
            <div>
              <strong>Error Loading Historical Snapshot</strong>
              <p>{error}</p>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="timemachine-empty-state">
            <Icon name="timemachine" size={32} color="var(--text-muted)" />
            <h3>No recorded implemented milestones prior to {targetDate}</h3>
            <p>Try advancing the date forward to 2006 or 2007 to view implemented features.</p>
          </div>
        ) : (
          <div className="timemachine-items-grid">
            {items.map((item, idx) => (
              <div key={idx} className="snapshot-item-card">
                <div className="snapshot-card-top">
                  <span className="badge badge-success">IMPLEMENTED</span>
                  <time className="snapshot-date">
                    {item.date ? new Date(item.date).toLocaleDateString() : 'Recorded'}
                  </time>
                </div>

                <h4 className="snapshot-title">{item.event || item.summary || 'Implemented capability'}</h4>

                {item.feature && (
                  <div className="snapshot-feature-tag">
                    <Icon name="diamond" size={12} /> {item.feature}
                  </div>
                )}

                {item.aim_objective && (
                  <p className="snapshot-objective">
                    <b>Objective:</b> {item.aim_objective}
                  </p>
                )}

                {item.evidence_span && (
                  <blockquote className="snapshot-evidence">
                    "{item.evidence_span}"
                  </blockquote>
                )}

                <div className="snapshot-footer">
                  {item.author && <span>By {item.author}</span>}
                  {item.issue_ids && item.issue_ids.length > 0 && (
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => onOpenIssue?.(Array.isArray(item.issue_ids) ? item.issue_ids[0] : item.issue_ids)}
                    >
                      View Issue {Array.isArray(item.issue_ids) ? item.issue_ids[0] : item.issue_ids} →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
