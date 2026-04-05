# backend/services/device_detector.py
import re
import time
import logging
import serial
import serial.tools.list_ports

logger = logging.getLogger(__name__)

# =================================================================
# PLACEHOLDER: Future Live Streaming Handler
# =================================================================

class SerialStreamHandler:
    """
    A placeholder for future real-time streaming capability.
    This class can be extended to maintain persistent serial connections.
    """
    def __init__(self, port: str, baud: int = 115200):
        self.port = port
        self.baud = baud
        self.connection = None
        self.active = False

    def start_stream(self):
        # Placeholder for background thread / websocket logic
        pass

    def stop_stream(self):
        pass


# =================================================================
# CORE DETECTION LOGIC
# =================================================================

def detect_devices(scan_duration_ms: int = 500):
    """
    Scans all available COM/USB ports, reads for a short burst,
    and attempts to parse device identity and sensors.
    """
    ports = serial.tools.list_ports.comports()
    detected = []

    for p in ports:
        port_name = p.device
        description = p.description.lower()
        
        # ── Skip Bluetooth ports (high hang risk on Windows) ──
        if "bluetooth" in description or "standard serial over bluetooth" in description:
            logger.info(f"[Detector] Skipping Bluetooth port: {port_name} ({p.description})")
            continue
            
        logger.info(f"[Detector] Scanning {port_name} ({p.description})...")
        
        try:
            # ── Open Serial Port ──
            # Use a slightly longer timeout for the initial open if possible
            with serial.Serial(port_name, 115200, timeout=0.1, write_timeout=0.1) as ser:
                start_time = time.time()
                raw_data = ""
                
                # ── Buffer Reads ──
                while (time.time() - start_time) * 1000 < scan_duration_ms:
                    if ser.in_waiting > 0:
                        chunk = ser.read(ser.in_waiting).decode("utf-8", errors="replace")
                        raw_data += chunk
                    
                    # 💡 Crucial: Add sleep to prevent 100% CPU and allow other threads to run
                    time.sleep(0.02)
                
                if raw_data:
                    info = _parse_device_data(raw_data, port_name)
                    detected.append(info)
                    
        except (serial.SerialException, PermissionError):
            logger.warning(f"[Detector] Already in use or Access Denied: {port_name}")
        except Exception as exc:
            logger.error(f"[Detector] Error scanning {port_name}: {exc}")

    return detected


def _parse_device_data(raw_text: str, port: str) -> dict:
    """
    Parses a raw serial dump for device identity and sensors.
    Expects formats like "STM32 #42", "temp=23.5", etc.
    """
    # ── 1. Identify Device Type ─────────────────────────────────────
    device_type = "Unknown Device"
    if "STM32" in raw_text.upper():
        device_type = "STM32"
    elif "ARDUINO" in raw_text.upper():
        device_type = "Arduino"

    # ── 2. Parse Node ID ──────────────────────────────────────────
    node_id = None
    node_match = re.search(r"#(\d+)", raw_text)
    if node_match:
        node_id = int(node_match.group(1))

    # ── 3. Detect Sensors ─────────────────────────────────────────
    # Look for common sensor keywords in the stream
    possible_sensors = {
        "Temperature": ["temp", "celsius", "humidity"],
        "Pressure": ["press", "pa", "bar"],
        "Voltage": ["volt", "vcell", "battery"],
        "Current": ["curr", "amp", "ma"],
        "Acceleration": ["accel", "gyro", "imu"],
        "Generic": ["val", "data"]
    }
    
    found_sensors = []
    for sensor, keywords in possible_sensors.items():
        if any(kw in raw_text.lower() for kw in keywords):
            found_sensors.append(sensor)

    if not found_sensors:
        found_sensors = ["Generic"]

    return {
        "port": port,
        "device": device_type,
        "nodeId": node_id,
        "sensors": list(set(found_sensors)) # unique
    }
