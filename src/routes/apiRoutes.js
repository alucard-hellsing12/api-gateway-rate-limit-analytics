import z from "zod";
import { createApiKey,listApiKeys,revokeApiKey, updateApiKeyPlan} from "../services/apiService.js";
import prisma from "../lib/prisma.js";
import redis from "../lib/redis.js";
import { Router } from "express";
import { invaliadteApiKeyCache } from "../services/apiKeyCache.js";

const router = Router();
const createApiSchema = z.object({
    name : z.string().trim().min(1).max(100),
    upstreamId : z.uuid()
});

router.post("/",async (req,res,next) => {
    try {
        const {name,upstreamId} = createApiSchema.parse(req.body);
        const freePlan = await prisma.plan.findUnique({
            where : {name : "free"}
        });

        if(!freePlan) {
            return res.status(500).json({
                error : "free plan is not configured"
            });
        }

       const apiKey =  await createApiKey({userId: req.user.id,name,planId : freePlan.id,upstreamId});

       if(!apiKey){
            return res.status(404).json({
                error: "Upstream not found",
            });
       }

       res.status(201).json(apiKey);
    } catch (error) {
        if(error.name === "ZodError"){
            return res.status(400).json({
                error : "invalid api inputs",
                details : error.issues,
            });
        }
        next(error);
    }
});

router.get("/",async (req,res,next) => {
    try {
        const querySchema = z.object({
            upstreamId : z.uuid()
        });

        const {upstreamId} = querySchema.parse(req.query);
        const apikeys = await listApiKeys({userId: req.user.id,upstreamId});

        res.json(apikeys);
    } catch (error) {
        if(error.name === "ZodError"){
            return res.status(400).json({
                error : "Invalid query parameter for upstreamId",
                details : error.issues
            });
        }
        next(error);
    }
});

router.delete("/:id",async (req,res,next) => {
    try {
        const revoked = await revokeApiKey({keyId : req.params.id, userId: req.user.id});

        if(!revoked){
            return res.status(404).json({
                error: "Active API key not found"
            });
        }

        res.json({message : "API Key revoked successfully"});
    } catch (error) {
        next(error);
    }
});

router.patch("/:id/plan",async (req,res,next) => {
    try {
        const {planName} = req.body;

        if(!planName){
            return res.status(400).json({
                error : "plan name is required",
            });
        }

        const apiKey = await updateApiKeyPlan({
            keyId : req.params.id,
            userId : req.user.id,
            planName
        });

        if(!apiKey){
            return res.status(404).json({
                error : "API Key not found or already revoked"
            });
        }

        await redis.del(`rate-limit:${apiKey.id}`);
        
        await invaliadteApiKeyCache(apiKey.keyHash);

        const data =  {
            id: apiKey.id,
            name: apiKey.name,
            prefix: apiKey.prefix,
            upstreamId: apiKey.upstreamId,
            plan: apiKey.plan
        } 

        return res.status(200).json({
            message : `API key plan updated to ${planName}`,
            data
        });
    } catch (error) {
        if (error.message === "INVALID_PLAN") {
            return res.status(400).json({
                error: "Invalid plan. Available plans: free, pro"
            });
        }

        next(error);
    }
});

export default router;