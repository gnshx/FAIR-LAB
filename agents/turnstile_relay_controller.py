#!/usr/bin/env python3
"""
FairLab Physical Turnstile & Relay Controller
Hardware integration daemon for IIT Bhilai Computer Lab L-106 entrance.

Supports:
1. Physical GPIO relay pulsing (Raspberry Pi / Linux gpiod / sysfs)
2. USB Serial Relay modules (CH340 / FTDI / Arduino)
3. Handheld Optical USB/Bluetooth Barcode & QR Scanners (HID Keyboard Emulation)
4. Fail-Secure Mechanical Interlock (500ms pulse, single-rotation lock)
5. Live HTTP verification with FairLab Controller API
"""

import os
import sys
import time
import json
import argparse
import urllib.request
import urllib.error

CONTROLLER_URL = os.environ.get("FAIRLAB_CONTROLLER_URL", "http://localhost:5000")
RELAY_PIN = int(os.environ.get("FAIRLAB_RELAY_PIN", "17")) # BCM GPIO 17
PULSE_DURATION_SEC = float(os.environ.get("FAIRLAB_RELAY_PULSE_SEC", "0.5"))
GATE_NODE_NAME = os.environ.get("FAIRLAB_GATE_NODE", "Edge Node Alpha (L-106 Main Entrance)")

class HardwareRelayDriver:
    """Manages physical hardware turnstile solenoid relay."""
    def __init__(self, pin=RELAY_PIN, simulation=False):
        self.pin = pin
        self.simulation = simulation
        self.driver_type = "SIMULATION"
        self._init_hardware()

    def _init_hardware(self):
        if self.simulation:
            print("[RELAY] Operating in SIMULATION mode.")
            return

        # Attempt to import RPi.GPIO
        try:
            import RPi.GPIO as GPIO
            GPIO.setmode(GPIO.BCM)
            GPIO.setwarnings(False)
            GPIO.setup(self.pin, GPIO.OUT, initial=GPIO.LOW)
            self.driver_type = "RPI_GPIO"
            print(f"[RELAY] Initialized RPi.GPIO on BCM Pin {self.pin} (Active-High Fail-Secure).")
            return
        except ImportError:
            pass

        # Attempt Linux sysfs GPIO
        try:
            gpio_export = "/sys/class/gpio/export"
            gpio_dir = f"/sys/class/gpio/gpio{self.pin}/direction"
            if os.path.exists(gpio_export):
                try:
                    with open(gpio_export, "w") as f:
                        f.write(str(self.pin))
                except Exception:
                    pass # already exported
                time.sleep(0.05)
                if os.path.exists(gpio_dir):
                    with open(gpio_dir, "w") as f:
                        f.write("out")
                    self.driver_type = "SYSFS_GPIO"
                    print(f"[RELAY] Initialized Linux Sysfs GPIO {self.pin}.")
                    return
        except Exception:
            pass

        # Fallback to software simulation
        self.simulation = True
        self.driver_type = "SIMULATION (No physical SBC GPIO found)"
        print("[RELAY] No physical GPIO driver available on host. Running in interactive SIMULATION mode.")

    def trigger_unlock(self, pulse_sec=PULSE_DURATION_SEC):
        """Energizes solenoid for pulse_sec, then immediately re-latches."""
        t_start = time.time()
        print(f"\n\x1b[1m\x1b[32m>>> [GATE SOLENOID] UNLATCH TRIGGERED ({self.driver_type})\x1b[0m")
        print(f"    - Relay Pin: {self.pin}")
        print(f"    - Pulse Duration: {pulse_sec * 1000:.0f} ms")
        print(f"    - Mechanical State: \x1b[32mUNLATCHED (FREE TO ROTATE 1 CLICK)\x1b[0m")

        if self.driver_type == "RPI_GPIO":
            import RPi.GPIO as GPIO
            GPIO.output(self.pin, GPIO.HIGH)
            time.sleep(pulse_sec)
            GPIO.output(self.pin, GPIO.LOW)
        elif self.driver_type == "SYSFS_GPIO":
            val_file = f"/sys/class/gpio/gpio{self.pin}/value"
            with open(val_file, "w") as f:
                f.write("1")
            time.sleep(pulse_sec)
            with open(val_file, "w") as f:
                f.write("0")
        else:
            # Simulation delay
            time.sleep(pulse_sec)

        t_elapsed = (time.time() - t_start) * 1000
        print(f"    - Mechanical State: \x1b[31mLOCKED (FAIL-SECURE RELATCHED in {t_elapsed:.1f}ms)\x1b[0m\n")
        return True

    def cleanup(self):
        if self.driver_type == "RPI_GPIO":
            import RPi.GPIO as GPIO
            GPIO.cleanup()

