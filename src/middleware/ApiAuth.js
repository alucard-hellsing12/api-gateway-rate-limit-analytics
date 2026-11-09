import {createHash} from "node:crypto";
import prisma from "../lib/prisma.js";
import { cacheApiKey, getApiKeyCache } from "../services/apiKeyCache.js";

export async function authenticateApiKey(req,res,next){
    try {
        const key = req.get("X-API-Key");
        if(!key || !key.startsWith("gw_live_")){
            return res.status(401).json({
                error : "missing or invalid API Key",
            });
        }
        const keyHash = createHash("sha256").update(key).digest("hex");

        const cacheEnabled = process.env.API_KEY_CACHE_ENABLED !== "false";
        let apiKey = null;

        if(cacheEnabled){
            apiKey = await getApiKeyCache(keyHash);
        }

        if(!apiKey){
            apiKey = await prisma.apiKey.findUnique({
                where : {keyHash},
                include : {
                    plan : true,
                }
            });

            if(cacheEnabled && apiKey && !apiKey.revokedAt){
                await cacheApiKey(keyHash,apiKey);
            }
        }

       

        if(!apiKey || apiKey.revokedAt !== null){
            return res.status(401).json({
                error : "invalid or revoked API Key",
            });
        }

        const requestedUpstreamId = req.params.upstreamId;
        if(requestedUpstreamId && requestedUpstreamId !== apiKey.upstreamId){
            return res.status(403).json({
                error : "Api key is not authorized for this upstream",
            });
        }

        req.apiKey = {
            id : apiKey.id,
            upstreamId : apiKey.upstreamId,
            planId : apiKey.planId,
            plan : apiKey.plan
        };

        next();
    } catch (error) {
        next(error);
    }
}