import { z } from "zod";

export const listingSchema = z.object({
  listingId: z.string().uuid().optional(),
  ownerId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
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
  features: z.record(z.string(), z.string().or(z.number()).or(z.boolean())).default({}),
  amenities: z.array(z.string()).default([]),
  availability: z.enum(["immediate", "30-days", "60-days", "90-days", "custom"]).default("immediate"),
  media: z.object({
    photos: z.array(z.string().url()).default([]),
    attachments: z.array(z.string().url()).default([])
  }),
  status: z.enum(["draft", "published", "archived", "under-contract"]).default("draft"),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional()
});

export type Listing = z.infer<typeof listingSchema>;
