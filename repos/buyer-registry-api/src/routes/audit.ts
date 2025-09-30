import { Router } from "express";
import { createAuditEventController, listAuditEventsController } from "../controllers/audit";

export const router = Router();

router.get("/events", listAuditEventsController);
router.post("/events", createAuditEventController);
