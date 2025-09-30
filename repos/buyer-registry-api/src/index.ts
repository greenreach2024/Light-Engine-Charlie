import express from "express";
import { router as wishlistRouter } from "./routes/wishlists";
import { router as listingRouter } from "./routes/listings";
import { router as matchRouter } from "./routes/matches";
import { router as messageRouter } from "./routes/messages";
import { router as subscriptionRouter } from "./routes/subscriptions";
import { router as analyticsRouter } from "./routes/analytics";
import { router as auditRouter } from "./routes/audit";
import { loadConfig } from "./config/config";
import { attachRequestContext } from "./middleware/requestContext";

const app = express();
const config = loadConfig();

app.use(express.json());
app.use(attachRequestContext);

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/wishlists", wishlistRouter);
app.use("/listings", listingRouter);
app.use("/matches", matchRouter);
app.use("/messages", messageRouter);
app.use("/subscriptions", subscriptionRouter);
app.use("/analytics", analyticsRouter);
app.use("/audit", auditRouter);

app.listen(config.port, () => {
  console.log(`API listening on port ${config.port}`);
});
