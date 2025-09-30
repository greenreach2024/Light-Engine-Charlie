import type { WishlistInput } from "./wishlistSchema";

type MatchBreakdown = {
  total: number;
  location: number;
  price: number;
  features: number;
  timeline: number;
};

type ListingCandidate = {
  listingId: string;
  price: number;
  address: string;
  postalArea: string;
  amenities: string[];
  availability: "immediate" | "30-days" | "60-days" | "90-days" | "custom";
};

type MatchResult = ListingCandidate & {
  score: number;
  breakdown: MatchBreakdown;
  highlights: string[];
};

const DEFAULT_WEIGHTS = {
  location: 0.5,
  price: 0.3,
  features: 0.15,
  timeline: 0.05
} as const;

const mockListings: ListingCandidate[] = [
  {
    listingId: "listing-123",
    price: 799000,
    address: "123 Lakeshore Rd, Oakville, ON",
    postalArea: "Oakville",
    amenities: ["3 bed", "Garage", "Near schools"],
    availability: "immediate"
  },
  {
    listingId: "listing-456",
    price: 925000,
    address: "456 River St, Toronto, ON",
    postalArea: "Toronto",
    amenities: ["Transit", "Balcony", "Gym"],
    availability: "60-days"
  }
];

export const getMatchesForWishlist = async (
  wishlistId: string,
  wishlist?: WishlistInput
): Promise<MatchResult[]> => {
  // Replace with database/PostGIS query and weighting configuration sourced from Postgres.
  if (!wishlist) {
    return mockListings.map((listing) => ({
      ...listing,
      score: 0,
      breakdown: { total: 0, location: 0, price: 0, features: 0, timeline: 0 },
      highlights: listing.amenities
    }));
  }

  return mockListings.map((listing) => {
    const breakdown = calculateMatchScore(wishlist, listing);
    return {
      ...listing,
      score: breakdown.total,
      breakdown,
      highlights: listing.amenities
    };
  });
};

export const calculateMatchScore = (
  wishlist: WishlistInput,
  listing: ListingCandidate
): MatchBreakdown => {
  const locationPreference = wishlist.areas[0]?.label ?? "";
  const locationScore = listing.postalArea.includes(locationPreference) ? 100 : 60;

  const priceScore = listing.price >= wishlist.budgetMin && listing.price <= wishlist.budgetMax ? 100 : 0;

  const mustHave = wishlist.mustHaveFeatures;
  const satisfiedMustHave = mustHave.filter((feature) => listing.amenities.includes(feature)).length;
  const featureScore = mustHave.length === 0 ? 100 : Math.round((satisfiedMustHave / mustHave.length) * 100);

  const timelinePreference = wishlist.timeline;
  const timelineScore = timelinePreference === "0-3 months"
    ? listing.availability === "immediate"
      ? 100
      : 60
    : listing.availability === "immediate"
    ? 80
    : 90;

  const total = Math.round(
    locationScore * DEFAULT_WEIGHTS.location +
      priceScore * DEFAULT_WEIGHTS.price +
      featureScore * DEFAULT_WEIGHTS.features +
      timelineScore * DEFAULT_WEIGHTS.timeline
  );

  return {
    total: Math.min(100, total),
    location: locationScore,
    price: priceScore,
    features: featureScore,
    timeline: timelineScore
  };
};
