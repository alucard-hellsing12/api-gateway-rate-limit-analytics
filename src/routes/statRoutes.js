import { Router } from "express";
import { getOverview,getRequestsPerMinute,getErrorRate,getLatency } from "../services/statService.js";

const router = Router();
function handleError(err,res){
    if (err.message === "INVALID_DATE_RANGE") {
        return res.status(400).json({
            error: "Invalid date range. Check from and to."
        });
    }

    console.error("Stats API error:", err);

    return res.status(500).json({
        error: "Failed to retrieve statistics"
    });
}

router.get("/overview",async (req,res) => {
    try {
        const stat = await getOverview(req.query,req.user.id);
    
        res.json(stat);
    } catch (error) {
        handleError(error,res);
    }
});

router.get("/requests-per-minute", async (req, res) => {
    try {
        const stats = await getRequestsPerMinute(
            req.query,
            req.user.id
        );

        res.json(stats);
    } catch (error) {
        handleError(error, res);
    }
});

router.get("/error-rate", async (req, res) => {
    try {
        const stats = await getErrorRate(
            req.query,
            req.user.id
        );

        res.json(stats);
    } catch (error) {
        handleError(error, res);
    }
});

router.get("/latency", async (req, res) => {
    try {
        const stats = await getLatency(
            req.query,
            req.user.id
        );

        res.json(stats);
    } catch (error) {
        handleError(error, res);
    }
});

export default router;