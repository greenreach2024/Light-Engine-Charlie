import { Request, Response } from "express";
import { appendMessage, listMessagesForThread } from "../messaging/messageService";

export const listMessagesController = async (req: Request, res: Response) => {
  const { threadId } = req.params;
  const messages = await listMessagesForThread(threadId);
  res.json({ messages });
};

export const createMessageController = async (req: Request, res: Response) => {
  const { threadId } = req.params;
  const { senderId, content } = req.body;
  const message = await appendMessage(threadId, senderId, content);
  res.status(201).json({ message });
};
