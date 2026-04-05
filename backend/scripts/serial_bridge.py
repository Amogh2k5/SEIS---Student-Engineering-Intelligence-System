# backend/scripts/serial_bridge.py
import serial
import serial.tools.list_ports
import requests
import json
import time
import sys

# CONFIGURATION
BACKEND_URL = "http://localhost:8000/hardware/data"
BAUD_RATE = 115200
DEVICE_ID = "SERIAL_DEVICE" # The ID you'll enter in the Dashboard

def find_serial_port():
    ports = list(serial.tools.list_ports.comports())
    if not ports:
        return None
    # Just grab the first one for simplicity, or look for specific hardware
    return ports[0].device

def main():
    port = find_serial_port()
    if not port:
        print("Error: No serial/USB devices detected. Plug in your STM32/Arduino!")
        return

    print(f"--- SEIS Serial Bridge ---")
    print(f"Connecting to {port} at {BAUD_RATE} baud...")
    
    try:
        ser = serial.Serial(port, BAUD_RATE, timeout=1)
        print(f"Success! Listening for data...")
        print(f"Format expected: 'sensor_type:value' (e.g. 'vibration:0.85')")
        
        while True:
            if ser.in_waiting > 0:
                line = ser.readline().decode('utf-8').strip()
                if not line:
                    continue
                
                print(f"Read: {line}")
                
                # Logic: parse "type:value"
                if ":" in line:
                    try:
                        sensor_type, value_str = line.split(":", 1)
                        value = float(value_str)
                        
                        # Forward to SEIS Backend
                        payload = {
                            "device_id": DEVICE_ID,
                            "sensor_type": sensor_type.strip(),
                            "value": value
                        }
                        
                        resp = requests.post(BACKEND_URL, json=payload)
                        if resp.status_code == 200:
                            # print(f"  -> Forwarded to Dashboard")
                            pass
                        else:
                            print(f"  !! Backend Error: {resp.status_code}")
                            
                    except ValueError:
                        print(f"  !! Parse Error: Ensure format is 'type:value'")
                    except Exception as e:
                        print(f"  !! Error: {e}")
            
            time.sleep(0.1)
            
    except KeyboardInterrupt:
        print("\nBridge stopped.")
    except Exception as e:
        print(f"Serial Error: {e}")
    finally:
        if 'ser' in locals() and ser.is_open:
            ser.close()

if __name__ == "__main__":
    main()
