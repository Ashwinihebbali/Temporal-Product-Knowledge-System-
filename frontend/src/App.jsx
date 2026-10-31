import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { Icon } from './icons';

// Modals
import { CommandPalette } from './components/CommandPalette';
import { AddRecordModal } from './components/AddRecordModal';
import { BatchImportModal } from './components/BatchImportModal';
import { EvidenceModal } from './components/EvidenceModal';
import { IssueModal } from './components/IssueModal';

// Views
import { OverviewView } from './views/OverviewView';
import { FeaturesView } from './views/FeaturesView';
import { AssistantView } from './views/AssistantView';
import { TimeMachineView } from './views/TimeMachineView';
import { IssuesView } from './views/IssuesView';
import { FlagsView } from './views/FlagsView';
import Timeline from './Timeline';

const Graph = lazy(() => import('./Graph'));

const NAV_ITEMS = [
  { id: 'overview', icon: 'overview', label: 'Executive Overview', desc: 'Mission Control' },
  { id: 'timeline', icon: 'timeline', label: 'Interactive Timeline', desc: '32,500+ Milestones' },
  { id: 'features', icon: 'features', label: 'Feature Registry', desc: 'Canonical IDs' },
  { id: 'graph', icon: 'graph', label: 'Knowledge Graph', desc: 'Neo4j Visualizer' },
  { id: 'assistant', icon: 'assistant', label: 'AI Assistant', desc: 'Ollama Grounded' },
  { id: 'timemachine', icon: 'timemachine', label: 'Time Machine', desc: 'As-Of Engine' },
  { id: 'issues', icon: 'issues', label: 'Issue & Commit Hub', desc: 'Jira / Git Tracing' },
  { id: 'flags', icon: 'flags', label: 'Quality & Flags', desc: 'Data Integrity' },
];

