import { ThreadList, type MessageThread } from "@apps/shared/messaging/ThreadList";

const buyerThreads: MessageThread[] = [
  {
    id: "thread-001",
    participants: [
      { id: "buyer-001", alias: "You", role: "buyer" },
      { id: "seller-123", alias: "Seller 123", role: "seller" }
    ],
    subject: "123 Lakeshore Rd",
    lastMessageSnippet: "Thanks for sharing the floor plans. Can we schedule a virtual tour?",
    updatedAt: "2024-05-06T16:02:00Z"
  }
];

export const BuyerMessages = () => {
  return (
    <section>
      <h2>Messages</h2>
      <p>
        Conversations remain anonymous until both parties consent to share
        contact details. Azure SignalR will deliver these threads in real time
        once the backend is connected.
      </p>
      <ThreadList threads={buyerThreads} />
    </section>
  );
};
