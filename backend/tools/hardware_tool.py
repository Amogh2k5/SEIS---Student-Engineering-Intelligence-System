# backend/tools/hardware_tool.py
"""
Hardware tool — Supabase-backed.

Replaces the in-memory `device_store` dict with the `sensor_readings`
Postgres table.  The `analyze()` function is unchanged.

Table schema assumed:
  sensor_readings (
    id          uuid primary key default gen_random_uuid(),
    device_id   text not null,
    sensor_type text not null,
    value       float not null,
    timestamp   float not null,
    created_at  timestamptz default now()
  )
"""

import time
import datetime
from backend.services.llm import generate_response
from backend.services.supabase_client import supabase
from fastapi import HTTPException


# -------------------- STORE READING --------------------

def store_reading(device_id: str, sensor_type: str, value: float,
                  timestamp: float | None = None):
    if timestamp is None:
        timestamp = time.time()

    # Convert float to ISO string for Postgres TIMESTAMP column
    iso_ts = datetime.datetime.fromtimestamp(timestamp, tz=datetime.timezone.utc).isoformat()

    try:
        supabase.table("sensor_readings").insert({
            "device_id":   device_id,
            "sensor_type": sensor_type,
            "value":       value,
            "timestamp":   iso_ts,
        }).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Database unavailable: {exc}"
        )

    return {"status": "success"}


# -------------------- GET LATEST --------------------

def get_latest(device_id: str, sensor_type: str):
    try:
        resp = (
            supabase.table("sensor_readings")
            .select("value, timestamp")
            .eq("device_id",   device_id)
            .eq("sensor_type", sensor_type)
            .order("timestamp", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Database unavailable: {exc}"
        )

    rows = resp.data or []
    if not rows:
        return None

    row = rows[0]
    # Convert ISO string back to Unix float for frontend compatibility
    try:
        val = row["timestamp"]
        if isinstance(val, str):
            dt = datetime.datetime.fromisoformat(val.replace("Z", "+00:00"))
            row["timestamp"] = dt.timestamp()
    except Exception:
        pass

    return row


# -------------------- GET LAST N --------------------

def get_last_n(device_id: str, sensor_type: str, n: int = 50):
    try:
        resp = (
            supabase.table("sensor_readings")
            .select("value, timestamp")
            .eq("device_id",   device_id)
            .eq("sensor_type", sensor_type)
            .order("timestamp", desc=True)
            .limit(n)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Database unavailable: {exc}"
        )

    rows = resp.data or []
    
    # Pre-process: convert ISO strings back to Unix floats
    for row in rows:
        try:
            val = row["timestamp"]
            if isinstance(val, str):
                dt = datetime.datetime.fromisoformat(val.replace("Z", "+00:00"))
                row["timestamp"] = dt.timestamp()
        except Exception:
            pass

    # Return in ascending time order (oldest → newest) so graphs display correctly
    return list(reversed(rows))


# -------------------- LIST DEVICES --------------------

def list_devices():
    """
    Return a dict: { device_id: [sensor_type, ...] }
    Used by the router's planner prompt.
    """
    try:
        resp = (
            supabase.table("sensor_readings")
            .select("device_id, sensor_type")
            .execute()
        )
    except Exception:
        # Non-fatal — planner still works with an empty dict
        return {}

    devices: dict[str, list[str]] = {}
    for row in resp.data or []:
        dev = row["device_id"]
        sen = row["sensor_type"]
        if dev not in devices:
            devices[dev] = []
        if sen not in devices[dev]:
            devices[dev].append(sen)

    return devices


# -------------------- ANALYZE (UNCHANGED) --------------------

def analyze(device_id: str, sensor_type: str, question: str):
    readings = get_last_n(device_id, sensor_type, 100)

    if not readings:
        return {"error": "No sensor data available"}

    values = [r["value"] for r in readings]

    prompt = f"""
You are an embedded systems analysis assistant.

Sensor type: {sensor_type}
Recent readings:
{values}

User question:
{question}

Analyze clearly and concisely.
"""

    response = generate_response(prompt)

    return {
        "type":        "hardware",
        "device_id":   device_id,
        "sensor_type": sensor_type,
        "analysis":    response
    }