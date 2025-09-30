import { ThreadList, type MessageThread } from "@apps/shared/messaging/ThreadList";

const sellerThreads: MessageThread[] = [
  {
    id: "thread-987",
    participants: [
      { id: "seller-001", alias: "You", role: "seller" },
      { id: "buyer-222", alias: "Family home wishlist", role: "buyer" }
    ],
    subject: "Match with wishlist Family home in Oakville",
    lastMessageSnippet: "We are interested in scheduling a weekend showing.",
    updatedAt: "2024-05-04T10:45:00Z"
  }
];

export const SellerMessages = () => (
  <section>
    <h2>Buyer conversations</h2>
    <p>
      Paid sellers can chat with matched buyers directly in the app. All
      messages are logged and moderated for compliance.
    </p>
    <ThreadList threads={sellerThreads} />
  </section>
);
