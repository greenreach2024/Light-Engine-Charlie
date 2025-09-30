export type DemandSnapshot = {
  area: string;
  activeWishlists: number;
  averageBudget: number;
  preApprovalRate: number;
};

const mockSnapshots: DemandSnapshot[] = [
  { area: "M4C", activeWishlists: 128, averageBudget: 910000, preApprovalRate: 0.68 },
  { area: "L6J", activeWishlists: 94, averageBudget: 1250000, preApprovalRate: 0.72 }
];

export const getDemandSnapshots = async (_role: string): Promise<DemandSnapshot[]> => {
  // TODO: Replace with SQL view fetching aggregated demand metrics per area.
  return mockSnapshots;
};
