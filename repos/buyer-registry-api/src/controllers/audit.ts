import { Request, Response } from "express";
import { listAuditEvents, recordAuditEvent } from "../compliance/auditLogger";

export const listAuditEventsController = async (_req: Request, res: Response) => {
  const events = await listAuditEvents();
  res.json({ events });
};

export const createAuditEventController = async (req: Request, res: Response) => {
  const event = await recordAuditEvent(req.body);
  res.status(201).json({ event });
};
