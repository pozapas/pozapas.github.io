from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
APP_DIR = Path(__file__).resolve().parents[1]
DATASET_DIR = APP_DIR / "datasets"
RECORDS_DIR = DATASET_DIR / "records"
CARDS_DIR = DATASET_DIR / "cards"

sys.path.insert(0, str(ROOT))
from extract_causal_graph import NARRATIVE_FACTORS, normalize_ws, public_safe_text, time_period  # noqa: E402


MISSING = {
    "",
    "nan",
    "none",
    "null",
    "<na>",
    "not applicable",
    "unknown",
    "data not available at data entry",
    "not listed",
}

CATEGORY_LABELS = {
    "human_behavior": "Human Behavior",
    "rider_behavior": "Rider Behavior",
    "pedestrian_behavior": "Pedestrian Behavior",
    "driver_behavior": "Driver Behavior",
    "infrastructure": "Infrastructure",
    "environment": "Environment",
    "vehicle_context": "Vehicle / Device",
    "vehicle_factors": "Vehicle / Equipment",
    "post_crash": "Post-crash",
    "outcome": "Outcome / Severity",
    "evidence_source": "Evidence Source",
}

CATEGORY_NORMALIZE = {
    "rider_behavior": "human_behavior",
    "vehicle_factors": "vehicle_context",
}

OUTCOME_FACTORS = {
    "fatal_injury": ("Fatal injury", "outcome"),
    "serious_injury": ("Serious injury", "outcome"),
    "non_incapacitating_injury": ("Non-incapacitating injury", "outcome"),
    "possible_injury": ("Possible injury", "outcome"),
    "not_injured": ("Not injured", "outcome"),
    "injury_recorded": ("Injury recorded", "outcome"),
}

STRUCTURED_RULES = [
    ("failed_to_yield", "Failed to yield", "driver_behavior", r"yield|right of way"),
    ("failed_to_stop", "Failed to stop", "driver_behavior", r"failed to stop|disregard"),
    ("speeding", "Speeding", "driver_behavior", r"speed"),
    ("distraction", "Distraction or inattention", "driver_behavior", r"inattention|attention diverted|distraction"),
    ("wrong_way", "Wrong-way movement", "human_behavior", r"wrong side|wrong way"),
    ("impaired", "Impaired driving", "driver_behavior", r"alcohol|drug|intox"),
    ("backing_vehicle", "Backing vehicle", "driver_behavior", r"backing"),
    ("turning_vehicle", "Turning vehicle", "driver_behavior", r"turning|turn"),
    ("pedestrian_in_roadway", "Pedestrian in roadway", "pedestrian_behavior", r"pedestrian|walk|cross"),
]

CONTEXT_RULES = [
    ("intersection", "Intersection context", "infrastructure", "intersection_relation", r"intersection"),
    ("traffic_signal", "Traffic signal", "infrastructure", "traffic_control", r"signal"),
    ("stop_sign", "Stop sign", "infrastructure", "traffic_control", r"stop sign"),
    ("marked_lanes", "Marked lanes", "infrastructure", "traffic_control", r"marked lanes"),
    ("driveway", "Driveway access context", "infrastructure", "other_factor", r"driveway"),
    ("roadway_context", "On-roadway context", "infrastructure", "road_part", r"roadway|main|lane"),
    ("dark_lighting", "Dark lighting", "environment", "lighting", r"dark|dawn|dusk"),
    ("wet_or_adverse_weather", "Wet or adverse weather", "environment", "weather_surface", r"rain|wet|fog|snow|ice|sleet"),
]

