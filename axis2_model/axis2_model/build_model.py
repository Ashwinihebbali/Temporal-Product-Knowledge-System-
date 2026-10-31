"""
Issue-to-commit traceability link recovery on the cleaned Axis2 data.

Usage:  python build_model.py  [path_to_axis2_cleaned_folder]

Steps
 1. Load cleaned tables
 2. Time-based split of the ground-truth links (train / test)
 3. Build text representations (TF-IDF fitted on TRAIN only)
 4. Build training pairs (positives + random + hard negatives)
 5. Pair features
 6. Baseline (cosine only) and gradient-boosting model
 7. Rank-based evaluation on the test period (with and without the issue-ID feature)
 8. Save model + results
"""
import sys, re, json, os
import numpy as np, pandas as pd
from scipy import sparse
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.ensemble import HistGradientBoostingClassifier
import joblib

D = sys.argv[1] if len(sys.argv) > 1 else "axis2_cleaned"
OUT = "model_output"; os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(42)
TRAIN_FRAC = 0.70
N_RANDOM_NEG, N_HARD_NEG = 5, 5

# ------------------------------------------------------------------ 1. load
issue = pd.read_csv(f"{D}/issue.csv", usecols=["issue_id", "created_date", "resolved_date", "text", "assignee", "reporter"])
cs = pd.read_csv(f"{D}/change_set.csv", usecols=["commit_hash", "committed_date", "message_clean", "author"])
links = pd.read_csv(f"{D}/change_set_link.csv")
cc = pd.read_csv(f"{D}/code_change.csv", usecols=["commit_hash", "file_name", "file_ext", "is_binary", "sum_added_lines", "sum_removed_lines"])

for df, cols in [(issue, ["created_date", "resolved_date"]), (cs, ["committed_date"])]:
    for c in cols:
        df[c] = pd.to_datetime(df[c], utc=True, errors="coerce").dt.tz_convert(None)
issue["text"] = issue.text.fillna(""); cs["message_clean"] = cs.message_clean.fillna("")
issue = issue.reset_index(drop=True); cs = cs.reset_index(drop=True)
iidx = {k: i for i, k in enumerate(issue.issue_id)}
cidx = {k: i for i, k in enumerate(cs.commit_hash)}
links = links[links.issue_id.isin(iidx) & links.commit_hash.isin(cidx)].copy()
links["i"] = links.issue_id.map(iidx); links["c"] = links.commit_hash.map(cidx)
links["cdate"] = cs.committed_date.iloc[links.c.values].values
links = links.sort_values("cdate").reset_index(drop=True)

# ------------------------------------------------------------------ 2. time split
split_date = pd.Timestamp(links.cdate.iloc[int(len(links) * TRAIN_FRAC)])
train_links = links[links.cdate < split_date]
test_links = links[links.cdate >= split_date]
train_commits = np.where(cs.committed_date < split_date)[0]
test_commits = np.where(cs.committed_date >= split_date)[0]
print(f"split date {split_date.date()} | train links {len(train_links)}, test links {len(test_links)} "
      f"| train commits {len(train_commits)}, test commits {len(test_commits)}")
true_pairs = set(zip(links.i, links.c))

# ------------------------------------------------------------------ 3. text representations
def split_camel(t):
    t = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", str(t))
    return re.sub(r"[^A-Za-z]+", " ", t).lower()

issue_tok = issue.text.map(split_camel)
msg_tok = cs.message_clean.map(split_camel)
# file-name tokens per commit
cc = cc[cc.is_binary == 0]
cc["tok"] = cc.file_name.map(lambda s: split_camel(os.path.splitext(str(s))[0]))
file_tok = cc.groupby("commit_hash").tok.apply(" ".join)
cs_file_tok = cs.commit_hash.map(file_tok).fillna("")
cc_stats = cc.groupby("commit_hash").agg(n_files=("file_name", "size"),
                                         n_java=("file_ext", lambda s: (s == "java").sum()),
                                         lines=("sum_added_lines", "sum"))
cc_stats["lines"] += cc.groupby("commit_hash").sum_removed_lines.sum()
cs_n_files = cs.commit_hash.map(cc_stats.n_files).fillna(0).values
cs_n_java = cs.commit_hash.map(cc_stats.n_java).fillna(0).values
cs_lines = cs.commit_hash.map(cc_stats.lines).fillna(0).values

# fit vectorizers on training-period text only (no leakage)
train_issue_ids = np.unique(train_links.i)
vec_text = TfidfVectorizer(stop_words="english", sublinear_tf=True, min_df=2, token_pattern=r"[a-z]{2,}")
vec_text.fit(pd.concat([issue_tok.iloc[train_issue_ids], msg_tok.iloc[train_commits]]))
vec_file = TfidfVectorizer(sublinear_tf=True, token_pattern=r"[a-z]{2,}")
vec_file.fit(cs_file_tok.iloc[train_commits])
XI = vec_text.transform(issue_tok); XM = vec_text.transform(msg_tok)
XIf = vec_file.transform(issue_tok); XF = vec_file.transform(cs_file_tok)

# explicit issue-ID mentions in commit messages
M = sparse.lil_matrix((len(cs), len(issue)), dtype=np.int8)
for c, msg in enumerate(cs.message_clean):
    for n in re.findall(r"axis2[-\s]?(\d+)", msg, flags=re.I):
        j = iidx.get(f"AXIS2-{n}")
        if j is not None:
            M[c, j] = 1
