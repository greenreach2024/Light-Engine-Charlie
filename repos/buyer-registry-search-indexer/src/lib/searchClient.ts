import { SearchClient, AzureKeyCredential } from "@azure/search-documents";
import dotenv from "dotenv";
import { listingDocumentSchema, wishlistDocumentSchema } from "./schemas";

dotenv.config();

const endpoint = process.env.AZURE_SEARCH_ENDPOINT ?? "https://example.search.windows.net";
const indexName = process.env.AZURE_SEARCH_INDEX ?? "listings";
const apiKey = process.env.AZURE_SEARCH_API_KEY ?? "local-dev-key";

const client = new SearchClient(endpoint, indexName, new AzureKeyCredential(apiKey));

type IndexableDocument = typeof listingDocumentSchema._type | typeof wishlistDocumentSchema._type;

export const enqueueIndexOperation = async (document: IndexableDocument) => {
  await client.uploadDocuments([document]);
};
