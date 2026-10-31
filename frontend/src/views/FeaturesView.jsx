import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import Timeline from '../Timeline';

export function FeaturesView({
  features = [],
  selectedFeatureId = '',
  onSelectFeature,
  onBack,
  onNavigate,
  onOpenEvidence,
  onOpenIssue,
  onToast,
}) {
  const [search, setSearch] = useState('');
  const [originFilter, setOriginFilter] = useState('all');
  const [featureEvents, setFeatureEvents] = useState([]);
  const [featureEventTotal, setFeatureEventTotal] = useState(0);
  const [featureEventPage, setFeatureEventPage] = useState(0);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [showAliasModal, setShowAliasModal] = useState(false);
  const [aliasForm, setAliasForm] = useState({ aliasName: '', sourceRef: '' });
  const [savingAlias, setSavingAlias] = useState(false);

  // Selected feature object
  const selectedFeature = features.find((f) => f.feature_id === selectedFeatureId);

  // Fetch events for selected feature
  useEffect(() => {
    if (!selectedFeatureId) return;
    let cancelled = false;
    setLoadingEvents(true);

    api
      .eventsForFeature(selectedFeatureId, featureEventPage * 500, 500)
      .then((res) => {
        if (cancelled) return;
        const items = res.items || [];
        setFeatureEvents(
          items.map((row) => ({
            ...(row.event_payload || {}),
            date: row.event_payload?.date || row.event_date,
            event: row.event_payload?.event || row.summary,
            feature: row.event_payload?.feature || selectedFeature?.canonical_name || row.entity_id,
            event_type: row.event_payload?.event_type || row.event_type,
            aim_objective: row.aim_objective,
            evidence_span: row.evidence_span,
            source_refs: row.source_refs,
            feature_ids: row.feature_ids,
            inferred: row.inferred,
            confidence: row.confidence,
          }))
        );
        setFeatureEventTotal(res.total || 0);
      })
      .catch(() => {
        if (!cancelled) {
          setFeatureEvents([]);
          setFeatureEventTotal(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingEvents(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedFeatureId, featureEventPage, selectedFeature]);

  // Handle adding an alias
  async function handleAddAlias(e) {
    e.preventDefault();
    if (!aliasForm.aliasName.trim()) return;
    setSavingAlias(true);
    try {
      await api.addAlias(selectedFeatureId, {
        aliasName: aliasForm.aliasName.trim(),
        sourceRef: aliasForm.sourceRef.trim(),
      });
      onToast?.(`Alias "${aliasForm.aliasName}" attached to ${selectedFeatureId}`, 'success');
      setShowAliasModal(false);
      setAliasForm({ aliasName: '', sourceRef: '' });
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setSavingAlias(false);
    }
  }

  // Filter features
  const filteredFeatures = features.filter((f) => {
    const matchesSearch = `${f.feature_id} ${f.canonical_name || ''} ${f.description || ''}`
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchesOrigin = originFilter === 'all' || f.origin === originFilter;
    return matchesSearch && matchesOrigin;
  });

  const origins = [...new Set(features.map((f) => f.origin).filter(Boolean))];

  // If in Feature Detail Mode
  if (selectedFeatureId) {
    return (
      <div className="feature-detail-container">
        {/* Back Link & Header */}
        <div className="feature-detail-header-card">
          <div className="feature-detail-top-bar">
            <button type="button" className="btn btn-sm btn-outline" onClick={onBack}>
              <Icon name="chevron-left" size={14} /> Back to Feature Registry
            </button>

            <div className="feature-detail-action-group">
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => onNavigate('assistant', { prefill: `Summarize the evolution and architecture of ${selectedFeature?.canonical_name || selectedFeatureId}.` })}
              >
                <Icon name="brain" size={14} color="var(--accent-violet)" /> Ask Ollama About Feature
              </button>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => onNavigate('graph')}
              >
                <Icon name="graph" size={14} color="var(--accent-cyan)" /> Inspect in Knowledge Graph
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => setShowAliasModal(true)}
              >
                <Icon name="plus" size={14} /> Add Alias
              </button>
            </div>
          </div>

          <div className="feature-title-block">
            <div className="feature-badges-row">
              <span className="badge badge-accent">
                <Icon name="diamond" size={13} /> {selectedFeatureId}
              </span>
              <span className="badge badge-subtle">
                Origin: {selectedFeature?.origin || 'Dataset Component'}
              </span>
              <span className="badge badge-success">
                {selectedFeature?.record_count || 0} Linked Records
              </span>
            </div>

            <h1 className="feature-canonical-title">
              {selectedFeature?.canonical_name || selectedFeatureId}
            </h1>

            {selectedFeature?.description && (
              <p className="feature-description-text">{selectedFeature.description}</p>
            )}
          </div>

          {/* Quick Metrics */}
          <div className="feature-stats-bar">
            <div className="feature-stat-box">
              <span className="stat-label">CANONICAL IDENTIFIER</span>
              <strong>{selectedFeatureId}</strong>
            </div>
            <div className="feature-stat-box">
              <span className="stat-label">RECORD ASSIGNMENTS</span>
              <strong>{(selectedFeature?.record_count || 0).toLocaleString()}</strong>
            </div>
            <div className="feature-stat-box">
              <span className="stat-label">HISTORICAL EVENTS</span>
              <strong>{featureEventTotal.toLocaleString()}</strong>
            </div>
            <div className="feature-stat-box">
              <span className="stat-label">PAGE NUMBER</span>
              <strong>
                {featureEventPage + 1} of {Math.max(1, Math.ceil(featureEventTotal / 500))}
              </strong>
            </div>
          </div>
        </div>

        {/* Feature Event Timeline Section */}
        <section className="panel feature-timeline-panel">
          <div className="panel-header">
            <div>
              <span className="badge badge-accent">
                <Icon name="clock" size={12} /> LIFECYCLE TIMELINE
              </span>
              <h2 className="panel-title">
                Milestones for {selectedFeature?.canonical_name || selectedFeatureId}
              </h2>
            </div>

            {/* Pagination Controls */}
            <div className="pagination-controls">
              <button
                type="button"
                className="btn btn-icon"
                disabled={featureEventPage === 0 || loadingEvents}
                onClick={() => setFeatureEventPage((p) => Math.max(0, p - 1))}
              >
                <Icon name="chevron-left" size={15} />
              </button>
              <span className="page-text">
                Page {featureEventPage + 1} / {Math.max(1, Math.ceil(featureEventTotal / 500))}
              </span>
              <button
                type="button"
                className="btn btn-icon"
                disabled={(featureEventPage + 1) * 500 >= featureEventTotal || loadingEvents}
                onClick={() => setFeatureEventPage((p) => p + 1)}
              >
                <Icon name="chevron-right" size={15} />
              </button>
            </div>
          </div>

          <Timeline
            events={featureEvents}
            loading={loadingEvents}
            onOpenEvidence={onOpenEvidence}
            onOpenIssue={onOpenIssue}
          />
        </section>

        {/* Modal to add an alias */}
        {showAliasModal && (
          <div className="modal-backdrop" onClick={() => setShowAliasModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <span className="badge badge-accent">CANONICAL ALIAS</span>
                  <h3 className="modal-title-text" style={{ marginTop: 6 }}>
                    Add Alias to {selectedFeature?.canonical_name || selectedFeatureId}
                  </h3>
                </div>
                <button
                  type="button"
                  className="icon-button close-button"
                  onClick={() => setShowAliasModal(false)}
                >
                  <Icon name="close" size={18} />
                </button>
              </div>

              <form onSubmit={handleAddAlias} className="record-form">
                <label className="form-label">
                  <span>Alias Name <span className="required-star">*</span></span>
                  <input
                    type="text"
                    required
                    className="form-input"
                    placeholder="e.g. Axis2 Kernel Core, axis2-kernel"
                    value={aliasForm.aliasName}
                    onChange={(e) => setAliasForm({ ...aliasForm, aliasName: e.target.value })}
                  />
                </label>

                <label className="form-label">
                  <span>Source Reference (Optional)</span>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. AXIS2-RENAME-2007"
                    value={aliasForm.sourceRef}
                    onChange={(e) => setAliasForm({ ...aliasForm, sourceRef: e.target.value })}
                  />
                </label>

                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowAliasModal(false)}
                    disabled={savingAlias}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={savingAlias || !aliasForm.aliasName}>
                    {savingAlias ? 'Attaching…' : 'Save Alias'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Feature Registry List Mode
  return (
    <div className="features-registry-container">
      {/* Top Controls Bar */}
      <div className="features-toolbar-card">
        <div className="features-search-box">
          <Icon name="search" size={16} color="var(--accent-cyan)" />
          <input
            type="text"
            className="features-search-input"
            placeholder="Search features by name, ID, or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button type="button" className="icon-button" onClick={() => setSearch('')}>
              <Icon name="close" size={14} />
            </button>
          )}
        </div>

        <div className="features-filters-group">
          <label className="filter-select-label">
            <span>Origin:</span>
            <select
              className="form-select filter-select"
              value={originFilter}
              onChange={(e) => setOriginFilter(e.target.value)}
            >
              <option value="all">All Origins ({features.length})</option>
              {origins.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="features-summary-line">
        <span>Showing {filteredFeatures.length} of {features.length} canonical feature identities</span>
      </div>

      {/* Features Grid */}
      <div className="features-cards-grid">
        {filteredFeatures.length === 0 ? (
          <div className="features-empty-box">
            <Icon name="diamond" size={32} color="var(--text-muted)" />
            <h3>No matching features</h3>
            <p>Try searching with another keyword or resetting the origin filter.</p>
          </div>
        ) : (
          filteredFeatures.map((f) => (
            <div
              key={f.feature_id}
              className="feature-registry-card"
              onClick={() => onSelectFeature(f.feature_id)}
            >
              <div className="feature-card-header">
                <span className="feature-id-badge">{f.feature_id}</span>
                <span className="feature-records-pill">
                  {f.record_count || 0} records
                </span>
              </div>

              <h3 className="feature-card-title">{f.canonical_name || f.feature_id}</h3>

              <p className="feature-card-desc">
                {f.description || `Canonical product capability extracted from Apache Axis2 source records.`}
              </p>

              <div className="feature-card-footer">
                <span className="badge badge-subtle">{f.origin || 'canonical'}</span>
                <span className="feature-card-cta">
                  Explore Evolution <Icon name="chevron-right" size={14} />
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
