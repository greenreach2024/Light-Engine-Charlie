import crypto from "node:crypto";
import { NextFunction, Request, Response } from "express";

export type RequestContext = {
  correlationId: string;
};

declare module "express-serve-static-core" {
  interface Request {
    context: RequestContext;
  }
}

export const attachRequestContext = (req: Request, _res: Response, next: NextFunction) => {
  req.context = {
    correlationId: req.headers["x-correlation-id"]?.toString() ?? crypto.randomUUID()
  };

  next();
};
