import { ListingInput } from "./listingSchema";

export const publishListingUpsert = async (listing: ListingInput) => {
  // Replace with Azure Service Bus or queue integration.
  console.log("Listing upsert queued", listing.listingId);
};
