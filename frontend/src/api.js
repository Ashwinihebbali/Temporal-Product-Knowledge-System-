const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8001';

async function request(path, options = {}) {
  const url = `${API}${path}`;
  try {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || `Request failed (${response.status})`);
    }
    return await response.json();
  } catch (err) {
    if (err.message.includes('Failed to fetch')) {
      throw new Error(`Cannot connect to ChronoDev API at ${API}. Ensure the backend is running.`);
    }
    throw err;
  }
}

export const api = {
  // System Health & Telemetry
  health: () => request('/health'),
  status: () => request('/api/storage/status'),
  aiStatus: () => request('/api/ai/status'),

  // Historical Timeline & Search
  events: ({ startDate = '', endDate = '', offset = 0, limit = 500 } = {}) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    return request(`/api/history/timeline?${params}`);
  },
  searchHistory: (q, { startDate = '', endDate = '', limit = 30, offset = 0 } = {}) => {
    const params = new URLSearchParams({ q, limit: String(limit), offset: String(offset) });
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    return request(`/api/history/search?${params}`);
  },
  eventsForFeature: (featureId, offset = 0, limit = 500) =>
    request(`/api/events?entity_id=${encodeURIComponent(featureId)}&limit=${limit}&offset=${offset}`),

  // Features & Canonical Entities
  features: (limit = 500, offset = 0) => request(`/api/features?limit=${limit}&offset=${offset}`),
  entities: (limit = 500) => request(`/api/entities?limit=${limit}`),
  resolveFeature: (featureName, description = '') =>
    request('/api/features/resolve', {
      method: 'POST',
      body: JSON.stringify({ feature_name: featureName, description }),
    }),
  addAlias: (entityId, { aliasName, validFrom = null, validTo = null, sourceRef = '' }) =>
    request(`/api/entities/${encodeURIComponent(entityId)}/aliases`, {
      method: 'POST',
      body: JSON.stringify({ alias_name: aliasName, valid_from: validFrom, valid_to: validTo, source_ref: sourceRef }),
    }),
  addRelation: ({ fromEntity, toEntity, relationType = 'depends_on', sourceRef = '', evidenceSpan = '', confidence = 0.8 }) =>
    request('/api/relations', {
      method: 'POST',
      body: JSON.stringify({
        from_entity: fromEntity,
        to_entity: toEntity,
        relation_type: relationType,
        source_ref: sourceRef,
        evidence_span: evidenceSpan,
        confidence,
      }),
    }),

  // Knowledge Graph
  graph: (limit = 250) => request(`/api/graph?limit=${limit}`),

  // Quality & Flags
  flags: (limit = 200) => request(`/api/flags?limit=${limit}`),

  // Time-Travel / Historical State
  asOf: (asOfDate, entityId = '', limit = 100) => {
    const params = new URLSearchParams({ as_of: asOfDate, limit: String(limit) });
    if (entityId) params.set('entity_id', entityId);
    return request(`/api/history/as-of?${params}`);
  },

  // Issues & Commits
  searchIssues: (q, limit = 20) => request(`/api/issues/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  issueTimeline: (issueId) => request(`/api/issues/${encodeURIComponent(issueId)}/timeline`),
  issueLinks: (issueId) => request(`/api/issues/${encodeURIComponent(issueId)}/links`),
  sourceRecord: (sourceType, sourceId) =>
    request(`/api/source-records/${encodeURIComponent(sourceType)}/${encodeURIComponent(sourceId)}`),

  // AI Assistant (Grounded Ollama)
  ask: (question, maxEvidence = 5) =>
    request('/api/ask', {
      method: 'POST',
      body: JSON.stringify({ question, max_evidence: maxEvidence }),
    }),

  // Ingestion
  addRecord: (record) =>
    request('/api/records', {
      method: 'POST',
      body: JSON.stringify(record),
    }),
  addRecordBatch: (records) =>
    request('/api/records/batch', {
      method: 'POST',
      body: JSON.stringify({ records }),
    }),
  listRecords: (limit = 50, offset = 0) => request(`/api/records?limit=${limit}&offset=${offset}`),
};
