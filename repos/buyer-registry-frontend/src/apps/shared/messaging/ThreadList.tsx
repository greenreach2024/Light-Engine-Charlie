export type ThreadParticipant = {
  id: string;
  alias: string;
  role: "buyer" | "seller" | "agent" | "developer" | "lender" | "admin";
};

export type MessageThread = {
  id: string;
  participants: ThreadParticipant[];
  subject: string;
  lastMessageSnippet: string;
  updatedAt: string;
};

type ThreadListProps = {
  threads: MessageThread[];
};

export const ThreadList = ({ threads }: ThreadListProps) => {
  if (threads.length === 0) {
    return <p>No conversations yet. Upgrade or publish to start connecting.</p>;
  }

  return (
    <ul className="card">
      {threads.map((thread) => (
        <li key={thread.id}>
          <header>
            <strong>{thread.subject}</strong>
            <span>
              Updated {new Date(thread.updatedAt).toLocaleString()} · {thread.participants
                .map((participant) => participant.alias)
                .join(", ")}
            </span>
          </header>
          <p>{thread.lastMessageSnippet}</p>
        </li>
      ))}
    </ul>
  );
};