export default function App() {
  // Navigation Route State
  const [activePage, setActivePage] = useState(() => {
    if (typeof window === 'undefined') return 'overview';
    const hash = window.location.hash.slice(1);
    if (hash.startsWith('feature/')) return 'feature-detail';
    return hash || 'overview';
  });

  const [selectedFeatureId, setSelectedFeatureId] = useState(() => {
    if (typeof window === 'undefined') return '';
    const m = window.location.hash.slice(1).match(/^feature\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : '';
  });

  // Data State
  const [status, setStatus] = useState(null);
  const [aiStatus, setAiStatus] = useState(null);
  const [events, setEvents] = useState([]);
  const [totalEvents, setTotalEvents] = useState(0);
  const [features, setFeatures] = useState([]);
  const [graph, setGraph] = useState(null);
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState([]);

  // Timeline Filters
  const [eventSearch, setEventSearch] = useState('');
  const [eventType, setEventType] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState(null);

  // Modals & Drawers
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isIngestOpen, setIsIngestOpen] = useState(false);
  const [isBatchOpen, setIsBatchOpen] = useState(false);
  const [inspectedEvidence, setInspectedEvidence] = useState(null);
  const [inspectedIssueId, setInspectedIssueId] = useState(null);
  const [assistantPrefill, setAssistantPrefill] = useState('');

  // Toast Notifications
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info') => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  // Hash route synchronization
  useEffect(() => {
    function syncRoute() {
      const hash = window.location.hash.slice(1);
      const featureMatch = hash.match(/^feature\/(.+)$/);
      if (featureMatch) {
        setSelectedFeatureId(decodeURIComponent(featureMatch[1]));
        setActivePage('feature-detail');
      } else {
        setSelectedFeatureId('');
        const valid = NAV_ITEMS.some((item) => item.id === hash);
        setActivePage(valid ? hash : 'overview');
      }
    }
    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }, []);

  // Refresh all primary data
  const refresh = useCallback(async () => {
    setRefreshing(true);
    const results = await Promise.allSettled([
      api.status(),
      api.events({ startDate, endDate, offset: page * 500, limit: 500 }),
      api.features(500),
      api.graph(200),
      api.flags(100),
      api.aiStatus(),
    ]);

    const failures = [];
    const [s, t, f, g, fl, ai] = results;

    if (s.status === 'fulfilled') setStatus(s.value);
    else failures.push(`Storage: ${s.reason.message}`);

    if (t.status === 'fulfilled') {
      setEvents(t.value.events || []);
      setTotalEvents(t.value.total_events || 0);
    } else failures.push(`Timeline: ${t.reason.message}`);

    if (f.status === 'fulfilled') setFeatures(f.value.items || []);
    else failures.push(`Features: ${f.reason.message}`);

    if (g.status === 'fulfilled') setGraph(g.value);
    else failures.push(`Graph: ${g.reason.message}`);

    if (fl.status === 'fulfilled') setFlags(fl.value.items || []);
    else failures.push(`Flags: ${fl.reason.message}`);

    if (ai.status === 'fulfilled') setAiStatus(ai.value);
    else failures.push(`AI: ${ai.reason.message}`);

    setErrors(failures);
    setLoading(false);
    setRefreshing(false);
  }, [startDate, endDate, page]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Navigate helper
  function handleNavigate(pageId, extraParam) {
    if (extraParam === 'open-palette') {
      setIsPaletteOpen(true);
      return;
    }
    if (pageId === 'feature-detail') {
      if (extraParam) {
        setSelectedFeatureId(extraParam);
        window.location.hash = `feature/${encodeURIComponent(extraParam)}`;
      }
      setActivePage('feature-detail');
      return;
    }
    if (pageId === 'assistant' && extraParam?.prefill) {
      setAssistantPrefill(extraParam.prefill);
    }
    setSelectedFeatureId('');
    window.location.hash = pageId;
    setActivePage(pageId);
  }

  // Filter timeline events client side
  const eventTypes = [...new Set(events.map((e) => e.event_type).filter(Boolean))].sort();
  const visibleEvents = events.filter((e) => {
    const matchesType = eventType === 'all' || e.event_type === eventType;
    const txt = `${e.feature || ''} ${e.event || ''} ${e.summary || ''} ${e.event_type || ''} ${e.evidence_span || ''}`.toLowerCase();
    return matchesType && txt.includes(eventSearch.trim().toLowerCase());
  });

  return (
    <div className="app-layout-shell">
      {/* Background Ambient Glow Lights */}
      <div className="ambient-background-glow">
        <div className="glow-sphere glow-1" />
        <div className="glow-sphere glow-2" />
        <div className="glow-sphere glow-3" />
      </div>

      {/* Global Command Palette */}
      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        onNavigate={handleNavigate}
        features={features}
        onOpenIngest={() => setIsIngestOpen(true)}
        onOpenBatch={() => setIsBatchOpen(true)}
        onLookupIssue={(id) => setInspectedIssueId(id)}
      />

      {/* Ingest Single Record Modal */}
      <AddRecordModal
        isOpen={isIngestOpen}
        onClose={() => setIsIngestOpen(false)}
        onAdded={refresh}
        onToast={addToast}
      />

      {/* Batch Import Modal */}
      <BatchImportModal
        isOpen={isBatchOpen}
        onClose={() => setIsBatchOpen(false)}
        onAdded={refresh}
        onToast={addToast}
      />

      {/* Evidence Quote Inspection Modal */}
      <EvidenceModal
        evidence={inspectedEvidence}
        onClose={() => setInspectedEvidence(null)}
      />

      {/* Jira Issue & Commits Inspector Modal */}
      <IssueModal
        issueId={inspectedIssueId}
        onClose={() => setInspectedIssueId(null)}
      />

      {/* Floating Toast Notification Tray */}
      <div className="toast-tray">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-card toast-${t.type}`}>
            <Icon
              name={t.type === 'success' ? 'check' : t.type === 'error' ? 'alert' : 'sparkles'}
              size={16}
            />
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {/* Modern Sidebar Navigation */}
      <aside className="main-sidebar">
        <div className="sidebar-brand-box" onClick={() => handleNavigate('overview')}>
          <div className="brand-hologram-logo">
            <Icon name="brain" size={24} color="#00e5ff" />
          </div>
          <div className="brand-text">
            <strong>ChronoDev <span className="brand-accent-text">AI</span></strong>
            <small>TEMPORAL KNOWLEDGE</small>
          </div>
        </div>

        <nav className="sidebar-nav-list">
          {NAV_ITEMS.map((item) => {
            const isActive =
              activePage === item.id ||
              (item.id === 'features' && activePage === 'feature-detail');

            return (
              <button
                key={item.id}
                type="button"
                className={`sidebar-nav-item ${isActive ? 'nav-item-active' : ''}`}
                onClick={() => handleNavigate(item.id)}
              >
                <div className="nav-icon-container">
                  <Icon name={item.icon} size={18} />
                </div>
                <div className="nav-text-container">
                  <span className="nav-item-label">{item.label}</span>
                  <span className="nav-item-desc">{item.desc}</span>
                </div>
                {isActive && <div className="nav-active-pill" />}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Telemetry Footer */}
        <div className="sidebar-footer">
          <div className="telemetry-row">
            <span
              className={`telemetry-dot ${
                status?.graph_sync?.status === 'ok' ? 'dot-online' : 'dot-warning'
              }`}
            />
            <span className="telemetry-label">
              {status?.graph_sync?.status === 'ok' ? 'Databases Synchronized' : 'Connecting to DBs…'}
            </span>
          </div>
          <div className="telemetry-sub">
            <span>Primary: <b>{status?.primary_store || 'PostgreSQL'}</b></span>
            <span>Neo4j: <b>{status?.neo4j_configured ? 'Active' : 'Offline'}</b></span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="main-content-layout">
        {/* Top Header Bar */}
        <header className="top-navigation-bar">
          <div className="topbar-left">
            {/* Quick Spotlight Trigger */}
            <button
              type="button"
              className="topbar-search-trigger"
              onClick={() => setIsPaletteOpen(true)}
            >
              <Icon name="search" size={15} color="var(--accent-cyan)" />
              <span>Search features, tickets, or commands…</span>
              <kbd className="command-kbd">⌘K / Ctrl+K</kbd>
            </button>
          </div>

          <div className="topbar-right">
            {/* Database & Sync Status Pill */}
            <div
              className={`status-pill ${
                status?.graph_sync?.status === 'ok' ? 'pill-connected' : ''
              }`}
            >
              <span className="live-pulsar" />
              <span>
                {status?.primary_store || 'PostgreSQL'} <i>·</i> Neo4j {status?.graph_sync?.status || 'Active'}
              </span>
            </div>

            {/* Ollama Status Pill */}
            <div
              className={`status-pill ${
                aiStatus?.ready ? 'pill-ai-ready' : 'pill-ai-offline'
              }`}
            >
              <Icon name="brain" size={13} />
              <span>
                Ollama: <b>{aiStatus?.model || 'llama3.2'}</b> ({aiStatus?.ready ? 'Ready' : 'Connecting'})
              </span>
            </div>

            {/* Ingestion Action Buttons */}
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => setIsBatchOpen(true)}
            >
              <Icon name="file-text" size={13} /> Add Batch
            </button>

            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setIsIngestOpen(true)}
            >
              <Icon name="plus" size={13} /> Ingest Record
            </button>

            {/* Refresh Button */}
            <button
              type="button"
              className="btn btn-icon btn-secondary"
              onClick={refresh}
              disabled={refreshing}
              title="Refresh Data"
            >
              <Icon name="refresh" size={14} className={refreshing ? 'spin-animation' : ''} />
            </button>
          </div>
        </header>

        {/* Global Error Banner */}
        {errors.length > 0 && (
          <div className="global-error-banner">
            <Icon name="alert" size={18} color="#f87171" />
            <div>
              <strong>Some background telemetry could not sync:</strong>
              <ul>
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* View Routing */}
        <main className="content-view-viewport">
          {activePage === 'overview' && (
            <OverviewView
              status={status}
              aiStatus={aiStatus}
              events={events}
              features={features}
              flags={flags}
              loading={loading}
              totalEvents={totalEvents}
              onNavigate={handleNavigate}
              onSelectEvent={setSelectedEvent}
              onOpenEvidence={setInspectedEvidence}
              onOpenIssue={setInspectedIssueId}
            />
          )}

          {activePage === 'timeline' && (
            <div className="panel full-height-panel">
              <div className="panel-header">
                <div>
                  <span className="badge badge-accent">
                    <Icon name="clock" size={12} /> HISTORICAL CHRONOLOGY
                  </span>
                  <h1 className="panel-title">
                    {totalEvents.toLocaleString()} Dated Lifecycle Milestones
                  </h1>
                </div>

                {/* Filter Toolbar */}
                <div className="timeline-page-toolbar">
                  <div className="timeline-search-field">
                    <Icon name="search" size={14} color="var(--accent-cyan)" />
                    <input
                      type="text"
                      placeholder="Search events on this page…"
                      value={eventSearch}
                      onChange={(e) => setEventSearch(e.target.value)}
                    />
                  </div>

                  <select
                    className="form-select"
                    value={eventType}
                    onChange={(e) => setEventType(e.target.value)}
                  >
                    <option value="all">All Event Types</option>
                    {eventTypes.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>

                  <div className="date-range-group">
                    <input
                      type="date"
                      className="form-input-sm"
                      value={startDate}
                      onChange={(e) => {
                        setStartDate(e.target.value);
                        setPage(0);
                      }}
                    />
                    <span>to</span>
                    <input
                      type="date"
                      className="form-input-sm"
                      value={endDate}
                      onChange={(e) => {
                        setEndDate(e.target.value);
                        setPage(0);
                      }}
                    />
                  </div>

                  <div className="pagination-controls">
                    <button
                      type="button"
                      className="btn btn-icon"
                      disabled={page === 0 || loading}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                    >
                      <Icon name="chevron-left" size={14} />
                    </button>
                    <span className="page-text">
                      {page + 1} / {Math.max(1, Math.ceil(totalEvents / 500))}
                    </span>
                    <button
                      type="button"
                      className="btn btn-icon"
                      disabled={(page + 1) * 500 >= totalEvents || loading}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <Icon name="chevron-right" size={14} />
                    </button>
                  </div>
                </div>
              </div>

              <div className="filtered-counter-line">
                Showing {visibleEvents.length} matching events of {events.length} on page {page + 1}
              </div>

              <Timeline
                events={visibleEvents}
                loading={loading}
                selected={selectedEvent}
                onSelect={setSelectedEvent}
                onOpenEvidence={setInspectedEvidence}
                onOpenIssue={setInspectedIssueId}
                onExploreGraph={() => handleNavigate('graph')}
              />
            </div>
          )}

          {(activePage === 'features' || activePage === 'feature-detail') && (
            <FeaturesView
              features={features}
              selectedFeatureId={selectedFeatureId}
              onSelectFeature={(id) => handleNavigate('feature-detail', id)}
              onBack={() => handleNavigate('features')}
              onNavigate={handleNavigate}
              onOpenEvidence={setInspectedEvidence}
              onOpenIssue={setInspectedIssueId}
              onToast={addToast}
            />
          )}

          {activePage === 'graph' && (
            <div className="panel graph-full-panel">
              <div className="panel-header">
                <div>
                  <span className="badge badge-accent">
                    <Icon name="network" size={12} /> NEO4J KNOWLEDGE GRAPH
                  </span>
                  <h1 className="panel-title">Semantic Architecture & Relationship Map</h1>
                </div>
                <span className="badge badge-subtle">
                  {graph?.total_links || graph?.edges?.length || 0} Synced Edges
                </span>
              </div>

              {graph?.nodes?.length ? (
                <Suspense
                  fallback={
                    <div className="graph-loading-box">
                      <div className="loading-spinner" />
                      <span>Synthesizing multi-model Cytoscape graph canvas…</span>
                    </div>
                  }
                >
                  <Graph
                    data={graph}
                    onOpenIssue={setInspectedIssueId}
                    onNavigateFeature={(id) => handleNavigate('feature-detail', id)}
                  />
                </Suspense>
              ) : (
                <div className="graph-loading-box">
                  <Icon name="network" size={32} color="var(--text-muted)" />
                  <p>Awaiting graph relationship data from backend Neo4j connector…</p>
                </div>
              )}
            </div>
          )}

          {activePage === 'assistant' && (
            <AssistantView
              aiStatus={aiStatus}
              initialQuestion={assistantPrefill}
              onOpenEvidence={setInspectedEvidence}
              onOpenIssue={setInspectedIssueId}
              onToast={addToast}
            />
          )}

          {activePage === 'timemachine' && (
            <TimeMachineView
              features={features}
              onOpenEvidence={setInspectedEvidence}
              onOpenIssue={setInspectedIssueId}
            />
          )}

          {activePage === 'issues' && (
            <IssuesView onOpenIssue={setInspectedIssueId} />
          )}

          {activePage === 'flags' && (
            <FlagsView
              flags={flags}
              onNavigateFeature={(id) => handleNavigate('feature-detail', id)}
            />
          )}
        </main>

        {/* Global Footer */}
        <footer className="main-footer">
          <span>
            <b>ChronoDev AI</b> · Temporal Product Knowledge Engine for Apache Axis2
          </span>
          <span className="footer-dot">·</span>
          <span>PostgreSQL + Neo4j + Local Ollama Grounded Reasoning</span>
        </footer>
      </div>
    </div>
  );
}