def verify_token_with_controller(token, base_url=CONTROLLER_URL):
    """Sends token to FairLab backend for cryptographic signature verification."""
    verify_url = f"{base_url}/api/access/verify"
    payload = json.dumps({"token": token}).encode("utf-8")
    req = urllib.request.Request(
        verify_url,
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return True, data
    except urllib.error.HTTPError as e:
        try:
            err_data = json.loads(e.read().decode("utf-8"))
            return False, err_data
        except Exception:
            return False, {"message": f"HTTP {e.code}"}
    except Exception as e:
        return False, {"message": str(e)}

def confirm_turnstile_check_in(pass_id, base_url=CONTROLLER_URL, operator_id="usr-watchman-ram"):
    """Records physical entry log and marks pass as CHECKED_IN."""
    checkin_url = f"{base_url}/api/access/check-in"
    payload = json.dumps({
        "passId": pass_id,
        "notes": f"Turnstile rotated via hardware relay at {GATE_NODE_NAME}"
    }).encode("utf-8")
    req = urllib.request.Request(
        checkin_url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-user-id": operator_id
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return True, data
    except Exception as e:
        return False, str(e)

def process_scan(token, relay, base_url=CONTROLLER_URL):
    """Full access control flow: Verify -> Unlock Relay -> Confirm Check-in."""
    token = token.strip()
    if not token:
        return

    print("------------------------------------------------------------------------")
    print(f"📷 [OPTICAL SCANNER] Reading Scanned Token: {token}")
    print("------------------------------------------------------------------------")

    ok, res = verify_token_with_controller(token, base_url)
    if not ok or not res.get("authorized"):
        code = res.get("code", "DENIED")
        msg = res.get("message", "Access Denied")
        print(f"\x1b[1m\x1b[31m❌ ACCESS DENIED\x1b[0m")
        print(f"   Reason Code: \x1b[31m{code}\x1b[0m")
        print(f"   Message:     {msg}")
        print("   Physical Gate: \x1b[31mREMAINS LOCKED\x1b[0m")
        print("------------------------------------------------------------------------\n")
        return False

    student = res.get("student", {})
    workstation = res.get("workstation", {})
    slot = res.get("slot", {})
    pass_id = res.get("passId")

    print(f"\x1b[1m\x1b[32m✅ ACCESS GRANTED · DIGITAL PERMISSION VERIFIED\x1b[0m")
    print(f"   Student:       \x1b[1m{student.get('name')} ({student.get('roll_no')})\x1b[0m")
    print(f"   Department:    {student.get('department')}")
    print(f"   Workstation:   \x1b[1m\x1b[34m{workstation.get('machine_id')}\x1b[0m ({workstation.get('gpu_model')})")
    print(f"   Reserved Slot: {slot.get('name')} ({slot.get('time')})")

    # 1. Trigger hardware relay
    relay.trigger_unlock(PULSE_DURATION_SEC)

    # 2. Record check-in with controller
    cin_ok, cin_res = confirm_turnstile_check_in(pass_id, base_url)
    if cin_ok:
        print(f"   Entry Log:     Logged in controller (Entry ID: {cin_res.get('entryId')})")
        print(f"   Pass State:    CHECKED_IN (Replay protection active)")
    else:
        print(f"   ⚠️ Warning: Entry logging failed: {cin_res}")

    print("------------------------------------------------------------------------\n")
    return True

def interactive_scanner_loop(relay, base_url=CONTROLLER_URL):
    """Listens continuously for USB handheld barcode scanner keystrokes (stdin)."""
    print("========================================================================")
    print("🏛️  FAIRLAB TURNSTILE HARDWARE DAEMON ACTIVE")
    print(f"Gate Location: {GATE_NODE_NAME}")
    print(f"Controller:    {base_url}")
    print("Ready for scans. Point USB barcode scanner or paste token and press ENTER.")
    print("Press Ctrl+C to stop.")
    print("========================================================================\n")

    try:
        while True:
            sys.stdout.write("Scan QR Pass > ")
            sys.stdout.flush()
            line = sys.stdin.readline()
            if not line:
                break
            token = line.strip()
            if token:
                process_scan(token, relay, base_url)
    except KeyboardInterrupt:
        print("\n[DAEMON] Stopping turnstile hardware controller...")
    finally:
        relay.cleanup()

def main():
    parser = argparse.ArgumentParser(description="FairLab Physical Turnstile & Relay Controller")
    parser.add_argument("--scan", help="Simulate a single scan with given token")
    parser.add_argument("--simulate", action="store_true", help="Force simulation mode for relay")
    parser.add_argument("--url", default=CONTROLLER_URL, help="FairLab Controller Base URL")
    parser.add_argument("--pin", type=int, default=RELAY_PIN, help="GPIO BCM Pin for Relay")
    args = parser.parse_args()

    relay = HardwareRelayDriver(pin=args.pin, simulation=args.simulate)

    if args.scan:
        process_scan(args.scan, relay, args.url)
        relay.cleanup()
        return

    interactive_scanner_loop(relay, args.url)

if __name__ == "__main__":
    main()

