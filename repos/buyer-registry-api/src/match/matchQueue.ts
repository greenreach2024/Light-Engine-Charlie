import { loadConfig } from "../config/config";

const config = loadConfig();

type MatchQueuePayload = {
  wishlistId?: string;
  listingId?: string;
};

export const enqueueMatchRecalculation = (payload: MatchQueuePayload) => {
  // Replace with BullMQ/Azure Queue integration.
  console.log(
    `Queued match recalculation for wishlist=${payload.wishlistId ?? "*"} listing=${payload.listingId ?? "*"} on ${config.matchQueueName}`
  );
};