M = M.tocsr()

author = cs.author.fillna("").str.lower().values
assignee = issue.assignee.fillna("").str.lower().values
reporter = issue.reporter.fillna("").str.lower().values
cdate = cs.committed_date.values.astype("datetime64[s]").astype("int64") / 86400.0
created = issue.created_date.values.astype("datetime64[s]").astype("int64") / 86400.0
resolved = issue.resolved_date.values.astype("datetime64[s]").astype("int64") / 86400.0
resolved = np.where(issue.resolved_date.isna().values, np.nan, resolved)
created = np.where(issue.created_date.isna().values, np.nan, created)

# ------------------------------------------------------------------ 5. pair features
FEATS = ["cos_text", "cos_files", "days_after_created", "days_after_resolved", "in_window",
         "id_in_message", "author_is_assignee", "author_is_reporter", "n_files", "n_java", "log_lines"]
NO_ID = [f for f in FEATS if f != "id_in_message"]

def rowwise_cos(A, B, ai, bi):
    return np.asarray(A[ai].multiply(B[bi]).sum(axis=1)).ravel()

def features(i, c):
    i = np.asarray(i); c = np.asarray(c)
    f = pd.DataFrame({
        "cos_text": rowwise_cos(XI, XM, i, c),
        "cos_files": rowwise_cos(XIf, XF, i, c),
        "days_after_created": np.clip(cdate[c] - created[i], -3650, 3650),
        "days_after_resolved": np.clip(cdate[c] - resolved[i], -3650, 3650),
        "id_in_message": np.asarray(M[c, i]).ravel(),
        "author_is_assignee": ((author[c] == assignee[i]) & (assignee[i] != "")).astype(int),
        "author_is_reporter": ((author[c] == reporter[i]) & (reporter[i] != "")).astype(int),
        "n_files": cs_n_files[c], "n_java": cs_n_java[c], "log_lines": np.log1p(cs_lines[c]),
    })
    f["in_window"] = ((cdate[c] >= created[i]) & ((cdate[c] <= resolved[i] + 30) | np.isnan(resolved[i]))).astype(int)
    return f[FEATS]

# ------------------------------------------------------------------ 4. training pairs
tc_dates = cdate[train_commits]
pi, pc, py = [], [], []
for i, c in zip(train_links.i, train_links.c):
    pi.append(i); pc.append(c); py.append(1)
    rnd = rng.choice(train_commits, N_RANDOM_NEG * 3)
    rnd = [x for x in rnd if (i, x) not in true_pairs][:N_RANDOM_NEG]
    lo, hi = created[i], (resolved[i] if not np.isnan(resolved[i]) else created[i] + 365) + 30
    pool = train_commits[(tc_dates >= lo) & (tc_dates <= hi)]
    hard = [x for x in rng.choice(pool, min(len(pool), N_HARD_NEG * 3), replace=False)
            if (i, x) not in true_pairs][:N_HARD_NEG] if len(pool) else []
    for x in list(rnd) + hard:
        pi.append(i); pc.append(x); py.append(0)
Xtr = features(pi, pc); ytr = np.array(py)
print(f"training pairs: {len(ytr)} ({ytr.sum()} positive)")

# ------------------------------------------------------------------ 6. models
def fit(cols):
    m = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_depth=6,
                                       early_stopping=True, validation_fraction=0.15,
                                       random_state=42)
    return m.fit(Xtr[cols], ytr)

model_full = fit(FEATS)
model_noid = fit(NO_ID)

# ------------------------------------------------------------------ 7. evaluation
def evaluate(score_fn, name):
    """Each test issue ranks ALL test-period commits. Metrics over issues with >=1 true link."""
    rr, hits = [], {1: [], 5: [], 10: []}
    for i, grp in test_links.groupby("i"):
        cands = test_commits
        s = score_fn(np.full(len(cands), i), cands)
        order = np.argsort(-s, kind="stable")
        ranked = cands[order]
        truth = set(grp.c)
        pos = [k for k, c in enumerate(ranked, 1) if c in truth]
        rr.append(1 / pos[0] if pos else 0)
        for k in hits:
            hits[k].append(len(truth & set(ranked[:k])) / len(truth))
    res = {"model": name, "n_test_issues": len(rr), "MRR": round(float(np.mean(rr)), 4)}
    res.update({f"Recall@{k}": round(float(np.mean(v)), 4) for k, v in hits.items()})
    print(res); return res

results = [
    evaluate(lambda i, c: rowwise_cos(XI, XM, i, c), "baseline: TF-IDF cosine"),
    evaluate(lambda i, c: model_full.predict_proba(features(i, c)[FEATS])[:, 1], "GBM (all features)"),
    evaluate(lambda i, c: model_noid.predict_proba(features(i, c)[NO_ID])[:, 1], "GBM (no issue-ID feature)"),
]

# ------------------------------------------------------------------ 8. save
joblib.dump({"model_full": model_full, "model_noid": model_noid, "vec_text": vec_text,
             "vec_file": vec_file, "features": FEATS, "features_no_id": NO_ID}, f"{OUT}/link_model.joblib")
pd.DataFrame(results).to_csv(f"{OUT}/results.csv", index=False)
json.dump({"split_date": str(split_date), "train_pairs": int(len(ytr)), "results": results},
          open(f"{OUT}/results.json", "w"), indent=2)
print("saved to", OUT)
