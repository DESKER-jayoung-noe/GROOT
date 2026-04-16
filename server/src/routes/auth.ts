import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { signToken, authMiddleware, type JwtPayload } from "../middleware/auth.js";
import { prisma } from "../db.js";
export const authRouter = Router();

const ADMIN_USERNAME = "jayoung_noe";

const registerSchema = z.object({
  username: z.string().min(2).max(64),
  password: z.string().min(4).max(128),
});

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "입력값을 확인해 주세요." });
    return;
  }
  const { username, password } = parsed.data;
  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) {
    res.status(409).json({ error: "이미 사용 중인 아이디입니다." });
    return;
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const role = username === ADMIN_USERNAME ? "ADMIN" : "USER";
  const user = await prisma.user.create({
    data: { username, passwordHash, role },
  });
  const payload: JwtPayload = { sub: user.id, username: user.username, role: user.role as "USER" | "ADMIN" };
  const token = signToken(payload);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

authRouter.post("/login", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "입력값을 확인해 주세요." });
    return;
  }
  const { username, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    return;
  }
  const payload: JwtPayload = { sub: user.id, username: user.username, role: user.role as "USER" | "ADMIN" };
  const token = signToken(payload);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

authRouter.get("/me", authMiddleware, async (req, res) => {
  const u = (req as typeof req & { user: JwtPayload }).user;
  const user = await prisma.user.findUnique({ where: { id: u.sub } });
  if (!user) {
    res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    return;
  }
  res.json({ id: user.id, username: user.username, role: user.role });
});
