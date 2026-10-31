from __future__ import annotations
import csv
import math
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

TOKEN_RE = re.compile(r"[a-z0-9]+", re.I)
ISSUE_ID_RE = re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b", re.I)

class ChronoData:
    """Loads the cleaned project records and reconstructs a source-linked timeline."""
    def __init__(self, data_dir: Path, model_path: Path | None = None, feature_registry=None):
        self.data_dir = data_dir.resolve()
        self.feature_registry = feature_registry
        self.issues = self._read("issue.csv")
        self.commits = self._read("change_set.csv")
        self.links = self._read("change_set_link.csv")
        self.changes = self._read("code_change.csv")
        self.comments = self._read("issue_comment.csv")
        self.components = self._read("issue_component.csv")
        self.issue_by_id = {r["issue_id"]: r for r in self.issues}
        self.commit_by_hash = {r["commit_hash"]: r for r in self.commits}
        self.links_by_issue = defaultdict(list)
        self.issue_ids_by_commit = defaultdict(list)
        for row in self.links:
            iid, chash = row.get("issue_id", ""), row.get("commit_hash", "")
            if iid and chash:
                self.links_by_issue[iid].append(chash)
                self.issue_ids_by_commit[chash].append(iid)
        self.comments_by_issue = defaultdict(list)
        for row in self.comments:
            self.comments_by_issue[row.get("issue_id", "")].append(row)
        self.components_by_issue = defaultdict(set)
        for row in self.components:
            if row.get("issue_id") and row.get("component"):
                self.components_by_issue[row["issue_id"]].add(row["component"])
        self.changes_by_commit = defaultdict(list)
        for row in self.changes:
            self.changes_by_commit[row.get("commit_hash", "")].append(row)
        self.issue_tokens = [self._tokens(r.get("summary_clean", "") + " " + r.get("text", "")) for r in self.issues]
        self.doc_freq = Counter(t for doc in self.issue_tokens for t in set(doc))
        self.avg_len = sum(map(len, self.issue_tokens)) / max(1, len(self.issue_tokens))

    def _read(self, name: str):
        with (self.data_dir / name).open("r", encoding="utf-8-sig", newline="") as f:
            return list(csv.DictReader(f))

    @staticmethod
    def _tokens(text: str):
        return [x.lower() for x in TOKEN_RE.findall(str(text)) if len(x) > 1]

    @staticmethod
    def _date(value):
        if not value:
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat()
        except (ValueError, TypeError):
            return value

    @staticmethod
    def _date_key(value):
        return value or "9999-12-31"

    def _feature(self, issue_ids=(), paths=()):
        comps = sorted({c for iid in issue_ids for c in self.components_by_issue.get(iid, set())})
        if comps:
            return ", ".join(comps)
        # If the dataset has no explicit component, use the module/path as a
        # clearly inferential feature label.
        tops = sorted({str(p).replace("\\", "/").split("/")[0] for p in paths if p and "/" in str(p)})
        if tops:
            return ", ".join(tops[:3])
        summaries = [self.issue_by_id[i].get("summary_clean", "") for i in issue_ids if i in self.issue_by_id]
        return "; ".join(s for s in summaries if s) or "Unclassified feature"

    def _objective(self, issue_ids=(), fallback=""):
        summaries = []
        for iid in issue_ids:
            row = self.issue_by_id.get(iid)
            if row and row.get("summary_clean") and row["summary_clean"] not in summaries:
                summaries.append(row["summary_clean"])
        if summaries:
            return {"aim_objective":"Address: " + "; ".join(summaries[:3]),
                    "objective_basis":"inferred from linked issue summaries; verify against source records"}
        return {"aim_objective":fallback or "No explicit objective recorded in the linked data.",
                "objective_basis":"inferred from commit message and changed files" if fallback else "not recorded"}

    def _event(self, *, date, event_type, event, issue_ids=(), commit=None, comment=None, paths=()):
        issue_ids = list(dict.fromkeys(i for i in issue_ids if i in self.issue_by_id))
        info = self._objective(issue_ids, (commit or {}).get("message_clean", ""))
        components = {c for iid in issue_ids for c in self.components_by_issue.get(iid, set())}
        feature_basis = ("dataset_component" if components else
                         "changed_file_path" if paths else
                         "issue_summary" if issue_ids else "commit_message")
        feature_ids = [self.feature_registry.get_feature_id(c) for c in sorted(components)] if self.feature_registry else []
        result = {"date":self._date(date), "feature":self._feature(issue_ids, paths),
                  "feature_ids":[x for x in feature_ids if x], "feature_basis":feature_basis,
                  "event_type":event_type, "event":event, **info,
                  "objective_confidence":"inferred" if info["objective_basis"] != "not recorded" else "unknown",
                  "issue_ids":issue_ids}
        if commit:
            result["commit_hash"] = commit.get("commit_hash")
            result["author"] = commit.get("author", "")
            result["files_changed"] = paths[:20]
            changes = self.changes_by_commit.get(commit.get("commit_hash", ""), [])
            result["lines_added"] = sum(int(x.get("sum_added_lines") or 0) for x in changes)
            result["lines_removed"] = sum(int(x.get("sum_removed_lines") or 0) for x in changes)
            result["evidence"] = [{"type":"commit", "id":commit.get("commit_hash")}] + [
                {"type":"issue", "id":iid} for iid in issue_ids]
        elif comment:
            result["author"] = comment.get("display_name") or comment.get("username", "")
            result["evidence"] = [{"type":"issue_comment", "issue_id":comment.get("issue_id"),
                                   "author":result["author"], "text":comment.get("message_clean", "")[:800]}]
        else:
            result["evidence"] = [{"type":"issue", "id":iid} for iid in issue_ids]
        return result

    def search_issues(self, query: str, limit: int = 10):
        issue_ids = list(dict.fromkeys(re.findall(ISSUE_ID_RE, query.upper())))
        if issue_ids:
            return [{"issue_id": self.issue_by_id[key]["issue_id"],
                     "summary": self.issue_by_id[key].get("summary_clean", ""),
                     "status": self.issue_by_id[key].get("status", ""),
                     "created_at": self._date(self.issue_by_id[key].get("created_date")),
                     "resolved_at": self._date(self.issue_by_id[key].get("resolved_date")),
                     "score": 1.0}
                    for key in issue_ids if key in self.issue_by_id][:limit]
        q = self._tokens(query)
        if not q:
            return []
        n, results = len(self.issues), []
        for idx, issue in enumerate(self.issues):
            doc = self.issue_tokens[idx]
            counts = Counter(doc)
            score = 0.0
            for term in q:
                tf = counts[term]
                if tf:
                    idf = math.log(1 + (n - self.doc_freq[term] + 0.5) / (self.doc_freq[term] + 0.5))
                    score += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * len(doc) / max(1, self.avg_len)))
            if score > 0:
                results.append({"issue_id":issue.get("issue_id"), "summary":issue.get("summary_clean", ""),
                    "status":issue.get("status", ""), "created_at":self._date(issue.get("created_date")),
                    "resolved_at":self._date(issue.get("resolved_date")), "score":round(score, 4)})
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:limit]

    def timeline(self, issue_id: str):
        issue = self.issue_by_id[issue_id]
        events = [self._event(date=issue.get("created_date"), event_type="issue_reported",
                              event=issue.get("summary_clean", "Issue reported"), issue_ids=[issue_id])]
        for comment in self.comments_by_issue.get(issue_id, []):
            events.append(self._event(date=comment.get("created_date"), event_type="discussion",
                event=comment.get("message_clean", ""), issue_ids=[issue_id], comment=comment))
        for chash in self.links_by_issue.get(issue_id, []):
            commit = self.commit_by_hash.get(chash)
            if not commit:
                continue
            changes = self.changes_by_commit.get(chash, [])
            paths = sorted({x.get("file_path", "") for x in changes if x.get("file_path")})
            events.append(self._event(date=commit.get("committed_date"), event_type="code_change",
                event=commit.get("message_clean", ""), issue_ids=[issue_id], commit=commit, paths=paths))
        if issue.get("resolved_date"):
            events.append(self._event(date=issue.get("resolved_date"), event_type="issue_resolved",
                event=issue.get("resolution") or "Issue marked resolved", issue_ids=[issue_id]))
        events.sort(key=lambda x: self._date_key(x.get("date")))
        return {"issue":{"issue_id":issue_id, "summary":issue.get("summary_clean", ""),
                          "status":issue.get("status", ""),
                          "created_at":self._date(issue.get("created_date")),
                          "resolved_at":self._date(issue.get("resolved_date"))}, "events":events}

    def project_timeline(self, start_date=None, end_date=None, limit=500, offset=0):
        events = []
        for issue in self.issues:
            iid = issue.get("issue_id")
            if issue.get("created_date"):
                events.append(self._event(date=issue["created_date"], event_type="issue_reported",
                    event=issue.get("summary_clean", "Issue reported"), issue_ids=[iid]))
            if issue.get("resolved_date"):
                events.append(self._event(date=issue["resolved_date"], event_type="issue_resolved",
                    event=issue.get("resolution") or "Issue marked resolved", issue_ids=[iid]))
        for comment in self.comments:
            if comment.get("created_date"):
                iid = comment.get("issue_id")
                events.append(self._event(date=comment["created_date"], event_type="discussion",
                    event=comment.get("message_clean", ""), issue_ids=[iid], comment=comment))
        for commit in self.commits:
            date = commit.get("committed_date")
            if not date:
                continue
            chash = commit.get("commit_hash", "")
            changes = self.changes_by_commit.get(chash, [])
            paths = sorted({x.get("file_path", "") for x in changes if x.get("file_path")})
            issue_ids = self.issue_ids_by_commit.get(chash, [])
            events.append(self._event(date=date, event_type="code_change",
                event=commit.get("message_clean", "Commit recorded"), issue_ids=issue_ids,
                commit=commit, paths=paths))
        if self.feature_registry:
            seen_record_ids = set()
            for record in self.feature_registry.list_records(limit=100000, offset=0)["items"]:
                if record["record_id"] in seen_record_ids:
                    continue
                seen_record_ids.add(record["record_id"])
                if not record.get("occurred_at"):
                    continue
                related_ids = [record["source_id"]] if record.get("source_type") == "issue" else []
                events.append({"date":self._date(record["occurred_at"]), "feature":record["feature"],
                    "feature_id":record["feature_id"], "feature_ids":[record["feature_id"]],
                    "feature_basis":"persistent_feature_registry", "event_type":"new_record_added",
                    "event":record["summary"], "aim_objective":"Address: " + record["summary"],
                    "objective_basis":"inferred from inserted record summary", "objective_confidence":"inferred",
                    "issue_ids":related_ids, "record_id":record["record_id"],
                    "source_type":record["source_type"], "source_id":record["source_id"],
                    "evidence":[{"type":"inserted_record", "record_id":record["record_id"]},
                                {"type":"feature", "id":record["feature_id"]}]})
        start = str(start_date) if start_date else None
        end = str(end_date) if end_date else None
        events = [e for e in events if e.get("date") and
                  (not start or e["date"][:10] >= start[:10]) and
                  (not end or e["date"][:10] <= end[:10])]
        events.sort(key=lambda x: self._date_key(x.get("date")))
        total = len(events)
        return {"start_date":start, "end_date":end, "total_events":total,
                "events":events[offset:offset + limit], "limit":limit, "offset":offset,
                "objective_note":"Objectives are inferred from issue summaries or commit messages; they are not explicit project-goal records."}

    def search_history(self, query: str, limit: int = 20, offset: int = 0,
                       start_date=None, end_date=None):
        """Retrieve dated source events by text or exact issue key."""
        issue_ids = set(re.findall(ISSUE_ID_RE, query.upper()))
        terms = [t for t in self._tokens(query) if t not in {
            "what", "when", "where", "who", "why", "how", "did", "does", "was", "were",
            "the", "a", "an", "is", "are", "for", "to", "of", "in", "on", "about",
            "and", "or", "with", "from", "it", "this", "that", "changed", "happen", "happened"
        }]
        if not issue_ids and not terms:
            return {"query":query, "total_events":0, "events":[], "limit":limit, "offset":offset}
        timeline = self.project_timeline(start_date, end_date, limit=100000, offset=0)["events"]
        if issue_ids:
            candidates = [e for e in timeline if issue_ids.intersection(e.get("issue_ids", []))]
        else:
            candidates = timeline
        docs = [self._tokens(" ".join([str(e.get("feature", "")), str(e.get("event", "")),
                   str(e.get("aim_objective", "")), str(e.get("author", ""))])) for e in candidates]
        df = Counter(t for doc in docs for t in set(doc))
        scored = []
        for event, doc in zip(candidates, docs):
            counts = Counter(doc)
            score = sum(math.log(1 + len(candidates) / (df[t] + 1)) * min(counts[t], 3)
                        for t in set(terms) if counts[t])
            if issue_ids:
                score += 100.0
            if score > 0:
                item = dict(event)
                item["relevance_score"] = round(score, 4)
                scored.append(item)
        scored.sort(key=lambda e: (-e["relevance_score"], self._date_key(e.get("date"))))
        total = len(scored)
        return {"query":query, "total_events":total,
                "events":scored[offset:offset + limit], "limit":limit, "offset":offset,
                "date_filter":{"start_date":str(start_date) if start_date else None,
                               "end_date":str(end_date) if end_date else None}}
    def evidence(self, query: str, limit: int = 8):
        matches = self.search_issues(query, limit)
        explicit_ids = set(re.findall(ISSUE_ID_RE, query.upper()))
        ids = {x["issue_id"] for x in matches}
        linked = [c for c in self.links if c.get("issue_id") in ids and c.get("commit_hash") in self.commit_by_hash]
        linked.sort(key=lambda x: self.commit_by_hash[x["commit_hash"]].get("committed_date", ""))
        result = []
        for match in matches:
            issue_evidence = dict(match)
            issue_evidence.pop("score", None)
            if issue_evidence["issue_id"] in explicit_ids:
                record = self.issue_by_id[issue_evidence["issue_id"]]
                description = record.get("description_clean", "")[:3000]
                discussion = record.get("comments_clean", "")[:3000]
                if description:
                    issue_evidence["description"] = description
                if discussion:
                    issue_evidence["discussion"] = discussion
            result.append({"kind":"issue", **issue_evidence})
        for link in linked[-20:]:
            c = self.commit_by_hash[link["commit_hash"]]
            result.append({"kind":"commit", "issue_id":link["issue_id"], "commit_hash":c["commit_hash"],
                "date":self._date(c.get("committed_date")), "author":c.get("author", ""),
                "message":c.get("message_clean", "")})
        history = self.search_history(query, limit=8)
        result.extend({"kind":"history_event", **e} for e in history["events"][:8])
        return result

csv.field_size_limit(10_000_000)
