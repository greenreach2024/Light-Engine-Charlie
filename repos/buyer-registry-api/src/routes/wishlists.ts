import { Router } from "express";
import { createWishlistController } from "../controllers/wishlists";
import { listMatchesController } from "../controllers/matches";

export const router = Router();

router.post("/", createWishlistController);
router.get("/:wishlistId/matches", listMatchesController);
