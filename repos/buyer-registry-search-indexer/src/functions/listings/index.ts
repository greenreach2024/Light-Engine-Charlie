import { AzureFunction, Context } from "@azure/functions";
import { enqueueIndexOperation } from "../../lib/searchClient";
import { listingDocumentSchema } from "../../lib/schemas";

const listingsIngest: AzureFunction = async (context: Context, messages: unknown[]): Promise<void> => {
  for (const message of messages) {
    const parsed = listingDocumentSchema.safeParse(message);

    if (!parsed.success) {
      context.log.error("Invalid listing payload", parsed.error.flatten());
      continue;
    }

    await enqueueIndexOperation(parsed.data);
    context.log(`Queued listing ${parsed.data.listingId} for indexing`);
  }
};

export default listingsIngest;
