import { Router } from "express";
import { getSubscriptionController, webhookController } from "../controllers/subscriptions";

export const router = Router();

router.post("/webhook", webhookController);
router.get("/:userId", getSubscriptionController);
