import { Router } from "express";
import { upsertListingController } from "../controllers/listings";

export const router = Router();

router.post("/", upsertListingController);
