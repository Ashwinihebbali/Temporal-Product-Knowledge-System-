import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';

export function IssueModal({ issueId, onClose, onSelectCommit }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [issueData, setIssueData] = useState(null);
  const [linksData, setLinksData] = useState(null);
  const [activeTab, setActiveTab] = useState('timeline'); // 'timeline' | 'commits'

  useEffect(() => {
    if (!issueId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.allSettled([
      api.issueTimeline(issueId),
      api.issueLinks(issueId),
    ]).then(([timelineRes, linksRes]) => {
      if (cancelled) return;
      if (timelineRes.status === 'fulfilled') {
        setIssueData(timelineRes.value);
      } else {
        setError(timelineRes.reason.message);
      }
      if (linksRes.status === 'fulfilled') {
        setLinksData(linksRes.value);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [issueId]);

  if (!issueId) return null;

  const issue = issueData?.issue;
  const events = issueData?.events || [];
  const commits = linksData?.items || [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-issue" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-badge-row">
            <span className="badge badge-accent">
              <Icon name="issues" size={13} /> JIRA TICKET
            </span>
            <span className="badge badge-subtle">{issueId}</span>
            {issue?.status && (
              <span className={`badge ${issue.status === 'Resolved' || issue.status === 'Closed' ? 'badge-success' : 'badge-warning'}`}>
                {issue.status}
              </span>
            )}
          </div>
          <button type="button" className="icon-button close-button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>

        {loading ? (
          <div className="modal-loading-state">
            <div className="loading-spinner" />
            <span>Retrieving issue context and linked commits for {issueId}…</span>
          </div>
        ) : error ? (
          <div className="modal-error-box">
            <Icon name="alert" size={20} color="#f87171" />
            <div>
              <strong>Failed to load {issueId}</strong>
              <p>{error}</p>
            </div>
          </div>
        ) : (
          <>
            <h2 className="issue-modal-summary">{issue?.summary || 'Issue details'}</h2>

            <div className="issue-meta-row">
              {issue?.created_at && (
                <span>
                  <b>Created:</b> {new Date(issue.created_at).toLocaleDateString()}
                </span>
              )}
              {issue?.resolved_at && (
                <span>
                  <b>Resolved:</b> {new Date(issue.resolved_at).toLocaleDateString()}
                </span>
              )}
              {issue?.reporter && (
                <span>
                  <b>Reporter:</b> {issue.reporter}
                </span>
              )}
              <span>
                <b>Commits:</b> {commits.length}
              </span>
              <span>
                <b>Timeline Events:</b> {events.length}
              </span>
            </div>

            <div className="tab-strip">
              <button
                type="button"
                className={`tab-btn ${activeTab === 'timeline' ? 'active' : ''}`}
                onClick={() => setActiveTab('timeline')}
              >
                <Icon name="timeline" size={14} /> Discussion & Events ({events.length})
              </button>
              <button
                type="button"
                className={`tab-btn ${activeTab === 'commits' ? 'active' : ''}`}
                onClick={() => setActiveTab('commits')}
              >
                <Icon name="commit" size={14} /> Linked Git Commits ({commits.length})
              </button>
            </div>

            <div className="modal-tab-body">
              {activeTab === 'timeline' && (
                <div className="issue-timeline-list">
                  {events.length === 0 ? (
                    <div className="empty-inline-state">No timeline events recorded for this ticket.</div>
                  ) : (
                    events.map((ev, idx) => (
                      <div key={idx} className="issue-event-card">
                        <div className="issue-event-top">
                          <span className="badge badge-subtle">{ev.type || 'event'}</span>
                          <time className="issue-event-time">
                            {ev.date ? new Date(ev.date).toLocaleDateString() : 'Undated'}
                          </time>
                        </div>
                        <div className="issue-event-desc">{ev.description || ev.summary}</div>
                        {ev.evidence && ev.evidence.length > 0 && (
                          <div className="issue-event-evidence">
                            {ev.evidence.map((evi, eidx) => (
                              <div key={eidx} className="evidence-snippet">
                                {evi.author && <b>{evi.author}:</b>} "{evi.text || evi.summary}"
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === 'commits' && (
                <div className="issue-commits-list">
                  {commits.length === 0 ? (
                    <div className="empty-inline-state">No linked git commits found in this dataset.</div>
                  ) : (
                    commits.map((c, idx) => (
                      <div key={idx} className="issue-commit-card">
                        <div className="commit-header">
                          <code className="commit-hash-pill">
                            <Icon name="commit" size={12} /> {c.commit_hash?.slice(0, 10)}
                          </code>
                          <span className="commit-author">by {c.author || 'Unknown'}</span>
                          <time className="commit-date">{c.date || 'Undated'}</time>
                        </div>
                        <p className="commit-message">{c.message || 'No commit message available'}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </>
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
