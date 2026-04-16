import "dotenv/config";
import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { materialsRouter } from "./routes/materials.js";
import { productsRouter } from "./routes/products.js";
import { setsRouter } from "./routes/sets.js";
import { comparisonsRouter } from "./routes/comparisons.js";
import { meRouter } from "./routes/me.js";
import { archiveRouter } from "./routes/archive.js";
import { adminRouter } from "./routes/admin.js";

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRouter);
app.use("/api/materials", materialsRouter);
app.use("/api/products", productsRouter);
app.use("/api/sets", setsRouter);
app.use("/api/comparisons", comparisonsRouter);
app.use("/api/me", meRouter);
app.use("/api/archive", archiveRouter);
app.use("/api/admin", adminRouter);

app.listen(PORT, () => {
  console.log(`API http://localhost:${PORT}`);
});
