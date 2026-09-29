#!/usr/bin/env python3
"""Read Vercel project metadata without printing tokens or env values."""

import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

TEAM_ID = "team_MNM8RhqAU7Hi9G8a1TlqPcXK"
TOKEN_FILE = Path("/root/.config/import-erp/vercel-token")


def get(path, **params):
    query = urlencode({"teamId": TEAM_ID, **params})
    request = Request(
        f"https://api.vercel.com{path}?{query}",
        headers={"Authorization": f"Bearer {TOKEN_FILE.read_text().strip()}"},
    )
    try:
        with urlopen(request, timeout=15) as response:
            return json.load(response)
    except HTTPError as error:
        print(f"Vercel API {path}: HTTP {error.code}")
        raise SystemExit(1)


projects = get("/v9/projects", limit=100).get("projects", [])
for project in projects:
    domains = project.get("alias", []) or project.get("domains", []) or []
    link = project.get("link") or {}
    print(
        json.dumps(
            {
                "name": project.get("name"),
                "id": project.get("id"),
                "domains": domains,
                "rootDirectory": project.get("rootDirectory"),
                "framework": project.get("framework"),
                "repo": link.get("repo"),
                "org": link.get("org"),
                "productionBranch": link.get("productionBranch"),
            },
            ensure_ascii=False,
        )
    )
