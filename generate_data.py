from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd


BASE_DIR = Path(__file__).resolve().parent
SOURCE_FILE = BASE_DIR.parent / "IranACLED.csv"
OUTPUT_FILE = BASE_DIR / "data.js"
START_DATE = pd.Timestamp("2026-02-28")
EXCLUDED_EVENT_TYPES = {
    "Protests",
    "Riots",
    "Violence against civilians",
}
EXCLUDED_STRATEGIC_SUBEVENTS = {
    "Arrests",
    "Change to group/activity",
    "Looting/property destruction",
    "Headquarters or base established",
}

IRAN_PATTERNS = [
    r"Military Forces of Iran",
    r"Police Forces of Iran",
    r"Government of Iran",
    r"Islamic Revolutionary Guard Corps",
    r"Basij",
    r"Quds Force",
    r"Islamic Republic of Iran Air Force",
    r"Islamic Republic of Iran Border Guard Command",
    r"Unidentified Armed Group \(Iran\)",
    r"Qashqai Tribal Militia \(Iran\)",
]

ISRAEL_US_PATTERNS = [
    r"Military Forces of Israel",
    r"Military Forces of the United States",
    r"Government of the United States",
    r"Mossad",
    r"Military Forces of Kuwait",
    r"Military Forces of Saudi Arabia",
    r"Military Forces of the United Arab Emirates",
    r"Military Forces of Bahrain",
    r"Military Forces of Qatar",
    r"Military Forces of Jordan",
    r"Military Forces of Iraq .*Peshmerga",
    r"Global Coalition Against Daesh",
    r"NATO: North Atlantic Treaty Organization",
    r"Military Forces of Oman",
    r"Military Forces of the United Kingdom",
    r"Police Forces of Azerbaijan .*State Security Service",
    r"Military Forces of France",
]


def clean_text(value: object) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip()


def contains_pattern(text: str, patterns: list[str]) -> bool:
    return any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in patterns)


def classify_side(text: str) -> str:
    iran = contains_pattern(text, IRAN_PATTERNS)
    israel_us = contains_pattern(text, ISRAEL_US_PATTERNS)
    if iran and not israel_us:
        return "Iran"
    if israel_us and not iran:
        return "Israel/US"
    return "Other"


def build_payload() -> dict:
    df = pd.read_csv(SOURCE_FILE)
    df["date_dt"] = pd.to_datetime(df["event_date"], format="%d/%m/%y", errors="coerce")
    df = df[df["date_dt"] >= START_DATE].copy()
    df = df[~df["event_type"].isin(EXCLUDED_EVENT_TYPES)].copy()
    df = df[
        ~(
            df["event_type"].eq("Strategic developments")
            & df["sub_event_type"].isin(EXCLUDED_STRATEGIC_SUBEVENTS)
        )
    ].copy()
    df["date_iso"] = df["date_dt"].dt.strftime("%Y-%m-%d")
    df["fatalities"] = pd.to_numeric(df["fatalities"], errors="coerce").fillna(0).astype(int)
    df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
    df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")
    df["side"] = df.apply(
        lambda row: classify_side(f"{clean_text(row.get('actor1'))} | {clean_text(row.get('assoc_actor_1'))}"),
        axis=1,
    )
    # Per user framing, events occurring in Iran are attributed to US-Israel and allied force
    # unless the initiating actor is explicitly classified as Iran.
    df.loc[df["country"].fillna("").eq("Iran") & df["side"].ne("Iran"), "side"] = "Israel/US"

    records = []
    for row in df.to_dict(orient="records"):
        records.append(
            {
                "event_id": clean_text(row.get("event_id_cnty")),
                "date_iso": clean_text(row.get("date_iso")),
                "country": clean_text(row.get("country")),
                "admin1": clean_text(row.get("admin1")),
                "location": clean_text(row.get("location")),
                "event_type": clean_text(row.get("event_type")),
                "sub_event_type": clean_text(row.get("sub_event_type")),
                "side": clean_text(row.get("side")),
                "actor1": clean_text(row.get("actor1")),
                "actor2": clean_text(row.get("actor2")),
                "fatalities": int(row.get("fatalities") or 0),
                "latitude": None if pd.isna(row.get("latitude")) else float(row["latitude"]),
                "longitude": None if pd.isna(row.get("longitude")) else float(row["longitude"]),
                "notes": clean_text(row.get("notes")),
            }
        )

    dates = sorted({row["date_iso"] for row in records})
    plotted_total = sum(1 for row in records if row["side"] in {"Iran", "Israel/US"})
    return {
        "meta": {
            "source_file": SOURCE_FILE.name,
            "start_date": dates[0] if dates else "",
            "end_date": dates[-1] if dates else "",
            "total_records": len(records),
            "plotted_records": plotted_total,
        },
        "records": records,
    }


def main() -> None:
    payload = build_payload()
    OUTPUT_FILE.write_text(
        "window.ACLED_ATTACKS_DATA = " + json.dumps(payload, ensure_ascii=True) + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
