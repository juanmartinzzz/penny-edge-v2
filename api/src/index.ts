import { Hono } from "hono";
import { cors } from "hono/cors";

const ALLOWED_ORIGINS = [
  "http://localhost:5292",
  "https://penny-edge-v2.juan-martinzzz.workers.dev",
];

const app = new Hono();

app.use(
  "*",
  cors({
    origin: (origin) => (origin && ALLOWED_ORIGINS.includes(origin) ? origin : ""),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "penny-edge-api",
    time: new Date().toISOString(),
  }),
);

app.get("/", (c) =>
  c.json({
    name: "penny-edge-api",
    message: "Production API for Penny Edge",
    routes: ["/health"],
  }),
);

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;
