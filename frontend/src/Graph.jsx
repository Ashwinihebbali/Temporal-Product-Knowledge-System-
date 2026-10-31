import React, { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import { Icon } from './icons';

const NODE_COLORS = {
  feature: { bg: '#8b5cf6', border: '#c4b5fd', halo: 'rgba(139, 92, 246, 0.4)' },
  issue: { bg: '#ff5c77', border: '#fecdd3', halo: 'rgba(255, 92, 119, 0.4)' },
  commit: { bg: '#00e5ff', border: '#a5f3fc', halo: 'rgba(0, 229, 255, 0.4)' },
  history_event: { bg: '#10b981', border: '#a7f3d0', halo: 'rgba(16, 185, 129, 0.4)' },
  source_record: { bg: '#f59e0b', border: '#fde68a', halo: 'rgba(245, 158, 11, 0.4)' },
  default: { bg: '#64748b', border: '#cbd5e1', halo: 'rgba(100, 116, 139, 0.3)' },
};

function formatNodeKind(kind) {
  return String(kind || 'source')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Graph({
  data,
  onSelect,
  selectedNode,
  onOpenIssue,
  onNavigateFeature,
}) {
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  const [layoutName, setLayoutName] = useState('concentric');
  const [searchQuery, setSearchQuery] = useState('');
  const [selection, setSelection] = useState(null);
  const [connections, setConnections] = useState([]);
  const [showEdgeLabels, setShowEdgeLabels] = useState(false);
  const [activeKindFilter, setActiveKindFilter] = useState('all');

  const nodes = data?.nodes || [];
  const edges = data?.edges || [];

  const kindCounts = useMemo(() => {
    return nodes.reduce((acc, n) => {
      const k = n.data?.kind || 'source_record';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
  }, [nodes]);

  // Initialize and update Cytoscape instance
  useEffect(() => {
    if (!containerRef.current || !data) return undefined;

    const cy = cytoscape({
      container: containerRef.current,
      elements: [...nodes, ...edges],
      minZoom: 0.1,
      maxZoom: 3.5,
      wheelSensitivity: 0.25,
      style: [
        {
          selector: 'node',
          style: {
            'font-family': "'JetBrains Mono', 'Sora', sans-serif",
            'font-size': 11,
            'color': '#f8fafc',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 7,
            'text-outline-color': '#070b14',
            'text-outline-width': 3,
            'background-color': (ele) => NODE_COLORS[ele.data('kind')]?.bg || NODE_COLORS.default.bg,
            'border-color': (ele) => NODE_COLORS[ele.data('kind')]?.border || NODE_COLORS.default.border,
            'border-width': 2,
            'width': 18,
            'height': 18,
            'transition-property': 'width, height, border-width, opacity, background-color',
            'transition-duration': '0.2s',
          },
        },
        {
          selector: 'node[kind = "feature"]',
          style: {
            'label': 'data(label)',
            'width': 44,
            'height': 44,
            'font-size': 13,
            'font-weight': 800,
            'border-width': 3.5,
            'border-color': '#e9d5ff',
            'text-max-width': 130,
            'text-wrap': 'wrap',
          },
        },
        {
          selector: 'node[kind = "issue"]',
          style: {
            'width': 24,
            'height': 24,
            'label': 'data(label)',
            'font-size': 10,
          },
        },
        {
          selector: 'node[kind = "commit"]',
          style: {
            'width': 18,
            'height': 18,
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 1.4,
            'line-color': '#334155',
            'target-arrow-color': '#475569',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.85,
            'curve-style': 'bezier',
            'label': showEdgeLabels ? 'data(label)' : '',
            'font-size': 8,
            'font-family': "'JetBrains Mono', monospace",
            'color': '#94a3b8',
            'text-background-color': '#0f172a',
            'text-background-opacity': 0.9,
            'text-background-padding': 2,
            'text-rotation': 'autorotate',
            'opacity': 0.65,
          },
        },
        {
          selector: 'node.node-hover, node.is-neighbor, node.is-focused',
          style: {
            'label': 'data(label)',
            'font-size': 11,
            'font-weight': 700,
            'opacity': 1,
            'z-index': 20,
          },
        },
        {
          selector: 'node.is-focused',
          style: {
            'border-color': '#00e5ff',
            'border-width': 5,
            'width': 52,
            'height': 52,
            'z-index': 30,
          },
        },
        {
          selector: 'edge.is-connected',
          style: {
            'width': 2.5,
            'line-color': '#8b5cf6',
            'target-arrow-color': '#a78bfa',
            'opacity': 1,
            'z-index': 15,
            'label': 'data(label)',
          },
        },
        {
          selector: '.is-muted',
          style: {
            'opacity': 0.12,
          },
        },
      ],
    });

    cyRef.current = cy;

    // Apply layout
    runLayout(cy, layoutName);

    // Event handlers
    cy.on('tap', 'node', (evt) => {
      const target = evt.target;
      focusOnNode(cy, target);
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        resetFocus(cy);
      }
    });

    cy.on('mouseover', 'node', (evt) => {
      evt.target.addClass('node-hover');
    });
    cy.on('mouseout', 'node', (evt) => {
      evt.target.removeClass('node-hover');
    });

    const ro = new ResizeObserver(() => {
      cy.resize();
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
  }, [data, showEdgeLabels]);

  function runLayout(cy, layoutType) {
    if (!cy) return;
    let config = { name: layoutType, padding: 50, animate: true, animationDuration: 600 };

    if (layoutType === 'concentric') {
      config = {
        name: 'concentric',
        padding: 50,
        animate: true,
        animationDuration: 600,
        concentric: (node) => (node.data('kind') === 'feature' ? 3 : node.data('kind') === 'issue' ? 2 : 1),
        levelWidth: () => 1,
        minNodeSpacing: 35,
      };
    } else if (layoutType === 'cose') {
      config = {
        name: 'cose',
        padding: 60,
        animate: true,
        animationDuration: 750,
        nodeRepulsion: 6500,
        idealEdgeLength: 60,
      };
    }

    const layout = cy.layout(config);
    layout.run();
  }

  function handleLayoutChange(newLayout) {
    setLayoutName(newLayout);
    runLayout(cyRef.current, newLayout);
  }

  function focusOnNode(cy, targetNode) {
    if (!cy || !targetNode || !targetNode.length) return;

    cy.elements().addClass('is-muted').removeClass('is-neighbor is-focused is-connected');
    targetNode.closedNeighborhood().removeClass('is-muted');
    targetNode.closedNeighborhood().nodes().addClass('is-neighbor');
    targetNode.connectedEdges().addClass('is-connected');
    targetNode.addClass('is-focused');

    const data = targetNode.data();
    setSelection(data);

    const conns = targetNode.connectedEdges().map((edge) => {
      const other = edge.source().id() === targetNode.id() ? edge.target() : edge.source();
      return {
        label: edge.data('label') || 'RELATED_TO',
        node: other.data(),
      };
    });
    setConnections(conns);
    onSelect?.(data);

    cy.animate({
      fit: { eles: targetNode.closedNeighborhood(), padding: 75 },
      duration: 500,
    });
  }

  function resetFocus(cy) {
    if (!cy) return;
    cy.elements().removeClass('is-muted is-focused is-neighbor is-connected');
    setSelection(null);
    setConnections([]);
    onSelect?.(null);
  }

  function handleSearch(e) {
    e.preventDefault();
    const cy = cyRef.current;
    if (!cy) return;

    const needle = searchQuery.trim().toLowerCase();
    if (!needle) {
      resetFocus(cy);
      cy.animate({ fit: { eles: cy.elements(), padding: 50 }, duration: 400 });
      return;
    }

    const matches = cy.nodes().filter((n) => {
      const lbl = String(n.data('label') || '').toLowerCase();
      const id = String(n.id() || '').toLowerCase();
      return lbl.includes(needle) || id.includes(needle);
    });

    if (matches.length > 0) {
      focusOnNode(cy, matches[0]);
    }
  }

  function handleFilterByKind(kind) {
    const cy = cyRef.current;
    if (!cy) return;

    setActiveKindFilter(kind);
    if (kind === 'all') {
      cy.elements().removeClass('is-muted');
      cy.animate({ fit: { eles: cy.elements(), padding: 50 }, duration: 400 });
    } else {
      cy.elements().addClass('is-muted');
      const matched = cy.nodes().filter((n) => n.data('kind') === kind);
      matched.closedNeighborhood().removeClass('is-muted');
      cy.animate({ fit: { eles: matched, padding: 60 }, duration: 450 });
    }
  }

  function handleZoom(factor) {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({
      level: cy.zoom() * factor,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  }

  function handleFit() {
    const cy = cyRef.current;
    if (!cy) return;
    resetFocus(cy);
    cy.animate({ fit: { eles: cy.elements(), padding: 50 }, duration: 400 });
  }

  return (
    <div className="graph-view-wrapper">
      {/* Top Toolbar */}
      <div className="graph-control-bar">
        {/* Search */}
        <form className="graph-search-form" onSubmit={handleSearch}>
          <Icon name="search" size={15} color="var(--accent-cyan)" />
          <input
            type="text"
            className="graph-search-input"
            placeholder="Search graph (e.g. kernel, AXIS2-791)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                setSearchQuery('');
                resetFocus(cyRef.current);
              }}
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </form>

        {/* Layout Switcher */}
        <div className="graph-layout-selector">
          <span className="control-label">LAYOUT:</span>
          {['concentric', 'cose', 'circle', 'grid'].map((l) => (
            <button
              key={l}
              type="button"
              className={`btn btn-chip ${layoutName === l ? 'active' : ''}`}
              onClick={() => handleLayoutChange(l)}
            >
              {l === 'cose' ? 'Physics' : l.charAt(0).toUpperCase() + l.slice(1)}
            </button>
          ))}
        </div>

        {/* Edge label toggle */}
        <button
          type="button"
          className={`btn btn-chip ${showEdgeLabels ? 'active' : ''}`}
          onClick={() => setShowEdgeLabels(!showEdgeLabels)}
        >
          {showEdgeLabels ? 'Hide Labels' : 'Show Labels'}
        </button>

        {/* Zoom Controls */}
        <div className="graph-zoom-tools">
          <button type="button" className="btn btn-icon" onClick={() => handleZoom(1.25)} title="Zoom In">
            <Icon name="plus" size={15} />
          </button>
          <button type="button" className="btn btn-icon" onClick={() => handleZoom(0.8)} title="Zoom Out">
            <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" />
          </button>
          <button type="button" className="btn btn-chip" onClick={handleFit} title="Fit to Canvas">
            Fit View
          </button>
        </div>
      </div>

      {/* Main Graph Body */}
      <div className="graph-workspace-layout">
        {/* Cytoscape Canvas */}
        <div className="graph-canvas-frame">
          <div ref={containerRef} className="cytoscape-canvas" />

          {/* Quick Filter Pill Row */}
          <div className="graph-kind-pill-row">
            <button
              type="button"
              className={`kind-pill ${activeKindFilter === 'all' ? 'active' : ''}`}
              onClick={() => handleFilterByKind('all')}
            >
              All Nodes ({nodes.length})
            </button>
            {Object.entries(kindCounts).map(([kind, count]) => (
              <button
                key={kind}
                type="button"
                className={`kind-pill ${activeKindFilter === kind ? 'active' : ''}`}
                onClick={() => handleFilterByKind(kind)}
              >
                <span
                  className="kind-dot"
                  style={{ backgroundColor: NODE_COLORS[kind]?.bg || NODE_COLORS.default.bg }}
                />
                {formatNodeKind(kind)} ({count})
              </button>
            ))}
          </div>

          <div className="graph-canvas-hint">
            <Icon name="sparkles" size={12} color="var(--accent-cyan)" /> Scroll to zoom · Drag to pan · Click any node to focus its network
          </div>
        </div>

        {/* Floating Glass Inspector Sidebar */}
        <aside className="graph-inspector-sidebar">
          <div className="inspector-head">
            <span className="badge badge-accent">
              <Icon name="network" size={13} /> KNOWLEDGE GRAPH
            </span>
            <div className="inspector-stats-row">
              <div className="inspector-stat">
                <strong>{nodes.length}</strong>
                <span>Nodes</span>
              </div>
              <div className="inspector-stat">
                <strong>{edges.length}</strong>
                <span>Links</span>
              </div>
            </div>
          </div>

          {selection ? (
            <div className="inspector-selection-box">
              <div className="selection-badge-row">
                <span
                  className="kind-tag"
                  style={{
                    backgroundColor: NODE_COLORS[selection.kind]?.bg || NODE_COLORS.default.bg,
                  }}
                >
                  {formatNodeKind(selection.kind)}
                </span>
                <code className="selection-id">{selection.id}</code>
              </div>

              <h3 className="selection-title">{selection.label || selection.id}</h3>

              {/* Direct Connections */}
              <div className="selection-conns-section">
                <div className="conns-header">
                  <span>Direct Connections</span>
                  <span className="conns-count">{connections.length}</span>
                </div>

                <div className="conns-list">
                  {connections.length === 0 ? (
                    <div className="empty-inline-state">No direct neighbors in this preview subgraph.</div>
                  ) : (
                    connections.map((c, idx) => (
                      <div
                        key={idx}
                        className="conn-item"
                        onClick={() => {
                          const cy = cyRef.current;
                          if (cy) {
                            const nodeEle = cy.getElementById(c.node.id);
                            if (nodeEle.length) focusOnNode(cy, nodeEle);
                          }
                        }}
                      >
                        <span
                          className="kind-dot"
                          style={{
                            backgroundColor: NODE_COLORS[c.node.kind]?.bg || NODE_COLORS.default.bg,
                          }}
                        />
                        <div className="conn-info">
                          <strong className="conn-label">{c.node.label || c.node.id}</strong>
                          <span className="conn-rel">{c.label}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Contextual Action Buttons */}
              <div className="inspector-actions-row">
                {selection.kind === 'feature' && (
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => onNavigateFeature?.(selection.id.replace('feature:', ''))}
                  >
                    Open Feature Dashboard →
                  </button>
                )}
                {selection.kind === 'issue' && (
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => onOpenIssue?.(selection.label || selection.id.replace('issue:', ''))}
                  >
                    Lookup Ticket Details →
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="inspector-empty-card">
              <Icon name="network" size={28} color="var(--text-muted)" />
              <h4>Select a node to inspect</h4>
              <p>Click on any feature hub, Jira ticket, or commit node to see its neighborhood and connected history.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
