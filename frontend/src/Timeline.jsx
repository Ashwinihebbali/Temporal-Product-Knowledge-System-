import React, { useMemo, useState } from 'react';
import { Icon } from './icons';

const DAY_MS = 24 * 60 * 60 * 1000;

function formatShortDate(val) {
  if (!val) return 'Undated';
  try {
    return new Date(val).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return String(val).slice(0, 10);
  }
}

function getStage(event) {
  const kind = String(event.event_type || '').toLowerCase();
  if (/implement|merged|release|resolved|shipped|closed/.test(kind)) return 'implemented';
  if (/progress|modify|update|change|fix|code_change/.test(kind)) return 'change';
  if (/propos|approv|decid|plan|discussion/.test(kind)) return 'decision';
  return 'event';
}

function computeTimeTicks(start, end, span) {
  const ticks = [];
  if (span <= 0) return ticks;

  if (span > 365 * DAY_MS) {
    // Multi-year span: step by 6-12 months
    const cursor = new Date(start.getFullYear(), 0, 1);
    const monthsStep = span > 5 * 365 * DAY_MS ? 24 : 12;
    while (cursor <= end && ticks.length < 16) {
      ticks.push({
        time: cursor.getTime(),
        label: cursor.toLocaleDateString(undefined, { year: 'numeric' }),
      });
      cursor.setMonth(cursor.getMonth() + monthsStep);
    }
  } else if (span > 60 * DAY_MS) {
    // Multi-month span
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end && ticks.length < 14) {
      ticks.push({
        time: cursor.getTime(),
        label: cursor.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else {
    // Weeks
    const cursor = new Date(start);
    cursor.setDate(cursor.getDate() - cursor.getDay());
    while (cursor <= end && ticks.length < 14) {
      ticks.push({
        time: cursor.getTime(),
        label: cursor.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      });
      cursor.setDate(cursor.getDate() + 7);
    }
  }
  return ticks;
}

export default function Timeline({
  events = [],
  onSelect,
  loading = false,
  selected = null,
  onOpenEvidence,
  onOpenIssue,
  onExploreGraph,
}) {
  const [internalSelection, setInternalSelection] = useState(null);
  const [viewMode, setViewMode] = useState('lanes'); // 'lanes' | 'feed'
  const activeSelection = selected || internalSelection;

  const validEvents = useMemo(() => {
    return (events || []).filter((e) => e.date && !isNaN(new Date(e.date).getTime()));
  }, [events]);

  const timeRange = useMemo(() => {
    if (!validEvents.length) return null;
    let min = Math.min(...validEvents.map((e) => new Date(e.date).getTime()));
    let max = Math.max(...validEvents.map((e) => new Date(e.date).getTime()));
    if (min === max) {
      min -= 7 * DAY_MS;
      max += 7 * DAY_MS;
    }
    const pad = Math.max(3 * DAY_MS, (max - min) * 0.03);
    min -= pad;
    max += pad;
    const start = new Date(min);
    const end = new Date(max);
    const span = max - min;
    return { min, max, start, end, span, ticks: computeTimeTicks(start, end, span) };
  }, [validEvents]);

  // Group events by feature
  const groupedFeatures = useMemo(() => {
    const map = new Map();
    validEvents.forEach((ev, idx) => {
      const featureName = ev.feature || 'General Product Events';
      if (!map.has(featureName)) map.set(featureName, []);
      map.get(featureName).push({
        ...ev,
        _key: ev.event_id || `${ev.date}-${idx}`,
        _time: new Date(ev.date).getTime(),
      });
    });

    return [...map.entries()]
      .map(([name, items]) => [name, items.sort((a, b) => a._time - b._time)])
      .sort((a, b) => b[1].length - a[1].length);
  }, [validEvents]);

  const latestEvent = validEvents.length
    ? validEvents.reduce((prev, curr) => (new Date(curr.date) > new Date(prev.date) ? curr : prev), validEvents[0])
    : null;

  const current = activeSelection
    ? validEvents.find((e) => e.event_id && e.event_id === activeSelection.event_id) || activeSelection
    : latestEvent;

  function calcPosition(time) {
    if (!timeRange || timeRange.span <= 0) return 0;
    return Math.max(0, Math.min(100, ((time - timeRange.min) / timeRange.span) * 100));
  }

  function handleSelect(event) {
    setInternalSelection(event);
    onSelect?.(event);
  }

  if (loading) {
    return (
      <div className="timeline-loading-container">
        <div className="loading-spinner" />
        <span className="loading-text">Reconstructing dated milestone timeline…</span>
      </div>
    );
  }

  if (!validEvents.length) {
    return (
      <div className="timeline-empty-card">
        <Icon name="clock" size={32} color="var(--text-muted)" />
        <h3>No dated historical events</h3>
        <p>Try adjusting your search criteria, feature filter, or date range.</p>
      </div>
    );
  }

  return (
    <div className="timeline-component-root">
      {/* Timeline Controls & Legend Bar */}
      <div className="timeline-sub-bar">
        <div className="stage-legend-group">
          <span className="legend-label">STAGES:</span>
          <span className="legend-item">
            <span className="stage-indicator stage-implemented" /> Implemented
          </span>
          <span className="legend-item">
            <span className="stage-indicator stage-change" /> Code Change
          </span>
          <span className="legend-item">
            <span className="stage-indicator stage-decision" /> Discussion / Decision
          </span>
          <span className="legend-item">
            <span className="stage-indicator stage-event" /> Reported Event
          </span>
        </div>

        <div className="timeline-view-switch">
          <span className="milestones-count-pill">
            <Icon name="clock" size={12} /> {validEvents.length.toLocaleString()} Dated Milestones
          </span>
          <div className="button-group-tabs">
            <button
              type="button"
              className={`view-toggle-btn ${viewMode === 'lanes' ? 'active' : ''}`}
              onClick={() => setViewMode('lanes')}
              title="Feature Gantt Lanes"
            >
              <Icon name="overview" size={13} /> Swimlanes
            </button>
            <button
              type="button"
              className={`view-toggle-btn ${viewMode === 'feed' ? 'active' : ''}`}
              onClick={() => setViewMode('feed')}
              title="Chronological Feed"
            >
              <Icon name="timeline" size={13} /> Stream
            </button>
          </div>
        </div>
      </div>

      {viewMode === 'lanes' ? (
        /* GANTT SWIMLANES VIEW */
        <div className="timeline-lanes-scroll-container">
          <div className="timeline-lanes-board">
            {/* Header with time axis */}
            <div className="timeline-lanes-header">
              <div className="lanes-header-label">
                <Icon name="diamond" size={13} /> FEATURE TRACKS
              </div>
              <div className="lanes-axis-track">
                {timeRange?.ticks.map((tick) => (
                  <span
                    key={tick.time}
                    className="time-tick-mark"
                    style={{ left: `${calcPosition(tick.time)}%` }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Feature Swimlane Rows */}
            <div className="timeline-lanes-body">
              {groupedFeatures.map(([featureName, items]) => (
                <div key={featureName} className="timeline-lane-row">
                  <div className="lane-feature-tag" title={featureName}>
                    <strong className="lane-feature-name">{featureName}</strong>
                    <span className="lane-count-badge">{items.length} events</span>
                  </div>

                  <div className="lane-track-area">
                    {/* Background grid lines */}
                    <div className="lane-grid-overlay" />

                    {items.map((ev, idx) => {
                      const stage = getStage(ev);
                      const isSelected = current && (current.event_id === ev.event_id || current._key === ev._key);
                      const pos = calcPosition(ev._time);

                      return (
                        <button
                          key={ev._key || idx}
                          type="button"
                          className={`timeline-node-pin ${stage} ${isSelected ? 'active-node' : ''}`}
                          style={{
                            left: `${pos}%`,
                            top: `calc(50% + ${((idx % 3) - 1) * 8}px)`,
                          }}
                          onClick={() => handleSelect(ev)}
                          aria-label={`${ev.event_type || 'Event'} on ${formatShortDate(ev.date)}: ${ev.event || ev.summary}`}
                        >
                          <span className="pin-core" />
                          <div className="pin-popover">
                            <span className="popover-stage">{ev.event_type || stage}</span>
                            <span className="popover-title">{ev.event || ev.summary}</span>
                            <span className="popover-date">{formatShortDate(ev.date)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* CHRONOLOGICAL FEED VIEW */
        <div className="timeline-feed-stream">
          {validEvents.slice(0, 100).map((ev, idx) => {
            const stage = getStage(ev);
            const isSelected = current && (current.event_id === ev.event_id || current.date === ev.date);

            return (
              <div
                key={ev.event_id || idx}
                className={`feed-event-card ${isSelected ? 'active-feed-card' : ''}`}
                onClick={() => handleSelect(ev)}
              >
                <div className="feed-card-header">
                  <div className="feed-card-left">
                    <span className={`stage-badge stage-${stage}`}>{ev.event_type || stage}</span>
                    <strong className="feed-feature-name">{ev.feature || 'General'}</strong>
                  </div>
                  <time className="feed-timestamp">
                    <Icon name="clock" size={12} /> {formatShortDate(ev.date)}
                  </time>
                </div>

                <h4 className="feed-summary">{ev.event || ev.summary}</h4>

                {ev.aim_objective && (
                  <p className="feed-objective">
                    <b>Objective:</b> {ev.aim_objective}
                  </p>
                )}

                {ev.evidence_span && (
                  <blockquote className="feed-evidence-quote">
                    "{ev.evidence_span}"
                  </blockquote>
                )}

                <div className="feed-footer-row">
                  {ev.author && (
                    <span className="feed-author">
                      <Icon name="user" size={12} /> {ev.author}
                    </span>
                  )}
                  {ev.confidence != null && (
                    <span className="feed-confidence">
                      Confidence: {Math.round(ev.confidence * 100)}% {ev.inferred ? '(Inferred)' : ''}
                    </span>
                  )}
                  {ev.source_refs && ev.source_refs.length > 0 && (
                    <span className="feed-sources-badge">
                      {ev.source_refs.length} linked sources
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Selected Milestone Inspection Drawer */}
      {current && (
        <section className="milestone-inspector-card">
          <div className="milestone-inspector-header">
            <div className="inspector-title-group">
              <span className={`stage-indicator stage-${getStage(current)}`} style={{ width: 14, height: 14 }} />
              <div>
                <span className="inspector-eyebrow">SELECTED PRODUCT MILESTONE</span>
                <h3 className="inspector-feature-title">{current.feature || 'General Axis2 Milestone'}</h3>
              </div>
            </div>

            <div className="inspector-actions">
              <span className="inspector-date-badge">
                <Icon name="clock" size={13} /> {formatShortDate(current.date)}
              </span>
              {current.evidence_span && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => onOpenEvidence?.(current)}
                >
                  <Icon name="file-text" size={13} /> View Evidence
                </button>
              )}
            </div>
          </div>

          <div className="inspector-summary-box">
            <h4>{current.event || current.summary}</h4>
            {current.aim_objective && (
              <p className="inspector-objective">
                <strong>Grounded Objective:</strong> {current.aim_objective}
              </p>
            )}
            {current.evidence_span && (
              <blockquote className="inspector-quote">
                "{current.evidence_span}"
              </blockquote>
            )}
          </div>

          <div className="inspector-meta-footer">
            {current.author && (
              <span>
                <strong>Author:</strong> {current.author}
              </span>
            )}
            <span>
              <strong>Stage Type:</strong> {current.event_type || 'Lifecycle event'}
            </span>
            {current.confidence != null && (
              <span>
                <strong>Confidence:</strong> {Math.round(current.confidence * 100)}%
              </span>
            )}
            {current.commit_hash && (
              <span className="commit-link-pill">
                <Icon name="commit" size={12} /> {current.commit_hash.slice(0, 8)}
              </span>
            )}
            {current.issue_ids && current.issue_ids.length > 0 && (
              <span className="issue-link-pill" onClick={() => onOpenIssue?.(Array.isArray(current.issue_ids) ? current.issue_ids[0] : current.issue_ids)}>
                <Icon name="issues" size={12} /> {Array.isArray(current.issue_ids) ? current.issue_ids.join(', ') : current.issue_ids}
              </span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
