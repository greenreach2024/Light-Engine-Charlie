import { Router } from "express";
import { demandAnalyticsController } from "../controllers/analytics";

export const router = Router();

router.get("/demand", demandAnalyticsController);
