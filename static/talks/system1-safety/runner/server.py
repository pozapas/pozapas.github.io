"""Local live runner for the lecture deck.

Serves one endpoint on 127.0.0.1:8791 that the deck calls during the labs:

    POST /run   {"model": "laya" | "jev", "state": "...", "questions": [
                   {"id": "fall_hazard", "type": "noul", "instructions": "..."},
                   {"id": "severity", "type": "choice", "instructions": "...",
                    "criteria": {"none": "...", "minor": "...", "serious": "..."}}]}
    GET  /health

The TypeSafe key is read from the TYPESAFE_API_KEY environment variable (or a
.env file two folders up) and never leaves this process. Laya needs no key.
Run from an environment with the packages installed:

    pip install laya==0.4.2 typesafe-sdk
    python runner/server.py
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent  # the Jev project folder
PORT = 8791
JEV_MODEL = "jev-1.13.0"
ALLOWED_ORIGINS = {"http://127.0.0.1:8790", "http://localhost:8790", "null"}


def load_env() -> None:
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env()

# ---------- Laya ----------

_laya = {"router": None, "error": None}
_laya_lock = threading.Lock()


def laya_router():
    with _laya_lock:
        if _laya["router"] is None and _laya["error"] is None:
            try:
                from laya import Router
                _laya["router"] = Router(preload=True)
            except Exception as e:  # pragma: no cover - reported to the deck
                _laya["error"] = repr(e)
        return _laya["router"]


def laya_questions(qs: list[dict]) -> dict:
    out = {}
    for q in qs:
        item = {"type": q["type"], "instructions": q["instructions"]}
        if q.get("criteria"):
            item["criteria"] = q["criteria"]
        out[q["id"]] = item
    return out


def run_laya(state: str, qs: list[dict]) -> dict:
    router = laya_router()
    if router is None:
        raise RuntimeError("Laya is not available: " + str(_laya["error"]))
    t0 = time.perf_counter()
    res = router.predict(state, laya_questions(qs))
    ms = (time.perf_counter() - t0) * 1000
    answers = res.get("answers", {}) if isinstance(res, dict) else getattr(res, "answers", {})
    routing = res.get("routing", {}) if isinstance(res, dict) else {}
    return {"model": "laya" + (" · " + str(routing.get("model")) if routing.get("model") else ""),
            "latency_ms": round(ms), "answers": {k: normalize(v) for k, v in answers.items()}}


# ---------- Jev ----------

def run_jev(state: str, qs: list[dict]) -> dict:
    from typesafe_sdk import TypeSafeClient, Choice, Noul, Score
    if not os.environ.get("TYPESAFE_API_KEY"):
        raise RuntimeError("TYPESAFE_API_KEY is not set in the project .env")
    built = {}
    for q in qs:
        if q["type"] == "noul":
            built[q["id"]] = Noul(instructions=q["instructions"])
        elif q["type"] == "choice":
            built[q["id"]] = Choice(instructions=q["instructions"], criteria=q["criteria"])
        else:
            built[q["id"]] = Score(instructions=q["instructions"], criteria=q["criteria"])
    client = TypeSafeClient()
    t0 = time.perf_counter()
    resp = client.system_one(state=state, questions=built, model=JEV_MODEL)
    ms = (time.perf_counter() - t0) * 1000
    answers = {}
    for k, a in (getattr(resp, "answers", None) or {}).items():
        answers[k] = normalize({x: getattr(a, x) for x in
                                ("noul", "choice", "probabilities", "confidence", "score") if hasattr(a, x)})
    return {"model": getattr(resp, "model", JEV_MODEL), "latency_ms": round(ms), "answers": answers}


def normalize(a) -> dict:
    """Reduce an answer to {"p_yes": float} for noul or {"probs": {option: p}} for choice."""
    if hasattr(a, "__dict__") and not isinstance(a, dict):
        a = {k: v for k, v in vars(a).items() if not k.startswith("_")}
    if not isinstance(a, dict):
        try:
            return {"p_yes": float(a)}
        except Exception:
            return {"raw": str(a)}
    if "noul" in a and a["noul"] is not None:
        v = a["noul"]
        if isinstance(v, dict):
            v = v.get("true", v.get("yes", next(iter(v.values()))))
        return {"p_yes": float(v), "confidence": a.get("confidence")}
    probs = a.get("probabilities") or (a.get("choice") if isinstance(a.get("choice"), dict) else None)
    if isinstance(probs, dict):
        return {"probs": {str(k): float(v) for k, v in probs.items()}, "choice": a.get("choice") if not isinstance(a.get("choice"), dict) else None,
                "confidence": a.get("confidence")}
    return {k: (v if isinstance(v, (int, float, str, type(None))) else str(v)) for k, v in a.items()}


# ---------- HTTP ----------

class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code: int, body: dict):
        data = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True, "laya_loaded": _laya["router"] is not None,
                             "laya_error": _laya["error"], "jev_key": bool(os.environ.get("TYPESAFE_API_KEY"))})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/run":
            return self._json(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(n) or b"{}")
            state = str(req.get("state", ""))[:4000]
            qs = [q for q in req.get("questions", []) if q.get("instructions")][:8]
            if not state or not qs:
                return self._json(400, {"error": "state and at least one question are required"})
            model = req.get("model", "laya")
            out = run_jev(state, qs) if model == "jev" else run_laya(state, qs)
            self._json(200, out)
        except Exception as e:
            self._json(500, {"error": f"{type(e).__name__}: {e}"})

    def log_message(self, fmt, *args):
        sys.stderr.write("[runner] " + (fmt % args) + "\n")


if __name__ == "__main__":
    print(f"[runner] loading Laya checkpoints (first run downloads them)...", flush=True)
    threading.Thread(target=laya_router, daemon=True).start()
    print(f"[runner] listening on http://127.0.0.1:{PORT}  (Ctrl+C to stop)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
