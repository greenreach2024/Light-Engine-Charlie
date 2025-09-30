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
  },
  "ifttt-automation": {
    id: "ifttt-automation",
    title: "IFTTT Protocol Setup",
    steps: [
      {
        title: "Connect IFTTT Account",
        bodyMd: "Sign in to your IFTTT account and authorize Light Engine Charlie service.",
        requiresExternalLogin: true,
        openUrl: "https://ifttt.com/services/light_engine_charlie"
      },
      {
        title: "Configure Device Triggers",
        bodyMd: 
          "Set up IF triggers for your device:\n" +
          "- **Environmental**: Temperature, humidity, CO2 sensors\n" +
          "- **Time-based**: Schedule changes, photoperiod shifts\n" +
          "- **Manual**: Mobile app controls, voice commands\n" +
          "- **System**: Power events, maintenance alerts"
      },
      {
        title: "Define Actions",
        bodyMd:
          "Configure THEN actions for Light Engine:\n" +
          "- **Spectrum Control**: Adjust light recipes\n" +
          "- **Environmental**: Climate control responses\n" +
          "- **Notifications**: Alert systems, data logging\n" +
          "- **AI Training**: Feed data to IA systems"
      },
      {
        title: "Test Automation",
        bodyMd:
          "Create a test applet to verify communication. Example:\n" +
          "`IF temperature > 85°F THEN reduce light intensity by 20%`\n" +
          "Monitor the activity log to confirm triggers are working."
      },
      {
        title: "Enable AI Integration",
        bodyMd:
          "Toggle **IA Assist** and **IA In Training** to allow the AI to:\n" +
          "- Learn from IFTTT automation patterns\n" +
          "- Suggest optimization improvements\n" +
          "- Create predictive automations based on environmental data"
      }
    ]
  },
  "webhook-direct": {
    id: "webhook-direct", 
    title: "Direct Webhook Integration",
    steps: [
      {
        title: "Generate Webhook URL",
        bodyMd: "Light Engine will generate a unique webhook endpoint for your device. Copy this URL for use in your automation platform."
      },
      {
        title: "Configure External System",
        bodyMd:
          "In your automation platform (Home Assistant, Node-RED, etc.), set up HTTP POST requests to the webhook URL with JSON payload:\n" +
          "```json\n" +
          "{\n" +
          "  \"action\": \"spectrum_change\",\n" +
          "  \"intensity\": 85,\n" +
          "  \"spectrum\": \"flowering\",\n" +
          "  \"device_id\": \"your-device-id\"\n" +
          "}\n" +
          "```"
      },
      {
        title: "Test Integration",
        bodyMd: "Send a test webhook to verify Light Engine responds correctly. Check the device activity log for confirmation."
      }
    ]
  }
};
