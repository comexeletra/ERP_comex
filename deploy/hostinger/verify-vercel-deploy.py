#!/usr/bin/env python3
"""Report the recent Production deployments without exposing the Vercel token."""

import json
from pathlib import Path
import sys
from urllib.parse import urlencode
from urllib.request import Request, urlopen

TEAM_ID = "team_MNM8RhqAU7Hi9G8a1TlqPcXK"
PROJECT_ID = "prj_4C9BvILWxyhUiXT6aLc5DxRUJRK9"
TOKEN_FILE = Path("/root/.config/import-erp/vercel-token")

expected_commit = sys.argv[1] if len(sys.argv) > 1 else ""
query = urlencode({"teamId": TEAM_ID, "projectId": PROJECT_ID, "target": "production", "limit": 10})
request = Request(
    f"https://api.vercel.com/v6/deployments?{query}",
    headers={"Authorization": f"Bearer {TOKEN_FILE.read_text().strip()}"},
)
with urlopen(request, timeout=15) as response:
    deployments = json.load(response).get("deployments", [])

matched = False
matched_id = None
for deployment in deployments:
    meta = deployment.get("meta") or {}
    sha = meta.get("githubCommitSha") or meta.get("gitCommitSha") or ""
    state = deployment.get("readyState") or deployment.get("state")
    print(json.dumps({
        "id": deployment.get("uid") or deployment.get("id"),
        "url": deployment.get("url"),
        "state": state,
        "commit": sha[:12],
        "aliases": deployment.get("alias") or [],
    }))
    if expected_commit and sha.startswith(expected_commit) and state == "READY":
        matched = True
        matched_id = deployment.get("uid") or deployment.get("id")

if expected_commit and not matched:
    raise SystemExit(f"No READY Production deployment found for {expected_commit}")
if matched_id:
    detail_request = Request(
        f"https://api.vercel.com/v13/deployments/{matched_id}?{urlencode({'teamId': TEAM_ID})}",
        headers={"Authorization": f"Bearer {TOKEN_FILE.read_text().strip()}"},
    )
    with urlopen(detail_request, timeout=15) as response:
        detail = json.load(response)
    print(json.dumps({"matchedDeployment": matched_id, "aliases": detail.get("alias") or []}))
