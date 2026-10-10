"""Read remote first-party source into memory. Never clone or save upstream source/data.
Only an audit manifest (path, digest, line count, identifiers, URLs) is persisted.
"""

import concurrent.futures as cf
import hashlib, json, re, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HEADERS = {"User-Agent": "Atlas-ReadOnly-Source-Review/1.0", "Accept": "application/json"}


def read(url):
    for n in range(2):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=20) as r:
                return r.read(2_000_000)
        except Exception:
            if n:
                raise
            time.sleep(0.5)


def scan():
    commit = json.loads(read("https://api.github.com/repos/simplifaisoul/osiris/commits/master"))["sha"]
    hf = json.loads(read("https://huggingface.co/api/spaces/teaphile/terrawatch"))["sha"]
    repos = [
        (
            "TerraWatch",
            hf,
            f"https://huggingface.co/spaces/teaphile/terrawatch/raw/{hf}/",
            json.loads(
                read(
                    f"https://huggingface.co/api/spaces/teaphile/terrawatch/tree/{hf}?recursive=true&limit=1000"
                )
            ),
        ),
        (
            "OSIRIS",
            commit,
            f"https://raw.githubusercontent.com/simplifaisoul/osiris/{commit}/",
            json.loads(
                read(f"https://api.github.com/repos/simplifaisoul/osiris/git/trees/{commit}?recursive=1")
            )["tree"],
        ),
    ]
    result = []
    for name, revision, base, tree in repos:
        blobs = [x for x in tree if x["type"] in ("blob", "file")]
        candidates = [
            x
            for x in blobs
            if not any(
                s in x["path"]
                for s in (
                    "node_modules/",
                    "__pycache__/",
                    "public/",
                    "screenshots/",
                    "data/static/",
                    "ml/data/",
                    "saved_models/",
                    "package-lock",
                    "generated.ts",
                )
            )
            and (
                x["path"].endswith(
                    (
                        ".py",
                        ".ts",
                        ".tsx",
                        ".js",
                        ".mjs",
                        ".cjs",
                        ".json",
                        ".yml",
                        ".yaml",
                        ".md",
                        ".css",
                        ".conf",
                        ".txt",
                        ".toml",
                        ".sh",
                    )
                )
                or x["path"].endswith(("Dockerfile", "LICENSE", ".env.example", ".env.template"))
            )
        ]

        def one(x):
            p = x["path"]
            row = {"path": p, "bytes": x.get("size", 0), "object": x.get("sha", x.get("oid"))}
            try:
                body = read(base + p)
                s = body.decode("utf-8")
                row.update(
                    status="read_in_memory",
                    lines=len(s.splitlines()),
                    sha256=hashlib.sha256(body).hexdigest(),
                )
                row["domains"] = sorted(set(re.findall(r"https?://([a-zA-Z0-9.-]+)", s)))
                row["symbols"] = re.findall(
                    r"(?:export\s+)?(?:async\s+)?(?:def|function|class)\s+([A-Za-z_][\w]*)", s
                )[:50]
                patterns = {
                    "fallback": r"fallback|estimated|synthetic",
                    "random": r"Math\.random|random\.(?:random|uniform|randint)",
                    "fetch": r"\bfetch\(|client\.(?:get|post)\(",
                    "auth": r"authorization|API_KEY|API_SECRET|timingSafeEqual",
                    "test": r"\bit\(|\btest\(|def test_|def test\b",
                    "unsafe_render": r"dangerouslySetInnerHTML|innerHTML",
                    "validation": r"validation_status|unvalidated|calibrat|probability",
                    "todo": r"TODO|FIXME|NotImplemented",
                }
                row["indicators"] = {
                    k: [i for i, l in enumerate(s.splitlines(), 1) if re.search(v, l, re.I)][:70]
                    for k, v in patterns.items()
                }
            except Exception as e:
                row.update(status="error", error=type(e).__name__)
            return row

        with cf.ThreadPoolExecutor(6) as pool:
            rows = list(pool.map(one, candidates))
        entry = {
            "repository": name,
            "revision": revision,
            "base": base,
            "tree_files": len(blobs),
            "selected_text_files": len(rows),
            "read_files": sum(x["status"] == "read_in_memory" for x in rows),
            "skipped": "Vendor dependencies, binaries, bundled public assets, generated camera catalogs, static datasets, lockfiles, saved models. No upstream execution.",
            "files": rows,
        }
        result.append(entry)
        print(
            name,
            revision,
            "inventory",
            len(blobs),
            "read",
            entry["read_files"],
            "/",
            len(rows),
            "lines",
            sum(x.get("lines", 0) for x in rows),
            flush=True,
        )
    (ROOT / "docs" / "audit-manifest-rerun.json").write_text(json.dumps(result, indent=2))
    for r in result:
        errors = [x for x in r["files"] if x["status"] == "error"]
        print(r["repository"], "ERRORS", errors, flush=True)


if __name__ == "__main__":
    scan()
