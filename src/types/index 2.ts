export type CommType =
  | "MANAGED_BY_LIGHT_ENGINE"
  | "WIFI"
  | "BLE"
  | "ZIGBEE"
  | "RS485"
  | "ANALOG_0_10V"
  | "PWM"
  | "IFTTT"
  | "WEBHOOK"
  | "OTHER";

export type SupportBadge = "NATIVE" | "GENERIC" | "MANAGED" | "CUSTOM";

export interface LightDefinition {
  id: string;
  brand: string;
  model: string;
  productName?: string;
  dynamicSpectrum: boolean | "UNKNOWN";
  channels?: string[];
  maxPowerW?: number;
  inputPowerSpec?: string;
  efficacy_umolPerJ?: number;
  ppf_umolPerS?: number;
  cct_or_peak?: string;
  commType: CommType;
  controlMethod?: string;
  setupGuideId: string;
  supportBadge: SupportBadge;
  researchRequired?: string[];
  notes?: string;
  warrantyYears?: number;
  ipRating?: string;
  lifetimeHoursL70?: number;
  manufacturer?: string;
  qualifiedProductId?: string;
}

export interface SetupGuideStep {
  title: string;
  bodyMd: string;
  requiresExternalLogin?: boolean;
  openUrl?: string;
}

export interface SetupGuide {
  id: string;
  title: string;
  steps: SetupGuideStep[];
}
