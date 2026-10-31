import React from 'react';
import { Icon } from '../icons';
import Timeline from '../Timeline';

export function OverviewView({
  status,
  aiStatus,
  events = [],
  features = [],
  flags = [],
  loading = false,
  totalEvents = 0,
  onNavigate,
  onSelectEvent,
  onOpenEvidence,
  onOpenIssue,
}) {
  const topFeatures = [...features]
    .sort((a, b) => (b.record_count || 0) - (a.record_count || 0))
    .slice(0, 6);

  const graphLinksCount = status?.graph_sync?.last_sync_counts?.assignments || 4880;

  return (
    <div className="overview-container">
      {/* Hero Welcome Banner */}
      <section className="overview-hero-card">
        <div className="hero-content">
          <div className="hero-eyebrow">
            <span className="badge badge-accent">
              <Icon name="sparkles" size={13} /> APACHE AXIS2 · TEMPORAL KNOWLEDGE PLATFORM
            </span>
            <span className="badge badge-success">
              <span className="live-pulsar" /> LIVE SYNC ACTIVE
            </span>
          </div>

          <h1 className="hero-main-title">Autonomous Product History & Evidence Graph</h1>

          <p className="hero-description">
            ChronoDev AI continuously reconstructs software evolution from Jira tickets, git commits, and mailing list discussions. Every capability decision is grounded in verbatim source evidence quotes and cross-linked in Neo4j.
          </p>

          <div className="hero-actions-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onNavigate('assistant')}
            >
              <Icon name="assistant" size={15} /> Ask ChronoDev Assistant
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onNavigate('timeline')}
            >
              <Icon name="timeline" size={15} /> Explore Full Timeline
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onNavigate('graph')}
            >
              <Icon name="graph" size={15} /> View Knowledge Graph
            </button>
          </div>
        </div>

        {/* Mini Architecture Flow Visual */}
        <div className="hero-architecture-card">
          <div className="arch-header">
            <Icon name="terminal" size={14} color="var(--accent-cyan)" />
            <span>KNOWLEDGE PIPELINE TELEMETRY</span>
          </div>

          <div className="arch-flow-diagram">
            <div className="arch-node">
              <Icon name="file-text" size={16} />
              <span>Axis2 Dataset</span>
              <small>Jira / Git</small>
            </div>
            <div className="arch-arrow">→</div>
            <div className="arch-node active-postgres">
              <Icon name="database" size={16} />
              <span>PostgreSQL</span>
              <small>Source of Truth</small>
            </div>
            <div className="arch-arrow">→</div>
            <div className="arch-node active-neo4j">
              <Icon name="network" size={16} />
              <span>Neo4j Graph</span>
              <small>Relational Fabric</small>
            </div>
            <div className="arch-arrow">→</div>
            <div className="arch-node active-ollama">
              <Icon name="brain" size={16} />
              <span>Ollama 3.2</span>
              <small>Local LLM</small>
            </div>
          </div>

          <div className="arch-footer">
            <span>Primary Store: <b>{status?.primary_store || 'PostgreSQL'}</b></span>
            <span>Sync Engine: <b>{status?.graph_sync?.status === 'ok' ? 'Online' : 'Connected'}</b></span>
          </div>
        </div>
      </section>

      {/* KPI Metric Cards */}
      <section className="stats-metric-grid">
        <div className="stat-card" onClick={() => onNavigate('timeline')}>
          <div className="stat-card-top">
            <span className="stat-label">HISTORICAL EVENTS</span>
            <div className="stat-icon-wrapper stat-emerald">
              <Icon name="timeline" size={18} />
            </div>
          </div>
          <strong className="stat-number">{loading ? '…' : totalEvents.toLocaleString()}</strong>
          <div className="stat-subtext">
            <span>Dated software lifecycle milestones</span>
            <Icon name="chevron-right" size={13} />
          </div>
          <div className="stat-bar-accent bar-emerald" />
        </div>

        <div className="stat-card" onClick={() => onNavigate('features')}>
          <div className="stat-card-top">
            <span className="stat-label">CANONICAL FEATURES</span>
            <div className="stat-icon-wrapper stat-violet">
              <Icon name="diamond" size={18} />
            </div>
          </div>
          <strong className="stat-number">{loading ? '…' : features.length.toLocaleString()}</strong>
          <div className="stat-subtext">
            <span>Tracked architectural capabilities</span>
            <Icon name="chevron-right" size={13} />
          </div>
          <div className="stat-bar-accent bar-violet" />
        </div>

        <div className="stat-card" onClick={() => onNavigate('graph')}>
          <div className="stat-card-top">
            <span className="stat-label">GRAPH RELATIONSHIPS</span>
            <div className="stat-icon-wrapper stat-cyan">
              <Icon name="graph" size={18} />
            </div>
          </div>
          <strong className="stat-number">{loading ? '…' : graphLinksCount.toLocaleString()}</strong>
          <div className="stat-subtext">
            <span>Cross-entity semantic connections</span>
            <Icon name="chevron-right" size={13} />
          </div>
          <div className="stat-bar-accent bar-cyan" />
        </div>

        <div className="stat-card" onClick={() => onNavigate('flags')}>
          <div className="stat-card-top">
            <span className="stat-label">AUDIT & QUALITY FLAGS</span>
            <div className="stat-icon-wrapper stat-amber">
              <Icon name="flags" size={18} />
            </div>
          </div>
          <strong className="stat-number">{loading ? '…' : flags.length}</strong>
          <div className="stat-subtext">
            <span>Conflicts, gaps & review items</span>
            <Icon name="chevron-right" size={13} />
          </div>
          <div className="stat-bar-accent bar-amber" />
        </div>
      </section>

      {/* Main Content Split: Recent Milestones + Top Features */}
      <div className="overview-split-layout">
        {/* Left Column: Recent Timeline Preview */}
        <div className="panel overview-timeline-panel">
          <div className="panel-header">
            <div>
              <span className="badge badge-accent">
                <Icon name="clock" size={12} /> RECENT HISTORY
              </span>
              <h2 className="panel-title">Latest Product Milestones</h2>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => onNavigate('timeline')}
            >
              View All {totalEvents.toLocaleString()} Events →
            </button>
          </div>

          <Timeline
            events={events.slice(0, 12)}
            onSelect={onSelectEvent}
            loading={loading}
            onOpenEvidence={onOpenEvidence}
            onOpenIssue={onOpenIssue}
          />
        </div>

        {/* Right Column: Top Canonical Features + Quick Actions */}
        <div className="overview-side-column">
          {/* Top Features Panel */}
          <div className="panel">
            <div className="panel-header">
              <div>
                <span className="badge badge-accent">
                  <Icon name="diamond" size={12} /> CORE IDENTITY
                </span>
                <h3 className="panel-title">Top Active Features</h3>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => onNavigate('features')}
              >
                All Features →
              </button>
            </div>

            <div className="feature-mini-list">
              {topFeatures.map((f) => (
                <div
                  key={f.feature_id}
                  className="feature-mini-card"
                  onClick={() => {
                    window.location.hash = `feature/${encodeURIComponent(f.feature_id)}`;
                    onNavigate('feature-detail', f.feature_id);
                  }}
                >
                  <div className="feature-mini-top">
                    <strong className="feature-mini-name">{f.canonical_name || f.feature_id}</strong>
                    <span className="feature-mini-count">{f.record_count || 0} records</span>
                  </div>
                  <div className="feature-mini-origin">
                    <span className="badge badge-subtle">{f.origin || 'canonical'}</span>
                    <span className="text-link">Explore →</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Launchpad */}
          <div className="panel quick-launch-panel">
            <div className="panel-header">
              <h3 className="panel-title">Feature Launchpad</h3>
            </div>

            <div className="launchpad-grid">
              <div className="launch-card" onClick={() => onNavigate('timemachine')}>
                <div className="launch-icon">
                  <Icon name="timemachine" size={18} color="var(--accent-cyan)" />
                </div>
                <div>
                  <strong>Time Machine Engine</strong>
                  <p>View state snapshot as of any past date</p>
                </div>
              </div>

              <div className="launch-card" onClick={() => onNavigate('issues')}>
                <div className="launch-icon">
                  <Icon name="issues" size={18} color="var(--accent-rose)" />
                </div>
                <div>
                  <strong>Jira Issue Inspector</strong>
                  <p>Search ticket history and linked git commits</p>
                </div>
              </div>

              <div className="launch-card" onClick={() => onNavigate('assistant')}>
                <div className="launch-icon">
                  <Icon name="brain" size={18} color="var(--accent-violet)" />
                </div>
                <div>
                  <strong>Ollama LLM Assistant</strong>
                  <p>Ask questions with grounded citations</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
