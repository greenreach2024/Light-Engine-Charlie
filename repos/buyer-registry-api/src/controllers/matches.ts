import { Request, Response } from "express";
import { getMatchesForWishlist } from "../services/matchService";

export const listMatchesController = async (req: Request, res: Response) => {
  const { wishlistId } = req.params;
  const matches = await getMatchesForWishlist(wishlistId);
  res.json({ matches });
};
