import "dotenv/config";
import express from "express";
import prisma from "./lib/prisma.js";
import redis from "./lib/redis.js";
import authRouter from "./routes/authRoutes.js";
import apiRouter from "../src/routes/apiRoutes.js";
import upstreamRouter from "../src/routes/upstreamRoutes.js"
import statsRouter from "../src/routes/statRoutes.js"
import { requiredAuth } from "./middleware/requiredAuth.js";
import { proxyHandler } from "./routes/proxyHandler.js";
import { authenticateApiKey } from "./middleware/ApiAuth.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { rateLimiter } from "./middleware/rateLimiter.js";
import { usageTracker } from "./middleware/usageTracker.js";

const app = express();

app.use(express.json());

app.get("/",(req,res) => {
    res.json({
        message : "Gateway is running..."
    });
});

app.use("/auth",authRouter);
app.use("/api-keys",requiredAuth,apiRouter);
app.use("/upstreams",requiredAuth,upstreamRouter);
app.use("/proxy/:upstreamId",authenticateApiKey,usageTracker,rateLimiter,proxyHandler);
app.use("/stats",requiredAuth,statsRouter);

app.get("/health",async (req,res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        await redis.ping();

        res.json({
            status: "ok",
            postgres: "connected",
            redis: "connected",
        });
    } catch (error) {
        console.error("Health check failed: ",error.message);
        res.status(503).json({
            status : "error",
            message : "a dependency is unavailable"
        });
    }
});

app.use(errorHandler);

const server = app.listen(process.env.PORT || 3000 , () => {
    console.log("Server is running on the port");
});

async function shutdown() {
  server.close(async () => {
    await Promise.allSettled([
      prisma.$disconnect(),
      redis.quit(),
    ]);

    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
