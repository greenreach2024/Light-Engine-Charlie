import { Router } from "express";
import { listMatchesController } from "../controllers/matches";

export const router = Router();

router.get("/:wishlistId", listMatchesController);
