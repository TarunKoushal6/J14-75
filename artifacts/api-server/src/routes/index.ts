import { Router } from "express";
import healthRouter from "./health.js";
import chatRouter from "./chat.js";
import authRouter from "./auth.js";

const router = Router();

router.use(healthRouter);
router.use("/chat", chatRouter);
router.use("/auth", authRouter);

export default router;
