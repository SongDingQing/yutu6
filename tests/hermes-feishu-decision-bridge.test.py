#!/usr/bin/env python3
"""Hermes 飞书决策桥回归：token 留本机、只访问 localhost、回调可执行。"""

from __future__ import annotations

import hashlib
import hmac
import importlib.util
import json
import os
import tempfile
import urllib.parse
from pathlib import Path
from unittest.mock import patch


PLUGIN = Path.home() / ".hermes/plugins/codex-handoff/__init__.py"


class FakeResponse:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit=-1):
        return "<html><head><title>已批准</title></head></html>".encode()


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="yutu6-decision-bridge-") as root:
        artifacts = Path(root)
        bulletin = artifacts / "bulletin"
        bulletin.mkdir(parents=True)
        card_id = "board-decision-native-test"
        secret = "fixture-local-secret"
        (bulletin / "cards.json").write_text(
            json.dumps([{"id": card_id, "decisionSecret": secret}]),
            encoding="utf-8",
        )
        os.environ["YUTU6_CONSOLE_ARTIFACTS_DIR"] = str(artifacts)
        os.environ["YUTU6_CONSOLE_API_BASE"] = "http://127.0.0.1:41218"
        spec = importlib.util.spec_from_file_location("codex_handoff_test", PLUGIN)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        captured = {}

        def fake_urlopen(request, timeout=0):
            captured["url"] = request.full_url
            captured["timeout"] = timeout
            return FakeResponse()

        with patch.object(module.urllib.request, "urlopen", side_effect=fake_urlopen):
            result = module._execute_yutu6_decision(card_id, "approve")

        assert result == {"ok": True, "status": 200, "title": "已批准"}
        parsed = urllib.parse.urlparse(captured["url"])
        assert parsed.hostname == "127.0.0.1"
        assert parsed.port == 41218
        token = urllib.parse.parse_qs(parsed.query)["t"][0]
        expected = hmac.new(
            secret.encode(),
            f"{card_id}:approve".encode(),
            hashlib.sha256,
        ).hexdigest()
        assert token == expected
        assert secret not in captured["url"]
        assert module._parse_card_action(
            f'/card button {{"yutu6_decision_action":"approve","card_id":"{card_id}"}}'
        )
        print(json.dumps({"pass": True, "suite": "hermes-feishu-decision-bridge"}))


if __name__ == "__main__":
    main()
