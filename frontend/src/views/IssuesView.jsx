import React, { useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';

const POPULAR_ISSUES = [
  'AXIS2-791',
  'AXIS2-100',
  'AXIS2-5894',
  'AXIS2-5896',
  'AXIS2-5849',
  'AXIS2-2000',
];

export function IssuesView({ onOpenIssue }) {
  const [query, setQuery] = useState('kernel');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function handleSearch(qStr) {
    const q = (qStr || query).trim();
    if (!q) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await api.searchIssues(q, 25);
      setResults(res.items || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="issues-view-container">
      {/* Search Header */}
      <div className="issues-header-card">
        <div>
          <span className="badge badge-accent">
            <Icon name="issues" size={13} /> JIRA TICKET INTELLIGENCE
          </span>
          <h1 className="issues-main-title">Issue & Commit Inspector</h1>
          <p className="issues-subtext">
            Search Apache Axis2 Jira tickets, inspect discussion threads, and trace linked Git commits with author and diff metadata.
          </p>
        </div>

        {/* Quick presets */}
        <div className="issues-preset-row">
          <span className="preset-label">Quick Lookups:</span>
          {POPULAR_ISSUES.map((issueId) => (
            <button
              key={issueId}
              type="button"
              className="btn btn-chip"
              onClick={() => {
                setQuery(issueId);
                onOpenIssue(issueId);
              }}
            >
              {issueId}
            </button>
          ))}
        </div>

        {/* Search input bar */}
        <form
          className="issues-search-bar"
          onSubmit={(e) => {
            e.preventDefault();
            handleSearch();
          }}
        >
          <Icon name="search" size={18} color="var(--accent-cyan)" />
          <input
            type="text"
            className="issues-search-input"
            placeholder="Search by ticket ID (e.g. AXIS2-791) or keywords (e.g. security, rampart, kernel)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={loading || !query.trim()}>
            {loading ? 'Searching…' : 'Search Issues'}
          </button>
        </form>
      </div>

      {/* Results List */}
      <div className="issues-results-panel">
        <div className="panel-header">
          <h2 className="panel-title">
            {searched ? `Found ${results.length} Matching Issues` : 'Search for Jira Issues'}
          </h2>
        </div>

        {loading ? (
          <div className="issues-loading-state">
            <div className="loading-spinner" />
            <span>Scanning Jira issue index…</span>
          </div>
        ) : results.length === 0 && searched ? (
          <div className="issues-empty-state">
            <Icon name="issues" size={32} color="var(--text-muted)" />
            <h3>No matching tickets found</h3>
            <p>Try searching for a different keyword or enter a ticket ID like AXIS2-791.</p>
          </div>
        ) : (
          <div className="issues-grid">
            {results.map((item) => (
              <div
                key={item.issue_id}
                className="issue-card"
                onClick={() => onOpenIssue(item.issue_id)}
              >
                <div className="issue-card-top">
                  <span className="issue-id-tag">{item.issue_id}</span>
                  <span
                    className={`badge ${
                      item.status === 'Resolved' || item.status === 'Closed'
                        ? 'badge-success'
                        : 'badge-warning'
                    }`}
                  >
                    {item.status || 'Reported'}
                  </span>
                </div>

                <h3 className="issue-card-title">{item.summary}</h3>

                <div className="issue-card-meta">
                  {item.created_at && (
                    <span>
                      <b>Created:</b> {new Date(item.created_at).toLocaleDateString()}
                    </span>
                  )}
                  {item.resolved_at && (
                    <span>
                      <b>Resolved:</b> {new Date(item.resolved_at).toLocaleDateString()}
                    </span>
                  )}
                </div>

                <div className="issue-card-footer">
                  <span className="text-link">View Discussion & Commits →</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
