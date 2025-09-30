import { Request, Response } from "express";
import { getSubscriptionForUser, recordWebhookEvent } from "../payments/subscriptionService";

export const getSubscriptionController = async (req: Request, res: Response) => {
  const { userId } = req.params;
  const subscription = await getSubscriptionForUser(userId);
  res.json({ subscription });
};

export const webhookController = async (req: Request, res: Response) => {
  const payload = req.body;
  const result = await recordWebhookEvent(payload);
  res.status(202).json(result);
};
