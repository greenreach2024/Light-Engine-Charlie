export type MessageEnvelope = {
  id: string;
  threadId: string;
  senderId: string;
  recipientId: string;
  content: string;
  sentAt: string;
};

const mockMessages: MessageEnvelope[] = [
  {
    id: "msg-001",
    threadId: "thread-001",
    senderId: "buyer-001",
    recipientId: "seller-123",
    content: "Hello! We're interested in your listing.",
    sentAt: new Date().toISOString()
  }
];

export const listMessagesForThread = async (_threadId: string): Promise<MessageEnvelope[]> => {
  // TODO: Replace with Postgres query joined with access control rules.
  return mockMessages;
};

export const appendMessage = async (
  _threadId: string,
  _senderId: string,
  _content: string
): Promise<MessageEnvelope> => {
  // TODO: Persist to Postgres and fan out via Azure SignalR.
  const envelope = mockMessages[0];
  return envelope;
};
