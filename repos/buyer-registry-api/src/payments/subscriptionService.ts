export type SubscriptionTier = "buyer-free" | "seller-free" | "seller-pro" | "agent-pro" | "mortgage-pro";

export type Subscription = {
  id: string;
  userId: string;
  tier: SubscriptionTier;
  status: "active" | "past_due" | "canceled";
  currentPeriodEnd: string;
};

const mockSubscriptions: Subscription[] = [
  {
    id: "sub-001",
    userId: "seller-123",
    tier: "seller-pro",
    status: "active",
    currentPeriodEnd: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString()
  }
];

export const getSubscriptionForUser = async (userId: string): Promise<Subscription | undefined> => {
  // TODO: Query Postgres subscriptions table or Stripe API.
  return mockSubscriptions.find((subscription) => subscription.userId === userId);
};

export const recordWebhookEvent = async (_payload: Record<string, unknown>) => {
  // TODO: Verify Stripe/Moneris webhook signature and persist event.
  return { received: true };
};
