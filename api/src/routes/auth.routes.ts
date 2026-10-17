import { Router } from "express";
import { z } from "zod";
import * as authService from "../services/auth.service";
import { authenticate } from "../middleware/authenticate";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const result = await authService.login(email, password);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/me", authenticate, async (req, res, next) => {
  try {
    const result = await authService.getMe(req.user!.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
