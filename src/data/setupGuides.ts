import { SetupGuide } from "../types";

export const SETUP_GUIDES: Record<string, SetupGuide> = {
  "managed-by-le": {
    id: "managed-by-le",
    title: "Managed by Light Engine",
    steps: [
      {
        title: "Already connected",
        bodyMd:
          "This light is already managed by Light Engine. We won’t change communication or control. You can safely assign **Name**, **Location**, **Zone**, and **Group**."
      }
    ]
  },
  "wifi-generic-vendor": {
    id: "wifi-generic-vendor",
    title: "Wi-Fi Setup (Vendor Guided)",
    steps: [
      {
        title: "Sign in / Create vendor account",
        bodyMd: "Open the vendor’s portal and sign in. After login, return here.",
        requiresExternalLogin: true,
        openUrl: "ABOUT:RESEARCH_REQUIRED"
      },
      {
        title: "Pair the device",
        bodyMd:
          "Follow the vendor’s pairing instructions (AP mode or QR). Capture any **Device ID** or **Token** if presented. _This varies by manufacturer._"
      },
      {
        title: "Join farm Wi-Fi",
        bodyMd:
          "Using the vendor flow, connect the light to the farm SSID/password so it can reach the network."
      },
      {
        title: "Authorize Light Engine",
        bodyMd:
          "Enter the **API Key / OAuth token** from the vendor portal into the field below to allow Light Engine to discover and control the device. _If the vendor provides local-LAN control, toggle **Local Control** and enter IP/Port._"
      },
      {
        title: "Discover & Name",
        bodyMd:
          "Click **Discover**. Select your device from the list, then set **Name**, **Location**, **Zone**, **Group** and **Save**."
      }
    ]
  },
  "analog-010v": {
    id: "analog-010v",
    title: "0–10 V Mapping",
    steps: [
      {
        title: "Connect driver",
        bodyMd: "Wire the 0–10 V dimming leads to the controller per driver specs."
      },
      {
        title: "Channel mapping",
        bodyMd:
          "Assign controller output(s) to the light’s dimming input(s). Set **Min/Max** voltage and verify a smooth dimming response."
      },
      {
        title: "Save",
        bodyMd: "Name the light and assign **Location**, **Zone**, **Group**."
      }
    ]
  },
  "rs485-generic": {
    id: "rs485-generic",
    title: "RS-485 Integration",
    steps: [
      {
        title: "Set bus parameters",
        bodyMd:
          "Choose the RS-485 bus, set the device address, baud rate, parity and stop bits to match the fixture documentation."
      },
      {
        title: "Ping the device",
        bodyMd:
          "Use **Ping** to confirm the light responds on the bus before proceeding."
      },
      {
        title: "Map channels",
        bodyMd:
          "Assign Light Engine virtual channels to the fixture’s RS-485 addresses."
      },
      {
        title: "Finalize",
        bodyMd: "Name the device and assign **Location**, **Zone**, **Group**."
      }
    ]
  },
  "dc-driver": {
    id: "dc-driver",
    title: "DC Driver Commissioning",
    steps: [
      {
        title: "Verify power supply",
        bodyMd:
          "Confirm the DC driver output voltage and current are within the fixture’s supported range before connecting the light."
      },
      {
        title: "Wire the fixture",
        bodyMd:
          "Connect positive and negative leads, then secure any control cabling (0–10 V or proprietary) as specified by the manufacturer."
      },
      {
        title: "Test dimming",
        bodyMd:
          "Issue a dimming sweep to ensure the light responds smoothly from minimum to maximum levels."
      },
      {
        title: "Assign metadata",
        bodyMd: "Set **Name**, **Location**, **Zone**, and **Group** before saving."
      }
    ]
  }
};
