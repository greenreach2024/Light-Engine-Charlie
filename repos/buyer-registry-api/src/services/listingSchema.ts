import { z } from "zod";

export const listingSchema = z.object({
  listingId: z.string().uuid().optional(),
  ownerId: z.string(),
  agentId: z.string().optional(),
  address: z.string(),
  postalCode: z.string().min(3),
  price: z.number().int().positive(),
  propertyType: z.enum(["house", "condo", "townhouse", "duplex", "land"]),
  bedrooms: z.number().min(0).default(0),
  bathrooms: z.number().min(0).default(0),
  squareFootage: z.number().min(0).nullable().optional(),
  lotSize: z.number().min(0).nullable().optional(),
  geom: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([z.number(), z.number()])
  }),
  features: z.record(z.string(), z.any()).default({}),
  amenities: z.array(z.string()).default([]),
  availability: z.enum(["immediate", "30-days", "60-days", "90-days", "custom"]).default("immediate"),
  media: z.object({
    photos: z.array(z.string()).default([]),
    attachments: z.array(z.string()).default([])
  }),
  status: z.enum(["draft", "published", "archived", "under-contract"]).default("draft")
});

export type ListingInput = z.infer<typeof listingSchema>;