NARRATIVE_SPECS = [
    {
        **spec,
        "category": CATEGORY_NORMALIZE.get(spec.get("category"), spec.get("category")),
        "compiled": re.compile(spec["pattern"], re.IGNORECASE),
    }
    for spec in NARRATIVE_FACTORS
]


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def clean(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if text.lower() in MISSING:
        return None
    return text


def first(rows: list[dict[str, str]], column: str) -> str | None:
    for row in rows:
        value = clean(row.get(column))
        if value is not None:
            return value
    return None


def first_int(rows: list[dict[str, str]], column: str) -> int | None:
    value = first(rows, column)
    if value is None:
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


def percent(count: int, total: int) -> float:
    return round((count / total * 100), 1) if total else 0.0


def public_id(dataset_id: str, index: int) -> str:
    return f"{dataset_id}_crash_{index:05d}"


def hash_text(text: str) -> str:
    return hashlib.md5(normalize_ws(text).encode("utf-8")).hexdigest()[:12]


def snippet(text: str, limit: int = 260) -> str:
    text = normalize_ws(text)
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "..."


def context_from_rows(rows: list[dict[str, str]]) -> dict[str, Any]:
    weather = first(rows, "Wthr_Cond_ID")
    surface = first(rows, "Surf_Cond_ID")
    return {
        "year": first(rows, "Year"),
        "crash_date": first(rows, "Crash_Date"),
        "time_period": time_period(first(rows, "Crash_Time")),
        "speed_limit": first(rows, "Crash_Speed_Limit"),
        "county": first(rows, "Cnty_ID"),
        "city": first(rows, "City_ID"),
        "severity": first(rows, "Crash_Sev_ID"),
        "total_injuries": first_int(rows, "Tot_Injry_Cnt"),
        "deaths": first_int(rows, "Death_Cnt"),
        "suspected_serious_injuries": first_int(rows, "Sus_Serious_Injry_Cnt"),
        "weather": weather,
        "lighting": first(rows, "Light_Cond_ID"),
        "surface": surface,
        "weather_surface": " ".join(v for v in [weather, surface] if v),
        "intersection_relation": first(rows, "Intrsct_Relat_ID"),
        "traffic_control": first(rows, "Traffic_Cntl_ID"),
        "road_type": first(rows, "Road_Type_ID"),
        "road_alignment": first(rows, "Road_Algn_ID"),
        "road_part": first(rows, "Road_Part_Adj_ID"),
        "road_class": first(rows, "Road_Cls_ID"),
        "harmful_event": first(rows, "Harm_Evnt_ID"),
        "first_harmful_event_collision": first(rows, "FHE_Collsn_ID"),
        "object_struck": first(rows, "Obj_Struck_ID"),
        "other_factor": first(rows, "Othr_Factr_ID"),
        "rural_flag": first(rows, "Rural_Fl"),
        "day_of_week": first(rows, "Day_of_Week"),
    }


def add_factor(
    factors: dict[str, dict[str, Any]],
    factor: str,
    label: str,
    category: str,
    source: str,
    evidence: str | None = None,
    confidence: float | None = None,
) -> None:
    if not factor:
        return
    category = CATEGORY_NORMALIZE.get(category, category)
    if factor not in factors:
        factors[factor] = {
            "factor": factor,
            "label": label,
            "category": category,
            "category_label": CATEGORY_LABELS.get(category, category.replace("_", " ").title()),
            "sources": [],
            "evidence": [],
            "confidence": confidence,
        }
    if source not in factors[factor]["sources"]:
        factors[factor]["sources"].append(source)
    if evidence:
        safe = public_safe_text(evidence)
        if safe and safe not in factors[factor]["evidence"]:
            factors[factor]["evidence"].append(safe)


def outcome_from_context(context: dict[str, Any], factors: dict[str, dict[str, Any]]) -> None:
    severity = (context.get("severity") or "").lower()
    deaths = context.get("deaths") or 0
    serious = context.get("suspected_serious_injuries") or 0
    injuries = context.get("total_injuries") or 0

    if deaths or "killed" in severity or "fatal" in severity:
        key = "fatal_injury"
    elif serious or "incapacitating" in severity and "non-incapacitating" not in severity:
        key = "serious_injury"
    elif "non-incapacitating" in severity:
        key = "non_incapacitating_injury"
    elif "possible" in severity:
        key = "possible_injury"
    elif "not injured" in severity:
        key = "not_injured"
    elif injuries:
        key = "injury_recorded"
    else:
        key = ""
    if key:
        label, category = OUTCOME_FACTORS[key]
        add_factor(factors, key, label, category, "structured_severity")


def extract_factors(narrative: str, context: dict[str, Any], rows: list[dict[str, str]]) -> dict[str, dict[str, Any]]:
    factors: dict[str, dict[str, Any]] = {}
    low = narrative.lower()

    for spec in NARRATIVE_SPECS:
        match = spec["compiled"].search(low)
        if not match:
            continue
        left = max(0, match.start() - 160)
        right = min(len(narrative), match.end() + 160)
        evidence = narrative[left:right]
        add_factor(
            factors,
            spec["factor"],
            spec["label"],
            spec["category"],
            "narrative_pattern",
            evidence=evidence,
            confidence=spec.get("confidence"),
        )

    for factor, label, category, field, pattern in CONTEXT_RULES:
        value = context.get(field)
        if value and re.search(pattern, str(value), re.IGNORECASE):
            add_factor(factors, factor, label, category, "structured_context")

    for row in rows:
        values = [
            row.get("Contrib_Factr_1_ID"),
            row.get("Contrib_Factr_2_ID"),
            row.get("Contrib_Factr_1_ID_2"),
            row.get("Contrib_Factr_2_ID_2"),
            row.get("Pedestrian_Action_ID"),
            row.get("Pedestrian_Action_ID_2"),
            row.get("PBCAT_Pedestrian_ID"),
            row.get("PBCAT_Pedestrian_ID_2"),
        ]
        joined = " ".join(clean(v) or "" for v in values)
        for factor, label, category, pattern in STRUCTURED_RULES:
            if re.search(pattern, joined, re.IGNORECASE):
                add_factor(factors, factor, label, category, "structured_actor")

    outcome_from_context(context, factors)
    add_factor(factors, "pedestrian_present", "Pedestrian involved", "pedestrian_behavior", "dataset_membership")
    return factors


def build_actor_summary(rows: list[dict[str, str]], dataset_id: str) -> list[dict[str, Any]]:
    primary = rows[0]
    primary_role = "pedestrian_user" if dataset_id == "pedestrian" else "escooter_user"
    primary_mode = "pedestrian" if dataset_id == "pedestrian" else "e-scooter"
    actors = [
        {
            "actor_id": "primary_road_user",
            "unit_number": clean(primary.get("UnitNbr_Un")),
            "road_user_role": primary_role,
            "mode": primary_mode,
            "cris_unit_description": clean(primary.get("Unit_Desc_ID")),
            "person_type": clean(primary.get("Prsn_Type_ID")),
            "injury_severity": clean(primary.get("Prsn_Injry_Sev_ID")),
            "pedestrian_action": clean(primary.get("Pedestrian_Action_ID")),
            "pedalcyclist_action": clean(primary.get("Pedalcyclist_Action_ID")),
            "pbcat_pedestrian": clean(primary.get("PBCAT_Pedestrian_ID")),
            "pbcat_pedalcyclist": clean(primary.get("PBCAT_Pedalcyclist_ID")),
        },
        {
            "actor_id": "counterpart_unit",
            "unit_number": clean(primary.get("Unit_Nbr_2")),
            "road_user_role": "counterpart_user",
            "mode": clean(primary.get("Unit_Desc_ID_2")) or "motor vehicle",
            "cris_unit_description": clean(primary.get("Unit_Desc_ID_2")),
            "person_type": clean(primary.get("Prsn_Type_ID_2")),
            "injury_severity": clean(primary.get("Prsn_Injry_Sev_ID_2")),
            "contributing_factors": [
                v
                for v in [
                    clean(primary.get("Contrib_Factr_1_ID_2")),
                    clean(primary.get("Contrib_Factr_2_ID_2")),
                ]
                if v
            ],
        },
    ]
    return [actor for actor in actors if actor.get("unit_number") or actor["actor_id"] == "primary_road_user"]


def classify_story(factors: dict[str, dict[str, Any]], context: dict[str, Any]) -> dict[str, Any]:
    keys = set(factors)
    severity = str(context.get("severity") or "").lower()
    if "fatal_injury" in keys or "serious_injury" in keys:
        return {"id": "fatal_or_serious_pedestrian_injury", "label": "Fatal or serious injury pathway"}
    if "traffic_signal" in keys or "intersection" in keys:
        return {"id": "intersection_crossing_conflict", "label": "Intersection crossing conflict"}
    if "dark_lighting" in keys or "failed_to_look" in keys:
        return {"id": "visibility_detection_failure", "label": "Visibility or detection failure"}
    if "driveway" in keys or "backing_vehicle" in keys:
        return {"id": "access_point_conflict", "label": "Driveway or access-point conflict"}
    if "speeding" in keys or "failed_to_stop" in keys:
        return {"id": "speed_control_failure", "label": "Speed or stopping failure"}
    if "pedestrian_in_roadway" in keys or "improper_crossing" in keys:
        return {"id": "pedestrian_roadway_exposure", "label": "Pedestrian roadway exposure"}
    if "not injured" in severity:
        return {"id": "low_severity_report", "label": "Low-severity reported crash"}
    return {"id": "mixed_context_crash", "label": "Mixed-context crash"}


def factor_order(factor: dict[str, Any]) -> tuple[int, str]:
    category_rank = {
        "driver_behavior": 0,
        "human_behavior": 1,
        "pedestrian_behavior": 2,
        "infrastructure": 3,
        "environment": 4,
        "vehicle_context": 5,
        "post_crash": 6,
        "outcome": 7,
    }
    return category_rank.get(factor["category"], 9), factor["factor"]


def build_edges(factors: dict[str, dict[str, Any]], crash_id: str) -> list[dict[str, Any]]:
    values = sorted(factors.values(), key=factor_order)
    causes = [f for f in values if f["category"] != "outcome"]
    outcomes = [f for f in values if f["category"] == "outcome"]
    edges = []
    for left, right in zip(causes, causes[1:]):
        if left["factor"] != right["factor"]:
            edges.append({"source": left["factor"], "target": right["factor"], "type": "sequence", "crash_id": crash_id})
    for cause in causes[:6]:
        for outcome in outcomes[:2]:
            edges.append({"source": cause["factor"], "target": outcome["factor"], "type": "contributes_to", "crash_id": crash_id})
    return edges


def claim_status(factor: dict[str, Any]) -> str:
    sources = set(factor.get("sources", []))
    if "structured_actor" in sources or "structured_context" in sources or "structured_severity" in sources:
        return "confirmed_by_cris"
    if "dataset_membership" in sources:
        return "duplicate_of_cris"
    return "narrative_only"


def make_claims(factors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    claims = []
    for index, factor in enumerate(factors):
        status = claim_status(factor)
        evidence = factor.get("evidence") or []
        claims.append(
            {
                "factor": factor["factor"],
                "label": factor["label"],
                "category": factor["category"],
                "actor_unit": None,
                "confidence": factor.get("confidence") or (0.84 if status != "narrative_only" else 0.72),
                "evidence": {
                    "sentence": evidence[0] if evidence else "",
                    "text_span": evidence[0] if evidence else "",
                    "sentence_index": index,
                    "matched_text": factor["label"],
                },
                "source_agent": agent_for_factor(factor),
                "validation_status": status,
                "validation_reason": validation_reason(status),
                "claim_id": f"c{index:03d}",
                "phase": "post_crash" if factor["category"] == "post_crash" else "during_crash",
                "visual_flags": ["narrative_only"] if status == "narrative_only" else [],
                "suppressed_from_graph": False,
            }
        )
    return claims


def validation_reason(status: str) -> str:
    return {
        "confirmed_by_cris": "Narrative factor is supported by structured CRIS context or actor fields.",
        "duplicate_of_cris": "Dataset membership or coded context already carries this information.",
        "narrative_only": "Narrative evidence adds information not directly represented in selected structured fields.",
        "contradicts_cris": "Narrative and structured CRIS fields appear to disagree.",
    }.get(status, "Validation status was not resolved.")


def agent_for_factor(factor: dict[str, Any]) -> str:
    category = factor.get("category")
    if category in {"human_behavior", "driver_behavior", "pedestrian_behavior"}:
        return "Human Factors Agent"
    if category == "infrastructure":
        return "Infrastructure Context Agent"
    if category == "environment":
        return "Environment Agent"
    if category == "outcome":
        return "Outcome Severity Agent"
    if category == "post_crash":
        return "Post-crash Review Agent"
    return "Evidence Judge Agent"


def validation_summary_from_claims(claims: list[dict[str, Any]]) -> dict[str, int]:
    return dict(Counter(claim.get("validation_status", "unknown") for claim in claims))


def infer_clarity(factors: list[dict[str, Any]], claims: list[dict[str, Any]], context: dict[str, Any]) -> dict[str, Any]:
    causal = [
        claim
        for claim in claims
        if claim["category"] in {"human_behavior", "driver_behavior", "pedestrian_behavior"}
        and claim["factor"] not in {"pedestrian_present"}
    ]
    severe = any(f["factor"] in {"fatal_injury", "serious_injury"} for f in factors)
    score = min(1.0, 0.35 + 0.12 * len(causal) + (0.18 if severe else 0))
    evidence = next((claim["evidence"]["text_span"] for claim in causal if claim["evidence"].get("text_span")), None)
    return {
        "is_explicit": bool(causal),
        "score": round(score, 2) if causal else 0.28,
        "responsible_units": [],
        "impact_actor_units": [],
        "contradicted_units": [],
        "causal_claims": [
            {
                "factor": claim["factor"],
                "actor_unit": claim.get("actor_unit"),
                "validation_status": claim.get("validation_status"),
                "confidence": claim.get("confidence"),
            }
            for claim in causal[:4]
        ],
        "evidence": evidence,
        "reason": "explicit causal factors extracted from deidentified narrative and structured CRIS fields"
        if causal
        else "causal actor or failure mode remains implicit in the record",
    }


def make_review_flags(factors: list[dict[str, Any]], claims: list[dict[str, Any]], clarity: dict[str, Any], context: dict[str, Any]) -> list[dict[str, Any]]:
    flags = []
    factor_ids = {factor["factor"] for factor in factors}
    severity = str(context.get("severity") or "").lower()
    narrative_only = [
        claim["factor"]
        for claim in claims
        if claim.get("validation_status") == "narrative_only"
        and claim.get("factor") not in {"pedestrian_present", "witness_statement"}
        and claim.get("category") in {"human_behavior", "driver_behavior", "pedestrian_behavior", "infrastructure", "environment"}
    ]
    clarity_score = float(clarity.get("score") or 0)
    severe = "fatal_injury" in factor_ids or "serious_injury" in factor_ids or "killed" in severity
    if severe and (clarity_score < 0.58 or len(narrative_only) >= 3):
        flags.append(
            {
                "code": "severe_outcome_review",
                "label": "Fatal or serious injury record",
                "priority": "critical",
                "reason": "high-severity record has enough uncertainty or narrative-only context to justify manual review",
                "trigger_factors": sorted(factor_ids & {"fatal_injury", "serious_injury"}),
            }
        )
    if not clarity.get("is_explicit") and (severe or len(factor_ids) <= 4):
        flags.append(
            {
                "code": "low_confidence_causal_sequence",
                "label": "Causal sequence remains implicit",
                "priority": "high",
                "reason": "causal actor, failure mode, or evidence chain is not explicit enough for strong mental-model claims",
            }
        )
    if len(narrative_only) >= 5 and clarity_score < 0.68:
        flags.append(
            {
                "code": "narrative_heavy_record",
                "label": "Narrative-heavy extraction",
                "priority": "medium",
                "reason": "many factors come from narrative rules rather than structured CRIS validation",
                "trigger_factors": narrative_only[:6],
            }
        )
    return flags


def make_timeline(narrative: str, actors: list[dict[str, Any]], factors: list[dict[str, Any]], context: dict[str, Any]) -> dict[str, dict[str, list[dict[str, Any]]]]:
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", narrative) if s.strip()]
    first_sentence = sentences[0][:260] if sentences else ""
    context_evidence = normalize_ws(
        "; ".join(
            str(v)
            for v in [
                context.get("intersection_relation"),
                context.get("road_part"),
                context.get("traffic_control"),
                context.get("lighting"),
                context.get("weather_surface"),
            ]
            if v
        )
    )
    during = [
        {"action": "crash sequence described", "evidence": first_sentence or context_evidence or "Crash sequence coded in CRIS record.", "sentence_index": 0}
    ]
    if len(sentences) > 1:
        during.append({"action": "impact or contributing context", "evidence": sentences[1][:260], "sentence_index": 1})
    post = []
    if any(f["category"] == "post_crash" for f in factors):
        evidence = next((f.get("evidence", [""])[0] for f in factors if f["category"] == "post_crash" and f.get("evidence")), "")
        post.append({"action": "post-crash response", "evidence": evidence[:260], "sentence_index": 2})
    timeline = {}
    for actor in actors:
        actor_id = actor.get("actor_id") or actor.get("id") or f"unit_{actor.get('unit_number') or 'unknown'}"
        role = actor.get("road_user_role") or actor.get("role") or "road_user"
        if "pedestrian" in str(role):
            before_action = "pedestrian position before conflict"
            before_evidence = actor.get("pedestrian_action") or actor.get("pbcat_pedestrian") or first_sentence or context_evidence
        elif role == "counterpart_user":
            before_action = "counterpart approach before conflict"
            before_evidence = actor.get("cris_unit_description") or first_sentence or context_evidence
        else:
            before_action = "pre-crash context"
            before_evidence = first_sentence or context_evidence
        timeline[actor_id] = {
            "pre_crash": [{"action": before_action, "evidence": normalize_ws(str(before_evidence or "Pre-crash position inferred from CRIS context."))[:260], "sentence_index": 0}],
            "during_crash": during[:],
            "post_crash": post[:],
        }
    return timeline


def make_mental_models(actors: list[dict[str, Any]], factors: list[dict[str, Any]], clarity: dict[str, Any]) -> dict[str, dict[str, Any]]:
    failures = [
        factor["factor"]
        for factor in factors
        if factor["category"] in {"human_behavior", "driver_behavior", "pedestrian_behavior"}
        and factor["factor"] not in {"pedestrian_present"}
    ]
    models = {}
    for actor in actors:
        actor_id = actor.get("actor_id") or actor.get("id") or f"unit_{actor.get('unit_number') or 'unknown'}"
        role = actor.get("road_user_role") or actor.get("role") or "unknown"
        is_counterpart = role == "counterpart_user"
        is_pedestrian = "pedestrian" in str(role)
        actor_failures = [
            failure
            for failure in failures
            if (is_counterpart and failure not in {"pedestrian_in_roadway", "improper_crossing"})
            or (is_pedestrian and failure in {"pedestrian_in_roadway", "improper_crossing", "sudden_entry", "wrong_way"})
        ]
        models[actor_id] = {
            "unit_number": actor.get("unit_number"),
            "road_user_role": role,
            "causal_role": "responsible" if is_counterpart and failures else "affected" if "pedestrian" in role else "witness_described",
            "failure_modes": actor_failures[:5],
            "attention_state": "attention gap indicated" if any(f in failures for f in ["failed_to_look", "distraction"]) else "unknown",
            "rule_compliance": "rule violation indicated" if any(f in failures for f in ["failed_to_yield", "failed_to_stop", "ran_red_light", "ran_stop_sign"]) else "unknown",
            "perception_gap": "possible perception gap" if "failed_to_look" in failures else "not explicit",
            "evasive_action": "evasive action described" if "evasive_action" in failures else "not explicit",
            "post_crash_behavior": "medical/on-scene response described" if any(f["category"] == "post_crash" for f in factors) else "not explicit",
            "confidence": clarity.get("score", 0.5),
            "evidence_count": len(failures),
        }
    return models


def make_safety_summary(
    detail: dict[str, Any],
    factors: list[dict[str, Any]],
    claims: list[dict[str, Any]],
    clarity: dict[str, Any],
    context: dict[str, Any],
) -> dict[str, Any]:
    primary = next((factor for factor in factors if factor["category"] in {"driver_behavior", "human_behavior", "pedestrian_behavior"} and factor["factor"] != "pedestrian_present"), None)
    outcome = next((factor for factor in factors if factor["category"] == "outcome"), None)
    story = detail["story"]
    headline = primary["label"] if primary else story["label"]
    bits = []
    if primary:
        bits.append(f"Primary safety mechanism: {primary['label']} [{claim_status(primary)}].")
    if outcome:
        bits.append(f"Outcome context: {outcome['label']}.")
    if context.get("intersection_relation"):
        bits.append(f"Structured location context: {context.get('intersection_relation')}.")
    evidence = clarity.get("evidence") or next((claim["evidence"]["text_span"] for claim in claims if claim["evidence"].get("text_span")), "")
    if evidence:
        bits.append(f"Evidence basis: {evidence.rstrip('.')}.")
    return {
        "headline": headline,
        "text": " ".join(bits) if bits else detail["deidentified_narrative"][:260],
        "primary_failure": primary["factor"] if primary else None,
        "validation_status": claim_status(primary) if primary else "unknown",
        "story_id": story["id"],
        "story_label": story["label"],
        "clarity_score": clarity.get("score"),
        "is_explicit": clarity.get("is_explicit"),
        "responsible_units": clarity.get("responsible_units", []),
        "impact_actor_units": clarity.get("impact_actor_units", []),
        "evidence_span": evidence,
        "chain": [
            {"stage": "context", "text": context.get("intersection_relation") or context.get("road_part") or "crash context coded"},
            {"stage": "mechanism", "text": primary["label"] if primary else "causal mechanism not explicit"},
            {"stage": "outcome", "text": outcome["label"] if outcome else context.get("severity") or "outcome coded"},
        ],
        "method": "rule-based mental-model summary from deidentified narrative plus selected CRIS fields",
    }


def make_record(
    dataset_id: str,
    crash_id: str,
    rows: list[dict[str, str]],
    ordinal: int,
    page_size: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    narrative = normalize_ws(first(rows, "Investigator_Narrative") or "")
    deidentified = public_safe_text(narrative)
    context = context_from_rows(rows)
    factors = extract_factors(narrative, context, rows)
    story = classify_story(factors, context)
    pid = public_id(dataset_id, ordinal)
    page = (ordinal - 1) // page_size
    factor_list = sorted(factors.values(), key=factor_order)
    edges = build_edges(factors, pid)
    claims = make_claims(factor_list)
    validation_summary = validation_summary_from_claims(claims)
    clarity = infer_clarity(factor_list, claims, context)

    index_entry = {
        "crash_id": pid,
        "page": page,
        "year": context.get("year"),
        "city": context.get("city"),
        "county": context.get("county"),
        "severity": context.get("severity"),
        "story_id": story["id"],
        "story_label": story["label"],
        "factors": [f["factor"] for f in factor_list[:10]],
        "factor_labels": [f["label"] for f in factor_list[:6]],
        "snippet": snippet(deidentified),
    }

    detail = {
        "crash_id": pid,
        "dataset_id": dataset_id,
        "deidentified_narrative": deidentified,
        "cris_context": {k: v for k, v in context.items() if k not in {"crash_date"}},
        "actors": build_actor_summary(rows, dataset_id),
        "factors": [
            {
                "factor": f["factor"],
                "label": f["label"],
                "category": f["category"],
                "category_label": f["category_label"],
                "sources": f["sources"],
                "evidence": f["evidence"][:3],
                "confidence": f.get("confidence"),
            }
            for f in factor_list
        ],
        "contributing_factors": [f["factor"] for f in factor_list if f["category"] != "outcome"],
        "outcomes": [f["factor"] for f in factor_list if f["category"] == "outcome"],
        "story": story,
        "edges": edges,
        "duplicate_source_rows": len(rows),
    }
    detail["claims"] = claims
    detail["validation_summary"] = validation_summary
    detail["causal_clarity"] = clarity
    detail["review_flags"] = make_review_flags(factor_list, claims, clarity, context)
    detail["timeline"] = make_timeline(deidentified, detail["actors"], factor_list, context)
    detail["mental_models"] = make_mental_models(detail["actors"], factor_list, clarity)
    detail["safety_summary"] = make_safety_summary(detail, factor_list, claims, clarity, context)
    detail["public_safe_text"] = deidentified
    detail["redacted_narrative"] = deidentified
    return index_entry, detail


def aggregate_dataset(dataset_id: str, records: list[dict[str, Any]], indexes: list[dict[str, Any]], source_meta: dict[str, Any]) -> dict[str, Any]:
    total = len(records)
    node_counter: Counter[str] = Counter()
    node_category: dict[str, str] = {}
    node_label: dict[str, str] = {}
    edge_counter: Counter[tuple[str, str, str]] = Counter()
    edge_samples: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    cooc_counter: Counter[tuple[str, str]] = Counter()
    cooc_samples: dict[tuple[str, str], list[str]] = defaultdict(list)
    pathway_counter: Counter[tuple[tuple[str, ...], tuple[str, ...]]] = Counter()
    pathway_samples: dict[tuple[tuple[str, ...], tuple[str, ...]], list[str]] = defaultdict(list)
    factor_samples: dict[str, list[str]] = defaultdict(list)

    for record in records:
        seen = set()
        for factor in record["factors"]:
            fid = factor["factor"]
            seen.add(fid)
            node_category[fid] = factor["category"]
            node_label[fid] = factor["label"]
            if len(factor_samples[fid]) < 12:
                factor_samples[fid].append(record["crash_id"])
        for fid in seen:
            node_counter[fid] += 1
        cooc_seen = sorted(
            fid
            for fid in seen
            if fid not in {"pedestrian_present"}
            and node_category.get(fid) not in {"evidence_source"}
        )
        for left_index, left in enumerate(cooc_seen):
            for right in cooc_seen[left_index + 1 :]:
                key = (left, right)
                cooc_counter[key] += 1
                if len(cooc_samples[key]) < 12:
                    cooc_samples[key].append(record["crash_id"])
        for edge in record["edges"]:
            key = (edge["source"], edge["target"], edge["type"])
            edge_counter[key] += 1
            if len(edge_samples[key]) < 15:
                edge_samples[key].append(record["crash_id"])
        causes = [f["factor"] for f in record["factors"] if f["category"] != "outcome"][:3]
        outcomes = [f["factor"] for f in record["factors"] if f["category"] == "outcome"][:2]
        if causes and outcomes:
            key = (tuple(causes[:2]), tuple(outcomes[:1]))
            pathway_counter[key] += 1
            if len(pathway_samples[key]) < 10:
                pathway_samples[key].append(record["crash_id"])

    nodes = [
        {
            "id": factor,
            "label": node_label.get(factor, factor.replace("_", " ").title()),
            "category": node_category.get(factor, "unknown"),
            "category_label": CATEGORY_LABELS.get(node_category.get(factor, ""), node_category.get(factor, "unknown")),
            "frequency": count,
            "percentage": percent(count, total),
            "sample_crash_ids": factor_samples.get(factor, []),
        }
        for factor, count in node_counter.most_common()
    ]
    edges = [
        {
            "source": source,
            "target": target,
            "type": edge_type,
            "weight": count,
            "crash_ids": edge_samples[(source, target, edge_type)],
        }
        for (source, target, edge_type), count in edge_counter.most_common(800)
    ]
    cooccurrence = [
        {
            "factor_a": left,
            "factor_b": right,
            "count": count,
            "sample_crash_ids": cooc_samples[(left, right)],
        }
        for (left, right), count in cooc_counter.most_common(220)
    ]
    pathways = [
        {
            "causes": list(causes),
            "outcomes": list(outcomes),
            "frequency": count,
            "percentage": percent(count, total),
            "sample_crash_ids": pathway_samples[(causes, outcomes)],
        }
        for (causes, outcomes), count in pathway_counter.most_common(80)
    ]

    facets = {
        "years": dict(Counter(i.get("year") for i in indexes if i.get("year"))),
        "severity": dict(Counter(i.get("severity") for i in indexes if i.get("severity"))),
        "city": dict(Counter(i.get("city") for i in indexes if i.get("city")).most_common(30)),
        "county": dict(Counter(i.get("county") for i in indexes if i.get("county")).most_common(30)),
        "stories": dict(Counter(i.get("story_label") for i in indexes if i.get("story_label"))),
    }
    story_archetypes = build_story_archetypes(records)
    validation_overview = build_validation_overview(records)
    review_queue = build_review_queue(records)

    return {
        "meta": {
            "dataset_id": dataset_id,
            "title": source_meta["title"],
            "subject": source_meta["subject"],
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "source_file": source_meta["source_file"],
            "raw_rows": source_meta["raw_rows"],
            "total_unique_crashes": total,
            "duplicate_rows_merged": source_meta["raw_rows"] - total,
            "deidentifier": "PII-removal pipeline: existing public_safe_text rules applied to displayed narratives; direct CRIS identifiers excluded from app artifacts",
            "privacy_note": "The app displays deidentified narrative text. Source Crash_ID values, dates, VIN, plate, license, DOB, ZIP, and exact coordinates are not exported.",
            "schema_version": "lab-1.0",
        },
        "aggregate_graph": {
            "nodes": nodes,
            "edges": edges,
            "stats": {
                "total_crashes": total,
                "total_unique_factors": len(nodes),
                "total_causal_edges": len(edges),
                "category_distribution": dict(Counter(n["category"] for n in nodes)),
            },
        },
        "cooccurrence_matrix": cooccurrence,
        "causal_pathways": pathways,
        "story_archetypes": story_archetypes,
        "validation_overview": validation_overview,
        "review_queue": review_queue,
        "facets": facets,
    }


def condition_tags(record: dict[str, Any]) -> list[str]:
    context = record.get("cris_context", {})
    fields = [
        ("severity", "severity"),
        ("lighting", "lighting"),
        ("weather", "weather"),
        ("surface", "surface"),
        ("intersection_relation", "intersection"),
        ("traffic_control", "traffic control"),
        ("first_harmful_event_collision", "collision"),
        ("road_part", "road part"),
    ]
    return [f"{label}: {value}" for field, label in fields if (value := context.get(field))]


def build_story_archetypes(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        grouped[record["story"]["id"]].append(record)
    result = []
    total = len(records)
    for story_id, story_records in sorted(grouped.items(), key=lambda item: -len(item[1])):
        counter = Counter(tag for record in story_records for tag in condition_tags(record))
        representatives = []
        for record in story_records[:8]:
            representatives.append(
                {
                    "crash_id": record["crash_id"],
                    "safety_summary": (record.get("safety_summary") or {}).get("text") or record.get("deidentified_narrative", "")[:260],
                    "public_safe_text": record.get("deidentified_narrative", "")[:320],
                }
            )
        result.append(
            {
                "id": story_id,
                "label": story_records[0]["story"]["label"],
                "frequency": len(story_records),
                "percentage": percent(len(story_records), total),
                "top_conditions": [
                    {
                        "condition": condition,
                        "count": count,
                        "percentage": percent(count, len(story_records)),
                    }
                    for condition, count in counter.most_common(8)
                ],
                "representative_crashes": representatives,
            }
        )
    return result


def build_validation_overview(records: list[dict[str, Any]]) -> dict[str, Any]:
    status_counts: Counter[str] = Counter()
    top_by_status: dict[str, Counter[str]] = defaultdict(Counter)
    review_flag_counts: Counter[str] = Counter()
    review_examples = []
    contradictions = []
    suppressed = []
    for record in records:
        for flag in record.get("review_flags", []):
            review_flag_counts[flag.get("code", "review")] += 1
            if len(review_examples) < 80:
                review_examples.append(
                    {
                        "crash_id": record["crash_id"],
                        "factor": flag.get("code", "review"),
                        "reason": flag.get("reason") or flag.get("label"),
                        "evidence": (record.get("safety_summary") or {}).get("text") or record.get("deidentified_narrative", "")[:260],
                    }
                )
        for claim in record.get("claims", []):
            status = claim.get("validation_status", "unknown")
            if status == "duplicate_of_cris" and claim.get("factor") in {"pedestrian_present"}:
                continue
            status_counts[status] += 1
            top_by_status[status][claim.get("factor", "unknown")] += 1
            if status == "contradicts_cris":
                contradictions.append(
                    {
                        "crash_id": record["crash_id"],
                        "factor": claim.get("factor"),
                        "reason": claim.get("validation_reason"),
                        "evidence": (claim.get("evidence") or {}).get("text_span"),
                    }
                )
            if claim.get("suppressed_from_graph"):
                suppressed.append(
                    {
                        "crash_id": record["crash_id"],
                        "factor": claim.get("factor"),
                        "reason": claim.get("validation_reason"),
                    }
                )
    return {
        "status_counts": dict(status_counts),
        "top_factors_by_status": {
            status: [{"factor": factor, "count": count} for factor, count in counter.most_common(10)]
            for status, counter in top_by_status.items()
        },
        "contradiction_count": len(contradictions),
        "contradictions": contradictions[:120],
        "suppressed_count": len(suppressed),
        "suppressed_claims": suppressed[:120],
        "review_flag_counts": dict(review_flag_counts),
        "review_examples": review_examples,
    }


def review_score(flags: list[dict[str, Any]], clarity: dict[str, Any]) -> int:
    score = int((1 - float(clarity.get("score") or 0)) * 45)
    for flag in flags:
        priority = flag.get("priority")
        score += {"critical": 45, "high": 28, "medium": 16}.get(priority, 8)
    return min(100, score)


def build_review_queue(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    queue = []
    for record in records:
        flags = record.get("review_flags", [])
        if not flags:
            continue
        summary = record.get("safety_summary") or {}
        queue.append(
            {
                "crash_id": record["crash_id"],
                "story_id": record["story"]["id"],
                "story_label": record["story"]["label"],
                "flags": flags,
                "review_score": review_score(flags, record.get("causal_clarity") or {}),
                "causal_clarity": record.get("causal_clarity"),
                "safety_summary": summary.get("text") or record.get("deidentified_narrative", "")[:320],
                "public_safe_text": record.get("deidentified_narrative", "")[:320],
            }
        )
    return [item for item in sorted(queue, key=lambda item: -item["review_score"]) if item["review_score"] >= 60][:120]


def group_csv(path: Path) -> tuple[dict[str, list[dict[str, str]]], int]:
    groups: dict[str, list[dict[str, str]]] = defaultdict(list)
    rows = 0
    with path.open(newline="", encoding="utf-8-sig", errors="replace") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            rows += 1
            crash_id = clean(row.get("Crash_ID")) or f"row_{rows}"
            groups[str(crash_id)].append(row)
    return groups, rows


def write_record_shards(dataset_id: str, details: list[dict[str, Any]], page_size: int) -> None:
    base = RECORDS_DIR / dataset_id
    for old in base.glob("records-*.json") if base.exists() else []:
        old.unlink()
    base.mkdir(parents=True, exist_ok=True)
    for start in range(0, len(details), page_size):
        page = start // page_size
        write_json(base / f"records-{page:03d}.json", {"dataset_id": dataset_id, "page": page, "records": details[start : start + page_size]})


def write_card_shards(dataset_id: str, indexes: list[dict[str, Any]], page_size: int) -> None:
    base = CARDS_DIR / dataset_id
    for old in base.glob("cards-*.json") if base.exists() else []:
        old.unlink()
    base.mkdir(parents=True, exist_ok=True)
    for start in range(0, len(indexes), page_size):
        page = start // page_size
        write_json(base / f"cards-{page:03d}.json", {"dataset_id": dataset_id, "page": page, "records": indexes[start : start + page_size]})


def write_compact_index(dataset_id: str, indexes: list[dict[str, Any]], page_size: int) -> None:
    columns = ["crash_id", "page", "year", "city", "county", "severity", "story_label", "factors", "factor_labels"]
    rows = [
        [
            item.get("crash_id"),
            item.get("page"),
            item.get("year"),
            item.get("city"),
            item.get("county"),
            item.get("severity"),
            item.get("story_label"),
            item.get("factors", [])[:8],
            item.get("factor_labels", [])[:5],
        ]
        for item in indexes
    ]
    write_json(
        DATASET_DIR / f"{dataset_id}.records-index.json",
        {"dataset_id": dataset_id, "page_size": page_size, "columns": columns, "records": rows},
    )


def redact_text_value(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    if len(value) < 18:
        return value
    return public_safe_text(value)


def sanitize_nested_text(obj: Any, text_keys: set[str] | None = None) -> Any:
    text_keys = text_keys or {"narrative", "public_safe_text", "redacted_narrative", "text", "text_span", "sentence", "evidence", "evidence_span", "safety_summary"}
    if isinstance(obj, dict):
        clean_obj = {}
        for key, value in obj.items():
            if key in {"narrative", "narrative_hash", "privacy", "license_type"}:
                continue
            if key in text_keys:
                clean_obj[key] = redact_text_value(value)
            else:
                clean_obj[key] = sanitize_nested_text(value, text_keys)
        return clean_obj
    if isinstance(obj, list):
        return [sanitize_nested_text(value, text_keys) for value in obj]
    return obj


def build_from_csv(dataset_id: str, title: str, subject: str, csv_name: str, page_size: int = 500) -> dict[str, Any]:
    path = ROOT / csv_name
    groups, raw_rows = group_csv(path)
    indexes = []
    details = []
    for ordinal, crash_id in enumerate(sorted(groups, key=lambda x: (len(x), x)), start=1):
        index_entry, detail = make_record(dataset_id, crash_id, groups[crash_id], ordinal, page_size)
        if not detail["deidentified_narrative"]:
            continue
        kept_page = len(details) // page_size
        index_entry["page"] = kept_page
        detail["page"] = kept_page
        indexes.append(index_entry)
        details.append(detail)
    summary = aggregate_dataset(
        dataset_id,
        details,
        indexes,
        {"title": title, "subject": subject, "source_file": csv_name, "raw_rows": raw_rows},
    )
    write_json(DATASET_DIR / f"{dataset_id}.summary.json", summary)
    write_compact_index(dataset_id, indexes, page_size)
    write_card_shards(dataset_id, indexes, page_size)
    write_record_shards(dataset_id, details, page_size)
    return summary


def load_legacy_escooter(page_size: int = 500) -> dict[str, Any]:
    source = ROOT / "mental-explorer" / "causal_graph_data.json"
    raw = json.loads(source.read_text(encoding="utf-8"))
    records = raw.get("crash_records", [])
    indexes = []
    details = []
    for ordinal, record in enumerate(records, start=1):
        pid = public_id("escooter", ordinal)
        deidentified = public_safe_text(record.get("narrative") or record.get("public_safe_text") or record.get("redacted_narrative") or "")
        page = (ordinal - 1) // page_size
        factors = []
        for factor in record.get("factors", []):
            category = CATEGORY_NORMALIZE.get(factor.get("category"), factor.get("category", "human_behavior"))
            factors.append(
                {
                    "factor": factor.get("factor"),
                    "label": factor.get("label") or str(factor.get("factor", "")).replace("_", " ").title(),
                    "category": category,
                    "category_label": CATEGORY_LABELS.get(category, category),
                    "sources": ["mental_explorer_pipeline"],
                    "validation_status": factor.get("validation_status"),
                    "evidence": [],
                    "confidence": factor.get("confidence"),
                }
            )
        story = record.get("story") or {"id": "escooter_crash", "label": "E-scooter crash"}
        context = record.get("cris_context") or {}
        detail = sanitize_nested_text(
            {
            "crash_id": pid,
            "dataset_id": "escooter",
            "deidentified_narrative": deidentified,
            "cris_context": {k: v for k, v in context.items() if k not in {"crash_date", "crash_time"}},
            "actors": record.get("actors", []),
            "factors": factors,
            "contributing_factors": [f["factor"] for f in factors if f["category"] != "outcome"],
            "outcomes": [f["factor"] for f in factors if f["category"] == "outcome"],
            "story": story,
            "edges": [
                {"source": e.get("source"), "target": e.get("target"), "type": e.get("type", "sequence"), "crash_id": pid}
                for e in record.get("edges", [])
                if e.get("source") and e.get("target")
            ],
            "duplicate_source_rows": record.get("duplicate_source_rows", 1),
            "safety_summary": record.get("safety_summary"),
            "timeline": record.get("timeline") or {},
            "mental_models": record.get("mental_models") or {},
            "causal_clarity": record.get("causal_clarity") or {},
            "claims": record.get("claims") or [],
            "validation_summary": record.get("validation_summary") or {},
            "review_flags": record.get("review_flags") or [],
            "public_safe_text": deidentified,
            "redacted_narrative": deidentified,
            },
        )
        detail["crash_id"] = pid
        detail["dataset_id"] = "escooter"
        detail["deidentified_narrative"] = deidentified
        detail["public_safe_text"] = deidentified
        detail["redacted_narrative"] = deidentified
        details.append(detail)
        indexes.append(
            {
                "crash_id": pid,
                "page": page,
                "year": context.get("year"),
                "city": context.get("city"),
                "county": context.get("county"),
                "severity": context.get("severity"),
                "story_id": story.get("id"),
                "story_label": story.get("label"),
                "factors": [f["factor"] for f in factors[:10]],
                "factor_labels": [f["label"] for f in factors[:6]],
                "snippet": snippet(deidentified),
            }
        )
    summary = aggregate_dataset(
        "escooter",
        details,
        indexes,
        {
            "title": "E-Scooter Crash Causal Explorer",
            "subject": "E-scooter",
            "source_file": str(source.relative_to(ROOT)),
            "raw_rows": raw.get("meta", {}).get("total_raw_narratives", len(records)),
        },
    )
    write_json(DATASET_DIR / "escooter.summary.json", summary)
    write_compact_index("escooter", indexes, page_size)
    write_card_shards("escooter", indexes, page_size)
    write_record_shards("escooter", details, page_size)
    return summary


def build_comparison(escooter: dict[str, Any], pedestrian: dict[str, Any]) -> dict[str, Any]:
    def rates(summary: dict[str, Any]) -> dict[str, float]:
        total = summary["aggregate_graph"]["stats"]["total_crashes"]
        return {n["id"]: n["frequency"] / total * 1000 for n in summary["aggregate_graph"]["nodes"]}

    er = rates(escooter)
    pr = rates(pedestrian)
    all_factors = sorted(set(er) | set(pr))
    deltas = [
        {
            "factor": factor,
            "escooter_per_1000": round(er.get(factor, 0), 2),
            "pedestrian_per_1000": round(pr.get(factor, 0), 2),
            "delta_per_1000": round(pr.get(factor, 0) - er.get(factor, 0), 2),
        }
        for factor in all_factors
    ]
    deltas.sort(key=lambda item: abs(item["delta_per_1000"]), reverse=True)
    return {
        "schema_version": "lab-1.0",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "factor_rate_deltas": deltas[:120],
    }


def main() -> None:
    DATASET_DIR.mkdir(parents=True, exist_ok=True)
    RECORDS_DIR.mkdir(parents=True, exist_ok=True)
    CARDS_DIR.mkdir(parents=True, exist_ok=True)
    escooter = load_legacy_escooter()
    pedestrian = build_from_csv(
        "pedestrian",
        "Pedestrian Crash Causal Explorer",
        "Pedestrian",
        "Pedestrian2017_2025a.csv",
    )
    comparison = build_comparison(escooter, pedestrian)
    write_json(DATASET_DIR / "comparison.summary.json", comparison)
    manifest = {
        "schema_version": "lab-1.0",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "datasets": [
            {
                "id": "escooter",
                "label": "E-Scooter",
                "summary": "datasets/escooter.summary.json",
                "index": "datasets/escooter.records-index.json",
                "cards_dir": "datasets/cards/escooter",
                "records_dir": "datasets/records/escooter",
                "accent": "#f0b429",
            },
            {
                "id": "pedestrian",
                "label": "Pedestrian",
                "summary": "datasets/pedestrian.summary.json",
                "index": "datasets/pedestrian.records-index.json",
                "cards_dir": "datasets/cards/pedestrian",
                "records_dir": "datasets/records/pedestrian",
                "accent": "#43d9ad",
            },
        ],
        "comparison": "datasets/comparison.summary.json",
    }
    write_json(DATASET_DIR / "index.json", manifest)
    print(f"Wrote {DATASET_DIR}")
    print(f"E-scooter crashes: {escooter['aggregate_graph']['stats']['total_crashes']}")
    print(f"Pedestrian crashes: {pedestrian['aggregate_graph']['stats']['total_crashes']}")


if __name__ == "__main__":
    main()
