import { Router } from "express";
import { createUpstream,listUpstream,deleteUpstream } from "../services/upstreamService.js";

const router = Router();

router.post("/",async (req,res,next) => {
    try {
        const upstream = await createUpstream({
            userId : req.user.id,
            data : req.body
        });

        res.status(201).json(upstream);
    } catch (error) {
        if(error.name === "ZodError"){
            return res.status(400).json({
                error : "Ivalid Upstream Input",
                detail : error.issues
            });
        }

        if (error.message === "INVALID_UPSTREAM_URL") {
            return res.status(400).json({
                error: "A valid HTTP or HTTPS upstream URL is required",
            });
        }

        next(error);
    }
});

router.get("/",async (req,res,next) => {
    try {
        const upstreams = await listUpstream(req.user.id);
        res.json(upstreams);
    } catch (error) {
        next(error);
    }
});

router.delete("/:id",async (req,res,next) => {
    try {
        const {status} = await deleteUpstream({
        userId: req.user.id,
        upstreamId: req.params.id,
        });

        if(status === "not_found"){
            return res.status(404).json({
                error : "upstream not found",
            });
        }

        if(status === "has_api_keys"){
            return res.status(409).json({
                error : "Revoke or Remove upstream's API Keys first",
            });
        }

        res.json({message : "upstream deleted successfully"});
    } catch (error) {
        next(error);
    }
});

export default router;