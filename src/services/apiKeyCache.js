import redis from "../lib/redis.js";

const CACHE_TTL = 60;

function getApiKeyCacheKey(keyHash){
    return  `api-Key:${keyHash}`;
}

export async function getApiKeyCache(keyHash){
    const cacheKey = getApiKeyCacheKey(keyHash);

    try {
        const cached = await redis.get(cacheKey);

        if(!cached){
            return null;
        }

        return JSON.parse(cached);
    } catch (error) {
        console.error("API Key cache read failed: ",error.message);
        return null;
    }
}

export async function cacheApiKey(keyHash,apiKey){
    const cacheKey = getApiKeyCacheKey(keyHash);

    try{
        await redis.set(
            cacheKey,
            JSON.stringify(apiKey),
            "EX",
            CACHE_TTL
        );
    }catch(error){
        console.error("API Key cache write failed: ",error.message);
    }
}

export async function invaliadteApiKeyCache(keyHash){
    if(!keyHash) return;

    try {
        await redis.del(getApiKeyCacheKey(keyHash));
    } catch (error) {
        console.error("API Key cache delete failed: ",error.message);
    }
}