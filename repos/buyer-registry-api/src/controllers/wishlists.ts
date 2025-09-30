import { Request, Response } from "express";
import { wishlistSchema } from "../services/wishlistSchema";
import { enqueueMatchRecalculation } from "../match/matchQueue";

export const createWishlistController = (req: Request, res: Response) => {
  const parseResult = wishlistSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({ errors: parseResult.error.flatten() });
  }

  // Placeholder persistence layer call.
  const wishlistId = "wl-" + Math.random().toString(36).slice(2, 8);

  enqueueMatchRecalculation({ wishlistId });

  res.status(201).json({ id: wishlistId, ...parseResult.data });
};
