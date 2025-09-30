import { z } from "zod";

export const listingDocumentSchema = z.object({
  listingId: z.string(),
  title: z.string(),
  address: z.string(),
  price: z.number(),
  location: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([z.number(), z.number()])
  }),
  features: z.array(z.string()).default([])
});

export const wishlistDocumentSchema = z.object({
  wishlistId: z.string(),
  buyerId: z.string(),
  budgetMin: z.number(),
  budgetMax: z.number(),
  propertyTypes: z.array(z.string()),
  geometries: z.array(z.any())
});
