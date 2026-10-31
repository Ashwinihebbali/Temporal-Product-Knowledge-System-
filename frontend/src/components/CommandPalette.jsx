import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';

export function CommandPalette({ isOpen, onClose, onNavigate, features = [], onOpenIngest, onOpenBatch, onLookupIssue }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
        else onNavigate?.(null, 'open-palette');
      }
      if (!isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, onNavigate]);

  if (!isOpen) return null;

  const defaultActions = [
    { id: 'overview', title: 'Executive Overview', desc: 'Mission control, top KPIs & architecture', icon: 'overview', type: 'page' },
    { id: 'timeline', title: 'Interactive Timeline', desc: 'Browse 32,500+ dated milestones & Gantt lanes', icon: 'timeline', type: 'page' },
    { id: 'features', title: 'Feature Registry', desc: 'Explore 33+ canonical feature identities', icon: 'features', type: 'page' },
    { id: 'graph', title: 'Knowledge Graph', desc: 'Interactive Cytoscape 2D relationship map', icon: 'graph', type: 'page' },
    { id: 'assistant', title: 'AI Research Assistant', desc: 'Ask evidence-grounded questions with Ollama', icon: 'assistant', type: 'page' },
    { id: 'timemachine', title: 'Time Machine (As-Of Engine)', desc: 'Temporal snapshot browser across Axis2 history', icon: 'timemachine', type: 'page' },
    { id: 'issues', title: 'Issue & Commit Inspector', desc: 'Lookup Jira tickets and linked Git commits', icon: 'issues', type: 'page' },
    { id: 'flags', title: 'Quality & Audit Flags', desc: 'Review conflicts and timeline anomalies', icon: 'flags', type: 'page' },
    { id: 'action-ingest', title: 'Ingest Single Record', desc: 'Add Jira ticket, meeting note, or commit', icon: 'plus', type: 'action', action: onOpenIngest },
    { id: 'action-batch', title: 'Import JSON Batch', desc: 'Incremental ingestion with automatic deduplication', icon: 'file-text', type: 'action', action: onOpenBatch },
  ];

  const trimmed = query.trim().toLowerCase();

  // If query matches AXIS2-... pattern
  const isIssueQuery = /^axis2-\d+/i.test(trimmed);

  const matchedFeatures = trimmed
    ? features
        .filter((f) => (f.canonical_name || f.feature_id || '').toLowerCase().includes(trimmed))
        .slice(0, 5)
        .map((f) => ({
          id: `feature:${f.feature_id}`,
          title: f.canonical_name || f.feature_id,
          desc: `${f.record_count || 0} linked records · ${f.origin || 'canonical'}`,
          icon: 'diamond',
          type: 'feature',
          featureId: f.feature_id,
        }))
    : [];

  const filteredActions = trimmed
    ? defaultActions.filter((a) => a.title.toLowerCase().includes(trimmed) || a.desc.toLowerCase().includes(trimmed))
    : defaultActions;

  const results = [
    ...(isIssueQuery
      ? [
          {
            id: `lookup:${query.trim().toUpperCase()}`,
            title: `Lookup Issue: ${query.trim().toUpperCase()}`,
            desc: 'View full Jira discussion and linked Git commits',
            icon: 'issues',
            type: 'issue-lookup',
            issueId: query.trim().toUpperCase(),
          },
        ]
      : []),
    ...matchedFeatures,
    ...filteredActions,
  ];

  function executeItem(item) {
    if (!item) return;
    onClose();
    if (item.type === 'page') {
      onNavigate(item.id);
    } else if (item.type === 'feature') {
      window.location.hash = `feature/${encodeURIComponent(item.featureId)}`;
      onNavigate('feature-detail', item.featureId);
    } else if (item.type === 'action') {
      item.action?.();
    } else if (item.type === 'issue-lookup') {
      onLookupIssue?.(item.issueId);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((idx) => (idx + 1) % Math.max(1, results.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((idx) => (idx - 1 + results.length) % Math.max(1, results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      executeItem(results[selectedIndex]);
    }
  }

  return (
    <div className="command-palette-backdrop" onClick={onClose}>
      <div className="command-palette-modal" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="command-search-bar">
          <Icon name="search" size={20} color="var(--accent-cyan)" />
          <input
            ref={inputRef}
            type="text"
            className="command-input"
            placeholder="Type a command, feature name, or ticket (e.g. AXIS2-791)..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
          />
          <kbd className="command-kbd">ESC</kbd>
        </div>

        <div className="command-results-list">
          {results.length === 0 ? (
            <div className="command-empty-state">No matching commands, features, or tickets found.</div>
          ) : (
            results.map((item, idx) => (
              <div
                key={item.id}
                className={`command-item ${idx === selectedIndex ? 'selected' : ''}`}
                onClick={() => executeItem(item)}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <div className="command-item-icon">
                  <Icon name={item.icon} size={16} />
                </div>
                <div className="command-item-info">
                  <div className="command-item-title">{item.title}</div>
                  <div className="command-item-desc">{item.desc}</div>
                </div>
                <span className="command-item-badge">{item.type}</span>
              </div>
            ))
          )}
        </div>

        <div className="command-palette-footer">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> Navigate
          </span>
          <span>
            <kbd>↵</kbd> Select
          </span>
          <span>
            <kbd>ESC</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
}
