import "dotenv/config";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL,{
    maxRetriesPerRequest : null,
});

redis.on("error", (err) => {
    console.error("redis connection error: ",err.message);
});

export default redis;