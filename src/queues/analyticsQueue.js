import { Queue } from "bullmq";
import redis from "../lib/redis.js";

export const analyticsQueue = new Queue("analytics",{
    connection : redis,
});
