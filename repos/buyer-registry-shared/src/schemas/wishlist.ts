import { z } from "zod";

const geoJsonPoint = z.object({
  type: z.literal("Point"),
  coordinates: z.tuple([z.number(), z.number()])
});

const geoJsonPolygon = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()])))
});

const geoJsonMultiPolygon = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(z.array(z.tuple([z.number(), z.number()]))))
});

const wishlistArea = z.object({
  label: z.string().min(1),
  weight: z.number().min(0).max(1).default(1),
  geometry: z.union([geoJsonPoint, geoJsonPolygon, geoJsonMultiPolygon])
});

export const wishlistSchema = z.object({
  wishlistId: z.string().uuid().optional(),
  buyerId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  budgetMin: z.number().int().nonnegative(),
  budgetMax: z.number().int().nonnegative(),
  propertyTypes: z
    .array(z.enum(["house", "condo", "townhouse", "duplex", "land"]))
    .nonempty(),
  areas: z.array(wishlistArea).min(1),
  mustHaveFeatures: z.array(z.string()).default([]),
  niceToHaveFeatures: z.array(z.string()).default([]),
  lifestylePreferences: z.array(z.string()).default([]),
  timeline: z.enum(["0-3 months", "3-6 months", "6-12 months", ">12 months"]),
  mortgageStatus: z.enum(["pre-approved", "pre-qualified", "none"]).default("none"),
  mortgageOptIn: z.boolean().default(false),
  contactPreference: z.enum(["in-app", "email", "phone"]).default("in-app"),
  languages: z.array(z.string()).default([]),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional()
});

export type Wishlist = z.infer<typeof wishlistSchema>;
