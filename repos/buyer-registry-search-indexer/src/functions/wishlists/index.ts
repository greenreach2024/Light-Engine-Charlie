import { AzureFunction, Context } from "@azure/functions";
import { wishlistDocumentSchema } from "../../lib/schemas";
import { enqueueIndexOperation } from "../../lib/searchClient";

const wishlistsIngest: AzureFunction = async (context: Context, messages: unknown[]): Promise<void> => {
  for (const message of messages) {
    const parsed = wishlistDocumentSchema.safeParse(message);

    if (!parsed.success) {
      context.log.error("Invalid wishlist payload", parsed.error.flatten());
      continue;
    }

    await enqueueIndexOperation(parsed.data);
    context.log(`Queued wishlist ${parsed.data.wishlistId} for indexing`);
  }
};

export default wishlistsIngest;
