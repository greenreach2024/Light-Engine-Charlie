import { z } from "zod";

export const matchSchema = z.object({
  matchId: z.string().uuid().optional(),
  wishlistId: z.string().uuid(),
  listingId: z.string().uuid(),
  score: z.number().min(0).max(100),
  locationScore: z.number().min(0).max(100),
  priceScore: z.number().min(0).max(100),
  featureScore: z.number().min(0).max(100),
  timelineScore: z.number().min(0).max(100).optional(),
  status: z.enum(["pending", "notified", "accepted", "declined"]).default("pending"),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional()
});

export type Match = z.infer<typeof matchSchema>;
