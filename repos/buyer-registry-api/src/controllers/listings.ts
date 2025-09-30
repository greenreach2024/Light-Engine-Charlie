import { Request, Response } from "express";
import { listingSchema } from "../services/listingSchema";
import { publishListingUpsert } from "../services/listingSync";

export const upsertListingController = async (req: Request, res: Response) => {
  const parseResult = listingSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({ errors: parseResult.error.flatten() });
  }

  await publishListingUpsert(parseResult.data);

  res.status(202).json({ status: "queued" });
};
