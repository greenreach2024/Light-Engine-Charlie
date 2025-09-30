import { Router } from "express";
import { createMessageController, listMessagesController } from "../controllers/messages";

export const router = Router();

router.get("/:threadId", listMessagesController);
router.post("/:threadId", createMessageController);
