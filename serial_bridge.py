"""
serial_bridge.py — SEIS Serial Monitor Bridge
==============================================
Reads sensor values from an Arduino / STM32 serial port
and forwards them to the SEIS /hardware/data endpoint.

Supported serial output formats from your firmware:
  Plain value          →  87.4
  Key=value            →  temp=87.4
  Key: value           →  Temperature: 87.4
  CSV (multi-sensor)   →  87.4,3.3,1024

Usage:
  python serial_bridge.py --port COM3 --baud 9600 --device arduino-01 --sensor temperature
  python serial_bridge.py --port COM5 --baud 115200 --device stm32-01 --sensor voltage

Dependencies:
  pip install pyserial requests
"""

import argparse
import re
import time
import serial
import requests

# -------------------------------------------------------
BACKEND_URL = "http://127.0.0.1:8000/hardware/data"
# -------------------------------------------------------


def parse_value(line: str, sensor_key: str | None = None) -> float | None:
    """
    Extract a float from a serial line.

    Priority:
      1. If sensor_key given, look for  key=value  or  key: value
      2. First float found anywhere in the line
    """
    line = line.strip()

    if sensor_key:
        # Match  "temp=87.4"  or  "Temperature: 87.4"
        pattern = rf"{re.escape(sensor_key)}\s*[=:]\s*([-+]?\d+\.?\d*)"
        match = re.search(pattern, line, re.IGNORECASE)
        if match:
            return float(match.group(1))

    # Fallback — grab first number in the line
    match = re.search(r"[-+]?\d+\.?\d*", line)
    if match:
        return float(match.group())

    return None


def post_reading(device_id: str, sensor_type: str, value: float):
    try:
        resp = requests.post(BACKEND_URL, json={
            "device_id": device_id,
            "sensor_type": sensor_type,
            "value": value
        }, timeout=3)
        return resp.status_code == 200
    except requests.exceptions.ConnectionError:
        print("  [ERROR] Cannot reach SEIS backend. Is uvicorn running?")
        return False


def run_bridge(port: str, baud: int, device_id: str, sensor_type: str,
               sensor_key: str | None, interval: float):
    print(f"\n SEIS Serial Bridge")
    print(f"  Port      : {port}  @  {baud} baud")
    print(f"  Device    : {device_id}")
    print(f"  Sensor    : {sensor_type}")
    print(f"  Interval  : every {interval}s")
    print(f"  Backend   : {BACKEND_URL}")
    print("-" * 45)

    try:
        ser = serial.Serial(port, baud, timeout=2)
        print(f"[OK] Connected to {port}\n")
    except serial.SerialException as e:
        print(f"[ERROR] Could not open {port}: {e}")
        return

    last_post = 0.0

    try:
        while True:
            raw = ser.readline().decode("utf-8", errors="replace").strip()

            if not raw:
                continue

            value = parse_value(raw, sensor_key)

            if value is None:
                print(f"  [SKIP] Could not parse: '{raw}'")
                continue

            now = time.time()
            if now - last_post >= interval:
                ok = post_reading(device_id, sensor_type, value)
                status = "✓ sent" if ok else "✗ failed"
                print(f"  {status}  {sensor_type}={value}  raw='{raw}'")
                last_post = now
            else:
                print(f"  [read]  {sensor_type}={value}  (waiting for interval)")

    except KeyboardInterrupt:
        print("\n[STOP] Bridge stopped.")
    finally:
        ser.close()


def main():
    parser = argparse.ArgumentParser(description="SEIS Serial Bridge")
    parser.add_argument("--port",    required=True,  help="Serial port, e.g. COM3 or /dev/ttyUSB0")
    parser.add_argument("--baud",    type=int, default=9600, help="Baud rate (default: 9600)")
    parser.add_argument("--device",  required=True,  help="Device ID, e.g. arduino-01")
    parser.add_argument("--sensor",  required=True,  help="Sensor type, e.g. temperature")
    parser.add_argument("--key",     default=None,   help="Optional key to parse from key=value lines")
    parser.add_argument("--interval",type=float, default=5.0, help="Seconds between POST calls (default: 5)")
    args = parser.parse_args()

    run_bridge(
        port=args.port,
        baud=args.baud,
        device_id=args.device,
        sensor_type=args.sensor,
        sensor_key=args.key,
        interval=args.interval
    )


if __name__ == "__main__":
    main()
