import { Request, Response } from "express";
import { getDemandSnapshots } from "../analytics/demandSnapshots";

export const demandAnalyticsController = async (req: Request, res: Response) => {
  const role = req.query.role as string;
  const snapshots = await getDemandSnapshots(role ?? "seller");
  res.json({ snapshots });
};
